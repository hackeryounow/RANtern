"""
Phone simulator API routes — REST control surface for simulated phones.

Each browser tab owns one phone instance, identified by a client-generated
phone id (kept in sessionStorage, so a reload re-attaches to the same
phone). Phones live in PhoneRegistry; every WebSocket event carries the
phone_id it belongs to:
  phone_state / phone_attach / phone_sip / phone_call / phone_traffic
"""

import re
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger

from coresimrunner.phone_sim.manager import PhoneRegistry, PhoneSessionManager

router = APIRouter()

_PHONE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _validate(phone_id: str):
    if not _PHONE_ID_RE.match(phone_id):
        raise HTTPException(status_code=400, detail="invalid phone id")


def _get(phone_id: str) -> PhoneSessionManager:
    _validate(phone_id)
    mgr = PhoneRegistry.get(phone_id)
    if mgr is None:
        raise HTTPException(status_code=404, detail="unknown phone id — acquire first")
    return mgr


class SimConfig(BaseModel):
    imsi: Optional[str] = None
    ki: Optional[str] = None
    opc: Optional[str] = None
    msisdn: Optional[str] = None
    mcc: Optional[str] = None
    mnc: Optional[str] = None
    core_address: Optional[str] = None
    pcscf_address: Optional[str] = None
    upf_address: Optional[str] = None
    gnb_address: Optional[str] = None
    sip_password: Optional[str] = None
    auto_answer: Optional[bool] = None


class AirplaneRequest(BaseModel):
    enabled: bool
    sim: Optional[SimConfig] = None


class DialRequest(BaseModel):
    callee: str


class AutoAnswerRequest(BaseModel):
    enabled: bool = True


class PingRequest(BaseModel):
    target: Optional[str] = "8.8.8.8"


class TrafficRequest(BaseModel):
    burst: Optional[int] = 20
    target: Optional[str] = "8.8.8.8"
    port: Optional[int] = 33434


@router.get("/phones")
async def phones_list():
    """List all live simulated phones (one line each)."""
    return {"phones": [mgr.brief() for mgr in PhoneRegistry.all()]}


@router.post("/phones/{phone_id}/acquire")
async def phone_acquire(phone_id: str):
    """Create (or re-acquire after reload) this tab's phone instance."""
    _validate(phone_id)
    mgr = PhoneRegistry.acquire(phone_id)
    return {
        "phone_id": phone_id,
        "defaults": mgr.defaults(),
        "state": mgr.get_state(),
    }


@router.delete("/phones/{phone_id}")
async def phone_release(phone_id: str):
    """Detach and remove the phone from the registry."""
    _validate(phone_id)
    return {"phone_id": phone_id, "released": PhoneRegistry.release(phone_id)}


@router.get("/phones/{phone_id}/state")
async def phone_state(phone_id: str):
    """Full phone state snapshot (airplane, phase, sessions, SIP, call, traffic)."""
    return _get(phone_id).get_state()


@router.get("/phones/{phone_id}/defaults")
async def phone_defaults(phone_id: str):
    """SIM panel prefills derived from the active profile (+ slot offset)."""
    return _get(phone_id).defaults()


@router.post("/phones/{phone_id}/airplane")
async def phone_airplane(phone_id: str, req: AirplaneRequest):
    """Toggle airplane mode. OFF starts attach with the provided SIM config."""
    mgr = _get(phone_id)
    sim = req.sim.model_dump() if req.sim else None
    return mgr.set_airplane(req.enabled, sim)


@router.post("/phones/{phone_id}/dial")
async def phone_dial(phone_id: str, req: DialRequest):
    """Place an IMS call (INVITE via P-CSCF over the GTP-U tunnel)."""
    mgr = _get(phone_id)
    if not req.callee.strip():
        raise HTTPException(status_code=400, detail="callee is required")
    try:
        return mgr.dial(req.callee.strip())
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phones/{phone_id}/hangup")
async def phone_hangup(phone_id: str):
    """Hang up the active call (CANCEL or BYE)."""
    return _get(phone_id).hangup()


@router.post("/phones/{phone_id}/answer")
async def phone_answer(phone_id: str):
    """Pick up a ringing incoming call (sends the held 200 OK)."""
    mgr = _get(phone_id)
    try:
        return mgr.answer()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phones/{phone_id}/reject")
async def phone_reject(phone_id: str):
    """Decline a ringing incoming call (486 Busy Here)."""
    mgr = _get(phone_id)
    try:
        return mgr.reject()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phones/{phone_id}/auto-answer")
async def phone_auto_answer(phone_id: str, req: AutoAnswerRequest):
    """Toggle headless auto-answer for incoming calls (interval tests)."""
    return _get(phone_id).set_auto_answer(req.enabled)


@router.post("/phones/{phone_id}/ping")
def phone_ping(phone_id: str, req: PingRequest):
    """ICMP echo through the internet GTP-U tunnel (connectivity probe).
    Sync def: the (up to 3s) reply wait runs in FastAPI's threadpool."""
    logger.info(f"[phone {phone_id}] ping request target={req.target}")
    return _get(phone_id).ping(req.target or "8.8.8.8")


@router.post("/phones/{phone_id}/traffic")
async def phone_traffic(phone_id: str, req: TrafficRequest):
    """Send an uplink UDP burst through the internet GTP-U tunnel.
    Live UL/DL counters stream over the phone_traffic WebSocket event."""
    return _get(phone_id).send_traffic(
        burst=req.burst or 20, target=req.target or "8.8.8.8",
        port=req.port or 33434)
