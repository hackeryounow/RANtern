"""
Provision API routes — subscription provisioning and deletion.
"""

import threading
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger

from api.ws import ws_hub

router = APIRouter()


class ProvisionRequest(BaseModel):
    count: int
    core_network: str = "free5gc"
    action: str = "provision"  # "provision" or "delete"
    profile: Optional[str] = None


# Track running provision task
_provision_state = {
    "running": False,
    "task_id": None,
    "progress": 0,
    "total": 0,
    "failed": [],
    "status": "idle",  # idle | running | completed | failed
}
_provision_lock = threading.Lock()


@router.post("/provision")
async def start_provision(req: ProvisionRequest):
    """Start subscription provisioning or deletion."""
    with _provision_lock:
        if _provision_state["running"]:
            return {"error": "A provisioning task is already running"}

    import uuid
    task_id = str(uuid.uuid4())[:8]

    with _provision_lock:
        _provision_state.update({
            "running": True,
            "task_id": task_id,
            "progress": 0,
            "total": req.count,
            "failed": [],
            "status": "running",
        })

    # Run in background thread
    thread = threading.Thread(
        target=_run_provision,
        args=(task_id, req.count, req.core_network, req.action == "delete", req.profile),
        daemon=True,
    )
    thread.start()

    return {"task_id": task_id, "status": "started"}


@router.get("/provision/status")
async def get_provision_status():
    """Get current provisioning task status."""
    with _provision_lock:
        return dict(_provision_state)


def _run_provision(task_id: str, count: int, core_network: str, delete: bool, profile_name: str = None):
    """Background thread for provisioning."""
    try:
        from coresimrunner.config_loader import ConfigLoader
        from coresimrunner.core_network.core_network_factory import create_core_network

        config_loader = ConfigLoader(profile_name=profile_name)
        core = create_core_network(core_network, config_loader)
        if core is None:
            _update_provision_state(task_id, status="failed",
                                   error=f"Unsupported core network: {core_network}")
            return

        action = "delete" if delete else "provision"
        logger.info(f"[{task_id}] {action}ing {count} subscriptions on {core_network}")

        ws_hub.broadcast_sync("provision_start", {
            "task_id": task_id, "count": count, "action": action
        })

        if delete:
            success = core.delete_subscriptions(count)
        else:
            success = core.provision_subscriptions(count)

        with _provision_lock:
            _provision_state["progress"] = count
            _provision_state["status"] = "completed" if success else "failed"
            _provision_state["running"] = False

        ws_hub.broadcast_sync("provision_complete", {
            "task_id": task_id,
            "status": "completed" if success else "failed",
            "progress": count,
        })

    except Exception as e:
        logger.error(f"[{task_id}] Provision error: {e}")
        _update_provision_state(task_id, status="failed", error=str(e))
        ws_hub.broadcast_sync("provision_error", {
            "task_id": task_id, "error": str(e)
        })


def _update_provision_state(task_id: str, **kwargs):
    with _provision_lock:
        _provision_state.update(kwargs)
        if kwargs.get("status") in ("failed", "completed"):
            _provision_state["running"] = False
