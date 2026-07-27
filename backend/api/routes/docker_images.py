"""
Docker image management API routes.

Endpoints for managing the Docker images used by topology NFs:
- list local images
- upload (``docker load``) a tar / tar.gz image archive via drag-and-drop
- pull an image from a registry with streamed progress (WebSocket)
- configure registry credentials (``docker login``) and list active logins

Credentials are persisted by Docker itself (``~/.docker/config.json``); the
application stores none of them.
"""

import asyncio
import json
import os
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException,
)
from pydantic import BaseModel
from loguru import logger

router = APIRouter()

try:
    import docker
    from docker.errors import APIError
    _DOCKER_AVAILABLE = True
except ImportError:  # pragma: no cover
    _DOCKER_AVAILABLE = False

_client = None


def _get_client():
    global _client
    if not _DOCKER_AVAILABLE:
        raise RuntimeError("Docker SDK for Python is not installed")
    if _client is None:
        _client = docker.from_env()
    return _client


async def _run_blocking(func, *args):
    """Run a blocking Docker SDK call in a worker thread (Py3.8 compatible)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, func, *args)


# ── Request models ──────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    registry: Optional[str] = None
    username: str
    password: str


# ── Helpers ─────────────────────────────────────────────────────────────
def _split_ref(ref: str):
    """Split an image reference into (repository, tag-or-digest)."""
    ref = (ref or "").strip()
    if "@" in ref:
        repo, _, digest = ref.partition("@")
        return repo, digest
    last_slash = ref.rfind("/")
    last_colon = ref.rfind(":")
    if last_colon > last_slash:
        return ref[:last_colon], ref[last_colon + 1:]
    return ref, "latest"


def _image_summary(img) -> Dict[str, Any]:
    attrs = img.attrs or {}
    return {
        "id": attrs.get("Id", getattr(img, "id", "")),
        "tags": img.tags or [],
        "size": attrs.get("Size", 0),
        "created": attrs.get("Created", ""),
    }


def _list_images() -> List[Dict[str, Any]]:
    client = _get_client()
    return [_image_summary(i) for i in client.images.list()]


def _load_image(data: bytes) -> List[str]:
    client = _get_client()
    images = client.images.load(data)
    tags: List[str] = []
    for img in images:
        tags.extend(img.tags or [getattr(img, "short_id", "")])
    return tags


# ── Routes ──────────────────────────────────────────────────────────────
@router.get("/docker/images")
async def list_images():
    """List local Docker images."""
    try:
        return {"images": await _run_blocking(_list_images)}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/docker/images/upload")
async def upload_image(file: UploadFile = File(...)):
    """Upload a Docker image archive (.tar / .tar.gz) and load it (docker load)."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        tags = await _run_blocking(_load_image, data)
        return {"status": "loaded", "filename": file.filename, "tags": tags}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"docker load failed: {getattr(e, 'explanation', None) or str(e)}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")


@router.post("/docker/login")
async def docker_login(req: LoginRequest):
    """Authenticate to a registry (persisted by Docker to ~/.docker/config.json)."""
    def _do_login():
        client = _get_client()
        return client.login(
            username=req.username,
            password=req.password,
            registry=req.registry or None,
        )

    try:
        result = await _run_blocking(_do_login)
        return {
            "status": "ok",
            "detail": (result or {}).get("Status", "Logged in"),
            "registry": req.registry or "Docker Hub",
        }
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except APIError as e:
        raise HTTPException(status_code=401, detail=getattr(e, "explanation", None) or "Login failed")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=str(e))


@router.get("/docker/logins")
async def list_logins():
    """List registries currently authenticated (from ~/.docker/config.json)."""
    cfg = os.path.expanduser("~/.docker/config.json")
    auths: List[str] = []
    if os.path.isfile(cfg):
        try:
            with open(cfg) as f:
                data = json.load(f)
            auths = list((data.get("auths") or {}).keys())
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to read docker config: {e}")
    return {"registries": auths}


# ── WebSocket: pull with streamed progress ──────────────────────────────
@router.websocket("/ws/docker/images/pull")
async def ws_pull_image(websocket: WebSocket, image: str):
    """Pull an image, streaming progress events (JSON lines) to the client.

    Events mirror the Docker API pull stream (status/progress/id), ending with
    ``{"done": true}`` on success or ``{"error": "..."}`` on failure. Idle
    keep-alive ``{"ping": true}`` events are sent roughly every 3 seconds.
    """
    await websocket.accept()
    if not _DOCKER_AVAILABLE:
        await websocket.send_text(json.dumps({"error": "Docker SDK not installed"}))
        await websocket.close()
        return

    import threading
    import queue

    repo, tag = _split_ref(image)
    q: "queue.Queue" = queue.Queue()

    def _pull():
        try:
            client = _get_client()
            for line in client.api.pull(repo, tag=tag, stream=True, decode=True):
                q.put(line)
            q.put({"done": True})
        except Exception as e:  # noqa: BLE001
            q.put({"error": str(e)})

    threading.Thread(target=_pull, daemon=True).start()

    idle = 0
    try:
        while True:
            try:
                evt = q.get(timeout=0.5)
                idle = 0
                await websocket.send_text(json.dumps(evt))
                if evt.get("done") or evt.get("error"):
                    break
            except queue.Empty:
                idle += 1
                if idle % 6 == 0:  # ~every 3s
                    try:
                        await websocket.send_text(json.dumps({"ping": True}))
                    except Exception:
                        break
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
