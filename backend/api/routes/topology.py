"""
Topology Editor API routes.

Endpoints for managing user-designed network topologies (ContainerLab-style
nodes + NIC links), deploying them as Docker containers, and per-node
operations (config, logs, shell, restart/stop).
"""

import asyncio
import json
import os
from typing import Any, Dict, List, Optional

import yaml
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from loguru import logger

from coresimrunner import topology_engine as engine
from coresimrunner import nf_registry

router = APIRouter()


async def _run_blocking(func, *args):
    """Run a blocking (Docker SDK) call in a worker thread.

    Compatible with Python 3.8 (no asyncio.to_thread), matching the runtime
    range from local dev (3.8) to the Docker image (3.11).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, func, *args)


# ── Request / Response models ───────────────────────────────────────────
class TopologyDoc(BaseModel):
    name: str
    core_type: str = "open5gs"
    subnet: Optional[str] = None
    gateway: Optional[str] = None
    globals: Optional[Dict[str, Any]] = None
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    links: List[Dict[str, Any]] = Field(default_factory=list)


class NodeConfigUpdate(BaseModel):
    config: Optional[Dict[str, Any]] = None
    interfaces: Optional[Dict[str, Any]] = None


# ── NF palette catalog ──────────────────────────────────────────────────
@router.get("/nf-kinds")
async def list_nf_kinds(core: Optional[str] = None):
    """Return the draggable NF catalog for the palette, plus categories."""
    return {
        "categories": nf_registry.categories(),
        "kinds": nf_registry.list_nf_kinds(core),
    }


@router.get("/config-schema")
async def get_config_schema(core: str = "open5gs", kind: Optional[str] = None):
    """Structured-config field descriptors for the sidebar form.

    ``global`` drives the lab-wide settings panel; ``node`` drives the
    per-NF override form for the given ``kind``.
    """
    return nf_registry.config_schema(core, kind)


# ── Topology CRUD ───────────────────────────────────────────────────────
@router.get("/topologies")
async def list_topologies():
    return {"topologies": engine.list_topologies()}


@router.post("/topologies")
async def create_topology(doc: TopologyDoc):
    """Create / overwrite a topology document."""
    try:
        saved = engine.save_topology(doc.model_dump(exclude_none=True))
        return {"status": "saved", "topology": _summary(saved)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/topologies/default-template")
async def get_default_template(core: str = "free5gc", variant: str = "default"):
    """Return a 3GPP-wired default topology for ``core``/``variant`` (not persisted).

    The frontend loads the returned document into the editor as a starting
    point; it is only saved when the user explicitly saves it. ``variant``
    selects a template flavor (e.g. ``default``, ``vonr``, ``volte``).
    """
    from coresimrunner import default_templates
    try:
        return default_templates.build_default_topology(core, variant)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/topologies/default-template/variants")
async def get_default_template_variants(core: str = "free5gc"):
    """List the available default-template variants for ``core``."""
    from coresimrunner import default_templates
    try:
        return default_templates.list_default_templates(core)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/topologies/{name}")
async def get_topology(name: str):
    try:
        return engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/topologies/{name}")
async def update_topology(name: str, doc: TopologyDoc):
    """Replace the stored topology document (full save from the editor)."""
    payload = doc.model_dump(exclude_none=True)
    payload["name"] = name
    try:
        saved = engine.save_topology(payload)
        return {"status": "saved", "topology": _summary(saved)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/topologies/{name}")
async def delete_topology(name: str):
    try:
        engine.load_topology(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Topology not found: {name}")
    # Undeploy any running containers first (best-effort).
    try:
        doc = engine.load_topology(name)
        await _run_blocking(engine.get_deployer().undeploy, doc)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Undeploy on delete failed: {e}")
    engine.delete_topology(name)
    return {"status": "deleted", "name": name}


@router.get("/topologies/{name}/validate")
async def validate_topology(name: str):
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return engine.validate(doc)


# ── Deploy / Undeploy / Status ──────────────────────────────────────────
@router.post("/topologies/{name}/deploy")
async def deploy_topology(name: str):
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        result = await _run_blocking(engine.get_deployer().deploy, doc)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - surface Docker/other errors with detail
        logger.exception(f"Deploy of '{name}' failed")
        raise HTTPException(status_code=500, detail=f"Deploy failed: {type(e).__name__}: {e}")


@router.post("/topologies/{name}/undeploy")
async def undeploy_topology(name: str):
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        return await _run_blocking(engine.get_deployer().undeploy, doc)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/topologies/{name}/status")
async def topology_status(name: str):
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return await _run_blocking(engine.get_deployer().get_status, doc)


@router.get("/topologies/{name}/images")
async def topology_images(name: str):
    """Local Docker-image availability for every node in the topology.

    The editor calls this on load and auto-pulls any missing image.
    """
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        images = await _run_blocking(engine.get_deployer().check_images, doc)
        return {"topology": name, "images": images}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/topologies/images-check")
async def check_topology_images(doc: TopologyDoc):
    """Image availability for an arbitrary (possibly unsaved) topology doc.

    Used by the editor right after any document is rendered on the canvas
    (saved topology or fresh default template) to trigger auto-pulls.
    """
    try:
        images = await _run_blocking(engine.get_deployer().check_images, doc.model_dump(exclude_none=True))
        return {"images": images}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── YAML view (containerlab-style) ─────────────────────────────────────
@router.get("/topologies/{name}/yaml")
async def get_topology_yaml(name: str):
    """Return the topology as a containerlab-style YAML string."""
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return PlainTextResponse(_doc_to_yaml(doc), media_type="text/yaml")


@router.put("/topologies/{name}/yaml")
async def apply_topology_yaml(name: str, request: Request):
    """Parse a containerlab-style YAML body into a TopologyDoc and save."""
    body = await request.body()
    try:
        data = yaml.safe_load(body.decode("utf-8"))
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"YAML parse error: {e}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="YAML must be a mapping")
    try:
        doc = _yaml_to_doc(data, name)
        engine.save_topology(doc)
        return {"status": "saved", "topology": _summary(doc), "doc": doc}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _doc_to_yaml(doc: Dict) -> str:
    """Convert a TopologyDoc dict to containerlab-style YAML."""
    core = doc.get("core_type", "open5gs")
    out: Dict[str, Any] = {"name": doc.get("name", "topology")}
    topo: Dict[str, Any] = {}

    # kinds section: unique kinds with their image
    kinds_seen: Dict[str, Dict] = {}
    for n in doc.get("nodes", []):
        k = n.get("kind", "unknown")
        if k not in kinds_seen and k != "bridge":
            nf = nf_registry.get_nf(core, k)
            img = (nf or {}).get("runtime", {}).get("image", "")
            kinds_seen[k] = {"image": img} if img else {}
    if kinds_seen:
        topo["kinds"] = kinds_seen

    # nodes section
    nodes_out: Dict[str, Any] = {}
    for n in doc.get("nodes", []):
        nid = n.get("id", "node")
        entry: Dict[str, Any] = {"kind": n.get("kind", "unknown")}
        ifaces = n.get("interfaces")
        if ifaces:
            entry["interfaces"] = ifaces
        cfg = n.get("config")
        if cfg:
            entry["config"] = cfg
        nodes_out[nid] = entry
    if nodes_out:
        topo["nodes"] = nodes_out

    # links section (containerlab brief format)
    links_out: List[Dict] = []
    for l in doc.get("links", []):
        eps = l.get("endpoints", [])
        if len(eps) == 2:
            links_out.append({"endpoints": [
                f"{eps[0].get('node', '')}:{eps[0].get('iface', '')}",
                f"{eps[1].get('node', '')}:{eps[1].get('iface', '')}",
            ]})
    if links_out:
        topo["links"] = links_out

    out["topology"] = topo
    return yaml.dump(out, default_flow_style=False, sort_keys=False, allow_unicode=True)


def _yaml_to_doc(data: Dict, name: str) -> Dict:
    """Parse a containerlab-style YAML dict back into a TopologyDoc."""
    topo = data.get("topology", {})
    if not isinstance(topo, dict):
        raise ValueError("Missing 'topology' mapping")

    nodes_raw = topo.get("nodes", {})
    links_raw = topo.get("links", [])

    nodes: List[Dict[str, Any]] = []
    if isinstance(nodes_raw, dict):
        for nid, spec in nodes_raw.items():
            if not isinstance(spec, dict):
                spec = {}
            nodes.append({
                "id": str(nid),
                "kind": spec.get("kind", "unknown"),
                "interfaces": spec.get("interfaces", {}),
                "config": spec.get("config", {}),
                "x": spec.get("x", 80),
                "y": spec.get("y", 80),
            })
    elif isinstance(nodes_raw, list):
        for spec in nodes_raw:
            if isinstance(spec, dict):
                nodes.append(spec)

    links: List[Dict[str, Any]] = []
    for i, l in enumerate(links_raw or []):
        if not isinstance(l, dict):
            continue
        eps_raw = l.get("endpoints", [])
        endpoints = []
        for ep in eps_raw:
            if isinstance(ep, str) and ":" in ep:
                parts = ep.rsplit(":", 1)
                endpoints.append({"node": parts[0], "iface": parts[1]})
            elif isinstance(ep, dict):
                endpoints.append(ep)
        if len(endpoints) == 2:
            links.append({"id": l.get("id", f"l{i}"), "endpoints": endpoints})

    return {
        "name": data.get("name", name),
        "core_type": data.get("core_type", "open5gs"),
        "nodes": nodes,
        "links": links,
    }


# ── Per-link packet capture ─────────────────────────────────────────────
@router.post("/topologies/{name}/links/{link_id}/capture/start")
async def start_link_capture(name: str, link_id: str):
    """Start capturing packets on a link (between its two endpoint containers).

    Reuses the shared PacketCaptureService, so the session is then manageable
    (stop / summary / download) via the existing ``/core/capture/*`` endpoints.
    """
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    link = next((l for l in doc.get("links", []) if l.get("id") == link_id), None)
    if link is None:
        raise HTTPException(status_code=404, detail=f"Link not found: {link_id}")
    eps = link.get("endpoints", [])
    if len(eps) != 2:
        raise HTTPException(status_code=400, detail="Link must have exactly 2 endpoints")
    nodes_by_id = {n.get("id"): n for n in doc.get("nodes", [])}
    na = nodes_by_id.get(eps[0].get("node"))
    nb = nodes_by_id.get(eps[1].get("node"))
    if not na or not nb:
        raise HTTPException(status_code=400, detail="Link endpoint node missing")

    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    cname_a = engine.container_name(name, na["id"])
    cname_b = engine.container_name(name, nb["id"])
    try:
        return await _run_blocking(
            svc.start_capture,
            na.get("kind", na["id"]),
            nb.get("kind", nb["id"]),
            cname_a,
            cname_b,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Rendered-config file browser ────────────────────────────────────────
@router.get("/topologies/{name}/files")
async def list_topology_files(name: str):
    """List the rendered config files generated for a topology."""
    try:
        engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"name": name, "files": engine.list_topology_files(name)}


@router.get("/topologies/{name}/files/content")
async def get_topology_file_content(name: str, path: str, download: bool = False):
    """Read (or download) a single rendered config file."""
    try:
        engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        abspath = engine.topology_file_abspath(name, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if download:
        return FileResponse(abspath, filename=os.path.basename(abspath))
    return {"name": name, "path": path, "content": engine.read_topology_file(name, path)}


# ── Per-node config ─────────────────────────────────────────────────────
@router.get("/topologies/{name}/nodes/{node_id}/config")
async def get_node_config(name: str, node_id: str):
    """Return a node's template + interfaces + config overrides for the sidebar."""
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    node = _find_node(doc, node_id)
    nf = nf_registry.get_nf(doc.get("core_type", "open5gs"), node.get("kind")) or {}
    return {
        "node": node,
        "template": nf,
        "config": node.get("config", {}),
        "interfaces": node.get("interfaces", {}),
    }


@router.put("/topologies/{name}/nodes/{node_id}/config")
async def update_node_config(name: str, node_id: str, req: NodeConfigUpdate):
    """Persist per-NF config overrides (and optionally interface edits)."""
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    node = _find_node(doc, node_id)
    if req.config is not None:
        node["config"] = req.config
    if req.interfaces is not None:
        node["interfaces"] = req.interfaces
    engine.save_topology(doc)
    return {"status": "saved", "node": node}


# ── Per-node container operations ───────────────────────────────────────
@router.get("/topologies/{name}/nodes/{node_id}/logs")
async def get_node_logs(name: str, node_id: str, tail: int = Query(200, ge=1, le=5000)):
    try:
        doc = engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    deployer = engine.get_deployer()
    cname = deployer.resolve_container(doc, node_id)
    try:
        logs = await _run_blocking(deployer.get_node_logs, cname, tail)
        return {"container": cname, "node_id": node_id, "logs": logs}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/topologies/{name}/nodes/{node_id}/restart")
async def restart_node(name: str, node_id: str):
    doc = _load_or_404(name)
    deployer = engine.get_deployer()
    cname = deployer.resolve_container(doc, node_id)
    try:
        return await _run_blocking(deployer.restart_node, cname)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/topologies/{name}/nodes/{node_id}/stop")
async def stop_node(name: str, node_id: str):
    doc = _load_or_404(name)
    deployer = engine.get_deployer()
    cname = deployer.resolve_container(doc, node_id)
    try:
        return await _run_blocking(deployer.stop_node, cname)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── WebSocket: node log streaming ───────────────────────────────────────
@router.websocket("/ws/topologies/{name}/nodes/{node_id}/logs")
async def ws_node_logs(websocket: WebSocket, name: str, node_id: str):
    """Stream a topology node's container logs in real time."""
    await websocket.accept()
    deployer = engine.get_deployer()
    try:
        doc = engine.load_topology(name)
        cname = deployer.resolve_container(doc, node_id)

        import threading
        import queue

        log_queue: "queue.Queue" = queue.Queue()

        def _stream():
            try:
                for line in deployer.stream_node_logs(cname):
                    log_queue.put(line)
            except Exception:
                log_queue.put(None)

        threading.Thread(target=_stream, daemon=True).start()

        while True:
            try:
                line = log_queue.get(timeout=0.5)
                if line is None:
                    break
                await websocket.send_text(line)
            except queue.Empty:
                try:
                    await websocket.send_text("")
                except Exception:
                    break
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── WebSocket: interactive shell (docker exec PTY) ──────────────────────
@router.websocket("/ws/topologies/{name}/nodes/{node_id}/shell")
async def ws_node_shell(websocket: WebSocket, name: str, node_id: str, shell: str = "sh"):
    """Attach an interactive PTY (docker exec) to a topology node's container."""
    await websocket.accept()

    import subprocess
    import select
    import os
    import pty

    try:
        doc = engine.load_topology(name)
        deployer = engine.get_deployer()
        cname = deployer.resolve_container(doc, node_id)
        deployer.client.containers.get(cname)  # raises NotFound if missing

        cmd = ["docker", "exec", "-i", cname, shell]
        master_fd, slave_fd = pty.openpty()
        proc = subprocess.Popen(
            cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, close_fds=True
        )
        os.close(slave_fd)

        await websocket.send_text(f"\r\n\x1b[32m[Connected to {cname} ({shell})]\x1b[0m\r\n")

        def _read_pty(fd):
            try:
                rlist, _, _ = select.select([fd], [], [], 1.0)
                if rlist:
                    return os.read(fd, 4096).decode("utf-8", errors="replace")
                return ""
            except (OSError, ValueError):
                return None

        async def _read_output():
            loop = asyncio.get_event_loop()
            while proc.poll() is None:
                try:
                    data = await loop.run_in_executor(None, _read_pty, master_fd)
                    if data:
                        await websocket.send_text(data)
                    else:
                        break
                except Exception:
                    break

        read_task = asyncio.create_task(_read_output())
        try:
            while True:
                data = await websocket.receive_text()
                if data:
                    os.write(master_fd, data.encode("utf-8"))
        except WebSocketDisconnect:
            pass
        finally:
            read_task.cancel()
            try:
                os.close(master_fd)
            except OSError:
                pass
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
    except Exception as e:  # noqa: BLE001
        try:
            await websocket.send_text(f"\r\n\x1b[31m[Error: {e}]\x1b[0m\r\n")
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── Helpers ─────────────────────────────────────────────────────────────
def _load_or_404(name: str) -> Dict:
    try:
        return engine.load_topology(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


def _find_node(doc: Dict, node_id: str) -> Dict:
    for n in doc.get("nodes", []):
        if n.get("id") == node_id:
            return n
    raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")


def _summary(doc: Dict) -> Dict:
    return {
        "name": doc.get("name"),
        "core_type": doc.get("core_type"),
        "node_count": len(doc.get("nodes", [])),
        "link_count": len(doc.get("links", [])),
    }
