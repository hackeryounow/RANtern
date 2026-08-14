"""
Phone simulator API routes — REST control surface for the simulated phone.

State/progress events are pushed over the existing WebSocket hub:
  phone_state / phone_attach / phone_sip / phone_call / phone_traffic
"""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger

from coresimrunner.phone_sim.manager import PhoneSessionManager

router = APIRouter()


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


@router.get("/phone/state")
async def phone_state():
    """Full phone state snapshot (airplane, phase, sessions, SIP, call, traffic)."""
    return PhoneSessionManager.get_instance().get_state()


@router.get("/phone/defaults")
async def phone_defaults():
    """SIM panel prefills derived from the active profile."""
    return PhoneSessionManager.get_instance().defaults()


@router.post("/phone/airplane")
async def phone_airplane(req: AirplaneRequest):
    """Toggle airplane mode. OFF starts attach with the provided SIM config."""
    mgr = PhoneSessionManager.get_instance()
    sim = req.sim.model_dump() if req.sim else None
    return mgr.set_airplane(req.enabled, sim)


@router.post("/phone/dial")
async def phone_dial(req: DialRequest):
    """Place an IMS call (INVITE via P-CSCF over the GTP-U tunnel)."""
    mgr = PhoneSessionManager.get_instance()
    if not req.callee.strip():
        raise HTTPException(status_code=400, detail="callee is required")
    try:
        return mgr.dial(req.callee.strip())
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phone/hangup")
async def phone_hangup():
    """Hang up the active call (CANCEL or BYE)."""
    return PhoneSessionManager.get_instance().hangup()


@router.post("/phone/answer")
async def phone_answer():
    """Pick up a ringing incoming call (sends the held 200 OK)."""
    mgr = PhoneSessionManager.get_instance()
    try:
        return mgr.answer()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phone/reject")
async def phone_reject():
    """Decline a ringing incoming call (486 Busy Here)."""
    mgr = PhoneSessionManager.get_instance()
    try:
        return mgr.reject()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/phone/auto-answer")
async def phone_auto_answer(req: AutoAnswerRequest):
    """Toggle headless auto-answer for incoming calls (interval tests)."""
    return PhoneSessionManager.get_instance().set_auto_answer(req.enabled)


@router.post("/phone/ping")
def phone_ping(req: PingRequest):
    """ICMP echo through the internet GTP-U tunnel (connectivity probe).
    Sync def: the (up to 3s) reply wait runs in FastAPI's threadpool."""
    logger.info(f"[phone] ping request target={req.target}")
    return PhoneSessionManager.get_instance().ping(req.target or "8.8.8.8")


@router.post("/phone/traffic")
async def phone_traffic(req: TrafficRequest):
    """Send an uplink UDP burst through the internet GTP-U tunnel.
    Live UL/DL counters stream over the phone_traffic WebSocket event."""
    return PhoneSessionManager.get_instance().send_traffic(
        burst=req.burst or 20, target=req.target or "8.8.8.8",
        port=req.port or 33434)
