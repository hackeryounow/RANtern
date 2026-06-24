"""
Test API routes — UE test management, stop, latency stats, export, history.
"""

import os
import io
import csv
import json
import math
import threading
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from loguru import logger

from api.ws import ws_hub

router = APIRouter()

# ────────────────────────────── State ──────────────────────────────
_test_state = {
    "running": False,
    "mode": None,          # "5g" | "4g"
    "core_network": None,
    "parameters": {},
    "start_time": None,
    "end_time": None,
    "cancel_event": None,  # threading.Event
    "runner": None,        # UETestRunner or Integrated4GGNB
    "ues": [],             # list of per-UE dicts
    "ngap_stats": {},
    "latency_stats": {},
    "error": None,
}
_test_lock = threading.Lock()

_HISTORY_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "test_history"
)
os.makedirs(_HISTORY_DIR, exist_ok=True)


# ────────────────────────────── Models ──────────────────────────────
class TestStartRequest(BaseModel):
    count: int = 10
    core_network: str = "free5gc"
    profile: Optional[str] = None
    gnb_address: Optional[str] = None
    core_address: Optional[str] = None
    dnn: Optional[str] = None
    plmn: Optional[str] = None
    ki: Optional[str] = None
    opc: Optional[str] = None
    tac: Optional[str] = None
    start_imsi: Optional[str] = None
    log_level: Optional[str] = None
    # 4G specific
    enb_address: Optional[str] = None
    apn: Optional[str] = None
    mme_port: Optional[int] = None
    enb_id: Optional[int] = None
    enb_cell_id: Optional[int] = None


# ────────────────────────────── Start / Stop ──────────────────────────────

@router.post("/test/5g")
async def start_5g_test(req: TestStartRequest):
    """Start a 5G UE test."""
    with _test_lock:
        if _test_state["running"]:
            return {"error": "A test is already running"}
        cancel_event = threading.Event()
        _test_state.update({
            "running": True, "mode": "5g", "core_network": req.core_network,
            "cancel_event": cancel_event, "start_time": datetime.now(timezone.utc).isoformat(),
            "end_time": None, "ues": [], "ngap_stats": {}, "latency_stats": {}, "error": None,
            "parameters": req.dict(),
        })

    t = threading.Thread(target=_run_5g_test, args=(req, cancel_event), daemon=True)
    t.start()
    return {"status": "started", "mode": "5g"}


@router.post("/test/4g")
async def start_4g_test(req: TestStartRequest):
    """Start a 4G UE test."""
    with _test_lock:
        if _test_state["running"]:
            return {"error": "A test is already running"}
        cancel_event = threading.Event()
        _test_state.update({
            "running": True, "mode": "4g", "core_network": req.core_network,
            "cancel_event": cancel_event, "start_time": datetime.now(timezone.utc).isoformat(),
            "end_time": None, "ues": [], "ngap_stats": {}, "latency_stats": {}, "error": None,
            "parameters": req.dict(),
        })

    t = threading.Thread(target=_run_4g_test, args=(req, cancel_event), daemon=True)
    t.start()
    return {"status": "started", "mode": "4g"}


@router.post("/test/stop")
async def stop_test():
    """Stop the currently running test."""
    with _test_lock:
        if not _test_state["running"]:
            return {"error": "No test is running"}
        cancel_event = _test_state.get("cancel_event")
        if cancel_event:
            cancel_event.set()
        # Immediately shut down gNB/eNB threads
        runner = _test_state.get("runner")
        if runner:
            try:
                runner.close()
            except Exception as e:
                logger.error(f"Error closing runner: {e}")
        _test_state["running"] = False
        _test_state["end_time"] = datetime.now(timezone.utc).isoformat()

    # Compute final stats and persist
    _finalize_test()
    return {"status": "stopped"}


@router.get("/test/status")
async def get_test_status():
    """Get current test state."""
    with _test_lock:
        return {
            "running": _test_state["running"],
            "mode": _test_state["mode"],
            "core_network": _test_state["core_network"],
            "start_time": _test_state["start_time"],
            "end_time": _test_state["end_time"],
            "ue_count": len(_test_state["ues"]),
            "error": _test_state["error"],
        }


# ────────────────────────────── Data endpoints ──────────────────────────────

@router.get("/test/ues")
async def get_test_ues():
    """Get per-UE detail list."""
    with _test_lock:
        return _test_state["ues"]


@router.get("/test/ngap-stats")
async def get_ngap_stats():
    """Get NGAP message counters."""
    with _test_lock:
        return _test_state["ngap_stats"]


@router.get("/test/latency-stats")
async def get_latency_stats():
    """Get box plot data: registration, session, total latency distributions."""
    with _test_lock:
        return _test_state["latency_stats"]


# ────────────────────────────── Per-UE Action endpoints ──────────────────────────────

class ReleasePduRequest(BaseModel):
    pdu_session_id: int = 1


@router.post("/test/ue/{ue_index}/release-pdu")
async def release_pdu_session(ue_index: int, req: ReleasePduRequest):
    """Release a specific PDU session for a single UE."""
    logger.info(f"[API] Received release-pdu request for UE {ue_index}, PDU session {req.pdu_session_id}")
    with _test_lock:
        runner = _test_state.get("runner")
        if not runner or not getattr(runner, 'gnb', None):
            logger.warning(f"[API] No active test runner")
            return {"error": "No active test runner"}
        if ue_index < 0 or ue_index >= len(runner.gnb.ues):
            logger.warning(f"[API] Invalid UE index: {ue_index}")
            return {"error": f"Invalid UE index: {ue_index}"}
        logger.info(f"[API] Starting background thread for release-pdu")
    
    t = threading.Thread(
        target=_execute_ue_action,
        args=(ue_index, "release-pdu", {"pdu_session_id": req.pdu_session_id}),
        daemon=True
    )
    t.start()
    return {"status": "started", "action": "release-pdu", "ue_index": ue_index}


@router.post("/test/ue/{ue_index}/user-inactivity")
async def trigger_user_inactivity(ue_index: int):
    """Trigger UE context release (user-inactivity) then Service Request."""
    with _test_lock:
        runner = _test_state.get("runner")
        if not runner or not getattr(runner, 'gnb', None):
            return {"error": "No active test runner"}
        if ue_index < 0 or ue_index >= len(runner.gnb.ues):
            return {"error": f"Invalid UE index: {ue_index}"}
    
    t = threading.Thread(
        target=_execute_ue_action,
        args=(ue_index, "user-inactivity", {}),
        daemon=True
    )
    t.start()
    return {"status": "started", "action": "user-inactivity", "ue_index": ue_index}


@router.post("/test/ue/{ue_index}/deregister")
async def deregister_ue(ue_index: int):
    """Deregister a single UE and remove from the list."""
    with _test_lock:
        runner = _test_state.get("runner")
        if not runner or not getattr(runner, 'gnb', None):
            return {"error": "No active test runner"}
        if ue_index < 0 or ue_index >= len(runner.gnb.ues):
            return {"error": f"Invalid UE index: {ue_index}"}
    
    t = threading.Thread(
        target=_execute_ue_action,
        args=(ue_index, "deregister", {}),
        daemon=True
    )
    t.start()
    return {"status": "started", "action": "deregister", "ue_index": ue_index}


def _execute_ue_action(ue_index: int, action: str, params: dict):
    """Background thread to execute a per-UE action (release-pdu, user-inactivity, deregister)."""
    logger.info(f"[Action] Background thread started for action={action}, ue_index={ue_index}")
    try:
        with _test_lock:
            runner = _test_state.get("runner")
            if not runner or not runner.gnb:
                logger.warning(f"[Action] No active runner or gnb")
                return
            ue = runner.gnb.ues[ue_index]
            gnb = runner.gnb
            core_network = _test_state.get("core_network", "free5gc")
        
        ue_id = getattr(ue, 'supi', f'UE#{ue_index}')
        logger.info(f"[Action] Got UE {ue_id}, broadcasting progress event")
        ws_hub.broadcast_sync("ue_action_progress", {
            "ue_index": ue_index, "action": action, "status": "started",
            "message": f"{action} started for {ue_id}"
        })
        
        if action == "release-pdu":
            pdu_sess_id = params.get("pdu_session_id", 1)
            logger.info(f"[Action] Building PDU Session Release Request for session {pdu_sess_id}")
            
            # Check if sender thread is alive
            if gnb.sender_thread and gnb.sender_thread.is_alive():
                logger.info(f"[Action] Sender thread is alive")
            else:
                logger.warning(f"[Action] Sender thread is NOT alive! Restarting...")
                import threading
                gnb.sender_thread = threading.Thread(target=gnb._sender, daemon=True)
                gnb.sender_thread.start()
            
            msg = ue.send_pdu_session_release_request(pdu_sess_id)
            logger.info(f"[Action] Message built, type={type(msg)}, putting in queue")
            gnb.message_queue.put(msg)
            logger.info(f"[Action] Message put in queue, queue size={gnb.message_queue.qsize()}")
            logger.info(f"[Action] Sent PDU Session Release Request for {ue_id}, session {pdu_sess_id}")
            
            # Wait for release to complete
            logger.info(f"[Action] Waiting for dnn_internet_connected to become False...")
            for i in range(60):  # 30s timeout
                if not ue.dnn_internet_connected:
                    logger.info(f"[Action] dnn_internet_connected is False after {i*0.5}s")
                    break
                time.sleep(0.5)
            
            if not ue.dnn_internet_connected:
                state = "success"
                msg_text = f"PDU session {pdu_sess_id} released for {ue_id}"
                logger.info(f"[Action] {msg_text}")
            else:
                state = "timeout"
                msg_text = f"PDU release timed out for {ue_id}"
                logger.warning(f"[Action] {msg_text}")
            
            _refresh_ue_list(runner)
            logger.info(f"[Action] Broadcasting ue_action_complete event")
            ws_hub.broadcast_sync("ue_action_complete", {
                "ue_index": ue_index, "action": action, "status": state, "message": msg_text
            })
        
        elif action == "user-inactivity":
            # Step 1: Release UE context (gNB-initiated)
            msg = ue.release_ue_context()
            gnb.message_queue.put(msg)
            logger.info(f"[Action] Sent UE Context Release Request for {ue_id}")
            
            # Wait for context release
            for _ in range(20):  # 10s timeout
                if ue.context_released:
                    break
                time.sleep(0.5)
            
            if not ue.context_released:
                ws_hub.broadcast_sync("ue_action_complete", {
                    "ue_index": ue_index, "action": action, "status": "failed",
                    "message": f"Context release timed out for {ue_id}"
                })
                return
            
            ws_hub.broadcast_sync("ue_action_progress", {
                "ue_index": ue_index, "action": action, "status": "context_released",
                "message": f"Context released for {ue_id}, waiting for paging..."
            })
            
            # Step 2: Wait for Paging (Open5GS) or skip (Free5GC)
            if core_network == "open5gs":
                logger.info(f"[Action] Waiting for Paging from Open5GS for {ue_id}")
                for _ in range(30):  # 15s timeout
                    if ue.paging_received:
                        break
                    time.sleep(0.5)
                if not ue.paging_received:
                    logger.warning(f"[Action] Paging not received for {ue_id}, proceeding anyway")
            
            # Step 3: Send Service Request
            ue.paging_received = False  # reset for next time
            msg = ue.send_service_request()
            gnb.message_queue.put(msg)
            logger.info(f"[Action] Sent Service Request for {ue_id}")
            
            # Wait for Service Accept
            for _ in range(60):  # 30s timeout
                if ue.service_accepted:
                    break
                time.sleep(0.5)
            
            if ue.service_accepted:
                state = "success"
                msg_text = f"Service Request accepted for {ue_id}"
                logger.info(f"[Action] {msg_text}")
            else:
                state = "timeout"
                msg_text = f"Service Request timed out for {ue_id}"
                logger.warning(f"[Action] {msg_text}")
            
            _refresh_ue_list(runner)
            ws_hub.broadcast_sync("ue_action_complete", {
                "ue_index": ue_index, "action": action, "status": state, "message": msg_text
            })
        
        elif action == "deregister":
            msg = ue.send_deregistration_request()
            gnb.message_queue.put(msg)
            logger.info(f"[Action] Sent Deregistration Request for {ue_id}")
            
            # Wait for deregistration + context release
            for _ in range(60):  # 30s timeout
                if not ue.registered:
                    break
                time.sleep(0.5)
            
            if not ue.registered:
                state = "success"
                msg_text = f"UE {ue_id} deregistered successfully"
                logger.info(f"[Action] {msg_text}")
            else:
                state = "timeout"
                msg_text = f"Deregistration timed out for {ue_id}"
                logger.warning(f"[Action] {msg_text}")
            
            # Remove UE from the list
            _remove_ue_from_list(runner, ue_index)
            ws_hub.broadcast_sync("ue_action_complete", {
                "ue_index": ue_index, "action": action, "status": state, "message": msg_text
            })
        
        else:
            logger.error(f"[Action] Unknown action: {action}")
    
    except Exception as e:
        logger.error(f"[Action] Error executing {action} for UE#{ue_index}: {e}")
        ws_hub.broadcast_sync("ue_action_complete", {
            "ue_index": ue_index, "action": action, "status": "error",
            "message": str(e)
        })


def _refresh_ue_list(runner):
    """Refresh the UE list in _test_state and broadcast update."""
    try:
        _collect_5g_results(runner)
    except Exception as e:
        logger.error(f"Error refreshing UE list: {e}")


def _remove_ue_from_list(runner, ue_index: int):
    """Remove a UE from the gNB's UE list and refresh _test_state."""
    try:
        with _test_lock:
            if runner.gnb and 0 <= ue_index < len(runner.gnb.ues):
                removed_ue = runner.gnb.ues[ue_index]
                logger.info(f"[Action] Removing UE {removed_ue.supi} from list")
        _refresh_ue_list(runner)
        ws_hub.broadcast_sync("ue_removed", {"ue_index": ue_index})
    except Exception as e:
        logger.error(f"Error removing UE from list: {e}")


# ────────────────────────────── Export endpoints ──────────────────────────────

@router.get("/test/export/ues")
async def export_ues_csv():
    """Export UE detail table as CSV."""
    with _test_lock:
        ues = list(_test_state["ues"])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "imsi", "dnn", "ipv4", "gtp_teid",
        "ran_ue_ngap_id", "amf_ue_ngap_id", "state",
        "reg_latency_ms", "session_latency_ms", "total_latency_ms",
    ])
    for ue in ues:
        lat = ue.get("latency_ms", {})
        writer.writerow([
            ue.get("imsi", ""),
            ue.get("dnn", ""),
            ue.get("ipv4", ""),
            ue.get("gtp_teid", ""),
            ue.get("ran_ue_ngap_id", ""),
            ue.get("amf_ue_ngap_id", ""),
            ue.get("state", ""),
            lat.get("registration", ""),
            lat.get("pdu_session_1", ""),
            lat.get("total", ""),
        ])

    output.seek(0)
    filename = f"ue_details_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/test/export/latency-stats")
async def export_latency_stats_json():
    """Export box plot data as JSON file."""
    with _test_lock:
        data = dict(_test_state["latency_stats"])

    content = json.dumps(data, indent=2)
    filename = f"latency_stats_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/test/export/full")
async def export_full_test_json():
    """Export complete test record as JSON."""
    with _test_lock:
        record = _build_history_record()

    content = json.dumps(record, indent=2, default=str)
    filename = f"test_record_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ────────────────────────────── History endpoints ──────────────────────────────

@router.get("/test/history")
async def list_test_history():
    """List all past test records sorted by timestamp (newest first)."""
    records = []
    for f in sorted(os.listdir(_HISTORY_DIR), reverse=True):
        if f.endswith(".json"):
            path = os.path.join(_HISTORY_DIR, f)
            try:
                with open(path, "r") as fh:
                    data = json.load(fh)
                records.append({
                    "id": f[:-5],  # strip .json
                    "timestamp": data.get("timestamp"),
                    "mode": data.get("mode"),
                    "core_network": data.get("core_network"),
                    "ue_count": len(data.get("ue_details", [])),
                })
            except Exception:
                pass
    return records


@router.get("/test/history/{test_id}")
async def get_test_history(test_id: str):
    """Get a specific past test record."""
    path = os.path.join(_HISTORY_DIR, f"{test_id}.json")
    if not os.path.exists(path):
        return {"error": "Record not found"}
    with open(path, "r") as f:
        return json.load(f)


@router.delete("/test/history/{test_id}")
async def delete_test_history(test_id: str):
    """Delete a single test history record."""
    filename = f"{test_id}.json"
    path = os.path.join(_HISTORY_DIR, filename)
    if not os.path.exists(path):
        return {"error": "Record not found"}
    try:
        os.remove(path)
        logger.info(f"Deleted history record: {filename}")
        return {"status": "deleted", "id": test_id}
    except Exception as e:
        logger.error(f"Failed to delete history record {filename}: {e}")
        return {"error": str(e)}


@router.delete("/test/history")
async def clear_test_history():
    """Delete all test history records."""
    deleted = 0
    try:
        for f in os.listdir(_HISTORY_DIR):
            if f.endswith(".json"):
                os.remove(os.path.join(_HISTORY_DIR, f))
                deleted += 1
        logger.info(f"Cleared {deleted} history records")
        return {"status": "cleared", "deleted": deleted}
    except Exception as e:
        logger.error(f"Failed to clear history: {e}")
        return {"error": str(e)}


# ────────────────────────────── Background runners ──────────────────────────────

def _run_5g_test(req: TestStartRequest, cancel_event: threading.Event):
    """Background thread for 5G test."""
    try:
        from coresimrunner.config_loader import ConfigLoader
        from coresimrunner.ue_test_runner import UETestRunner

        config_loader = ConfigLoader(profile_name=req.profile)
        network_config = config_loader.get_network_config(req.core_network)

        plmn = req.plmn or config_loader.get_plmn()
        mcc = plmn[:3]
        mnc = plmn[3:]
        ki = req.ki or config_loader.get("PERMANENT_KEY", "12341234123412341234123412340000")
        opc = req.opc or config_loader.get("OPC_VALUE", "71a121bb69baf3c0cc53fb5038a0131f")
        start_imsi = req.start_imsi or f"{network_config.get('initial_imsi_index', 1):010d}"
        gnb_address = req.gnb_address or config_loader.get("GNB_ADDRESS", "192.168.55.9")
        amf_address = req.core_address or config_loader.get_core_address()
        dnn = req.dnn or config_loader.get("DNN", "internet")
        tac = req.tac or config_loader.get("TAC", "000001")
        gnb_nr_cell_id = config_loader.get_int("GNB_NR_CELL_ID", 1)
        log_level = req.log_level or config_loader.get("LOG_LEVEL", "INFO")

        runner = UETestRunner(
            mcc=mcc, mnc=mnc, gnb_address=gnb_address, amf_address=amf_address,
            number_of_ues=req.count, start_imsi=start_imsi, ki=ki, opc=opc,
            dnn=dnn, tac=tac, gnb_nr_cell_id=gnb_nr_cell_id, log_level=log_level,
        )

        with _test_lock:
            _test_state["runner"] = runner

        # Broadcast test start
        ws_hub.broadcast_sync("test_start", {"mode": "5g", "count": req.count})

        runner.run_test(cancel_event=cancel_event)

        # Collect UE results
        _collect_5g_results(runner)

    except Exception as e:
        logger.error(f"5G test error: {e}")
        with _test_lock:
            _test_state["error"] = str(e)

    finally:
        with _test_lock:
            _test_state["running"] = False
            _test_state["end_time"] = datetime.now(timezone.utc).isoformat()
        _finalize_test()
        ws_hub.broadcast_sync("test_complete", {"mode": "5g"})


def _run_4g_test(req: TestStartRequest, cancel_event: threading.Event):
    """Background thread for 4G test."""
    try:
        from coresimrunner.config_loader import ConfigLoader
        from coresimrunner.integration.integrated_4g_gnb import Integrated4GGNB
        from coresimrunner.integration.integrated_4g_ue import _format_sgw_addr, _format_teid

        config_loader = ConfigLoader(profile_name=req.profile)
        network_config = config_loader.get_network_config(req.core_network)

        plmn = req.plmn or config_loader.get_plmn()
        mcc = plmn[:3]
        mnc = plmn[3:]
        ki = req.ki or config_loader.get("PERMANENT_KEY", "12341234123412341234123412340000")
        opc = req.opc or config_loader.get("OPC_VALUE", "71a121bb69baf3c0cc53fb5038a0131f")
        start_imsi = req.start_imsi or f"{network_config.get('initial_imsi_index', 1):010d}"
        enb_address = req.enb_address or config_loader.get("ENB_ADDRESS", "192.168.55.9")
        mme_address = req.core_address or config_loader.get_core_address()
        mme_port = req.mme_port if req.mme_port is not None else config_loader.get_int("MME_PORT", 36412)
        enb_id = req.enb_id if req.enb_id is not None else config_loader.get_int("ENB_ID", 1)
        enb_cell_id = req.enb_cell_id if req.enb_cell_id is not None else config_loader.get_int("ENB_CELL_ID", 1000000)
        tac = req.tac or config_loader.get("TAC", "000001")
        apn = req.apn or config_loader.get("APN", "internet")
        imeisv = config_loader.get("IMEISV", "4370816125816151")
        log_level = req.log_level or config_loader.get("LOG_LEVEL", "INFO")

        runner = Integrated4GGNB(
            mcc=mcc, mnc=mnc, enb_name="CoreSim-4G-eNB", enb_ip=enb_address,
            mme_ip=mme_address, mme_port=mme_port, enb_id=enb_id, enb_cell_id=enb_cell_id,
            tac=tac, plmn=plmn, ki=ki, opc=opc, apn=apn, imeisv=imeisv,
            number_of_ues=req.count, start_imsi=start_imsi, log_level=log_level,
            config_loader=config_loader,
        )

        with _test_lock:
            _test_state["runner"] = runner

        ws_hub.broadcast_sync("test_start", {"mode": "4g", "count": req.count})

        runner.run()

        # Monitor progress
        for _ in range(60):
            if cancel_event.is_set():
                logger.warning("4G test cancelled by user")
                break
            stats = runner.get_registration_stats()
            total = stats.get("total", 0)
            registered = stats.get("registered", 0)
            if registered == total > 0:
                break
            time.sleep(2)

        # Shut down runner threads (acceptor/sender) if cancelled
        if cancel_event.is_set():
            try:
                runner.close()
            except Exception as e:
                logger.error(f"Error closing 4G runner: {e}")

        # Collect 4G results
        _collect_4g_results(runner)

    except Exception as e:
        logger.error(f"4G test error: {e}")
        with _test_lock:
            _test_state["error"] = str(e)

    finally:
        with _test_lock:
            _test_state["running"] = False
            _test_state["end_time"] = datetime.now(timezone.utc).isoformat()
        _finalize_test()
        ws_hub.broadcast_sync("test_complete", {"mode": "4g"})


# ────────────────────────────── Result collection ──────────────────────────────

def _collect_5g_results(runner):
    """Collect per-UE results from a 5G UETestRunner."""
    ues = []
    if runner.gnb and runner.gnb.ues:
        for i, ue in enumerate(runner.gnb.ues):
            reg_lat = None
            sess_lat = None
            total_lat = None

            if ue.t_auth_sec and ue.t_registered:
                reg_lat = round((ue.t_registered - ue.t_auth_sec) * 1000, 1)
            if ue.t_registered and ue.t_dnn1_done:
                sess_lat = round((ue.t_dnn1_done - ue.t_registered) * 1000, 1)
            if ue.t_start and ue.t_dnn1_done:
                total_lat = round((ue.t_dnn1_done - ue.t_start) * 1000, 1)

            # Determine UE state
            state = _determine_ue_state(ue)

            # Build PDU sessions list
            pdu_sessions = []
            if ue.dnn_internet_pdu_sess_id is not None:
                pdu_sessions.append({
                    "dnn": "internet",
                    "pdu_session_id": ue.dnn_internet_pdu_sess_id,
                    "ipv4": ue.dnn_ipv4 or "N/A",
                    "teid": ue.dnn_gtp_teid or "N/A",
                    "state": "established" if ue.dnn_internet_connected else "released",
                })
            if ue.dnn2_ims_pdu_sess_id is not None:
                pdu_sessions.append({
                    "dnn": "ims",
                    "pdu_session_id": ue.dnn2_ims_pdu_sess_id,
                    "ipv4": ue.dnn2_ipv4 or "N/A",
                    "teid": getattr(ue, "dnn2_gtp_teid", None) or "N/A",
                    "state": "established" if ue.dnn2_ims_connected else "released",
                })

            ues.append({
                "imsi": f"{runner.mcc}{runner.mnc}{int(runner.start_imsi) + i:010d}",
                "dnn": runner.dnn,
                "ipv4": ue.dnn_ipv4 or "N/A",
                "gtp_teid": getattr(ue, "dnn_gtp_teid", None) or "N/A",
                "ran_ue_ngap_id": getattr(ue, "ran_ue_ngap_id", None) or i,
                "amf_ue_ngap_id": getattr(ue, "amf_ue_ngap_id", None) or "N/A",
                "state": state,
                "pdu_sessions": pdu_sessions,
                "latency_ms": {
                    "registration": reg_lat,
                    "pdu_session_1": sess_lat,
                    "total": total_lat,
                },
            })

    with _test_lock:
        _test_state["ues"] = ues
    ws_hub.broadcast_sync("test_ues_update", {"ues": ues})


def _determine_ue_state(ue) -> str:
    """Determine a human-readable UE state string from UE flags."""
    if ue.context_released and not ue.registered:
        return "context_released"
    if ue.service_accepted:
        return "service_accepted"
    if ue.dnn_internet_connected:
        return "pdu_established"
    if ue.dnn_internet_pdu_sess_id is not None and not ue.dnn_internet_connected:
        return "pdu_released"
    if ue.registered:
        return "registered"
    return "idle"


def _collect_4g_results(runner):
    """Collect per-UE results from a 4G Integrated4GGNB."""
    ues = []
    for ue in runner.ues:
        info = ue.get_session_info()
        ipv4 = info.get("ipv4") or "N/A"
        sgw_teid = "N/A"
        for b in info.get("bearers", []):
            if b.get("sgw_teid") is not None:
                sgw_teid = _format_teid(b["sgw_teid"]) if "_format_teid" in dir() else str(b["sgw_teid"])

        ues.append({
            "imsi": info.get("imsi", ""),
            "dnn": info.get("apn", "internet"),
            "ipv4": ipv4,
            "gtp_teid": sgw_teid,
            "ran_ue_ngap_id": info.get("enb_ue_s1ap_id", "N/A"),
            "amf_ue_ngap_id": info.get("mme_ue_s1ap_id", "N/A"),
            "state": "pdn_established" if ipv4 != "N/A" else "registered",
            "latency_ms": {
                "registration": info.get("reg_latency_ms"),
                "pdu_session_1": info.get("pdn_latency_ms"),
                "total": info.get("total_latency_ms"),
            },
        })

    with _test_lock:
        _test_state["ues"] = ues
    ws_hub.broadcast_sync("test_ues_update", {"ues": ues})


# ────────────────────────────── Box plot / history helpers ──────────────────────────────

def _compute_box_plot_stats(values: List[float]) -> Optional[Dict]:
    """Compute box plot statistics (min, Q1, median, Q3, max, outliers)."""
    if not values:
        return None
    values = sorted(values)
    n = len(values)

    def percentile(data, p):
        k = (len(data) - 1) * p / 100
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return data[int(k)]
        return data[f] * (c - k) + data[c] * (k - f)

    q1 = percentile(values, 25)
    median = percentile(values, 50)
    q3 = percentile(values, 75)
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    outliers = [v for v in values if v < lower_fence or v > upper_fence]
    inliers = [v for v in values if lower_fence <= v <= upper_fence]

    return {
        "min": round(inliers[0], 1) if inliers else round(values[0], 1),
        "q1": round(q1, 1),
        "median": round(median, 1),
        "q3": round(q3, 1),
        "max": round(inliers[-1], 1) if inliers else round(values[-1], 1),
        "outliers": [round(o, 1) for o in outliers],
    }


def _finalize_test():
    """Compute box plot stats and persist test history."""
    with _test_lock:
        ues = _test_state["ues"]

    # Extract latency arrays
    reg_vals = [u["latency_ms"]["registration"] for u in ues if u["latency_ms"].get("registration") is not None]
    sess_vals = [u["latency_ms"]["pdu_session_1"] for u in ues if u["latency_ms"].get("pdu_session_1") is not None]
    total_vals = [u["latency_ms"]["total"] for u in ues if u["latency_ms"].get("total") is not None]

    latency_stats = {}
    reg_stats = _compute_box_plot_stats(reg_vals)
    sess_stats = _compute_box_plot_stats(sess_vals)
    total_stats = _compute_box_plot_stats(total_vals)
    if reg_stats:
        latency_stats["registration"] = reg_stats
    if sess_stats:
        latency_stats["session"] = sess_stats
    if total_stats:
        latency_stats["total"] = total_stats

    with _test_lock:
        _test_state["latency_stats"] = latency_stats

    # Persist to history
    _save_history()


def _build_history_record() -> Dict[str, Any]:
    """Build a complete history record from current test state."""
    with _test_lock:
        return {
            "test_id": f"{_test_state.get('start_time', 'unknown')}_{_test_state.get('mode', 'unknown')}_{_test_state.get('core_network', 'unknown')}".replace(":", "-").replace(" ", "_"),
            "timestamp": _test_state.get("start_time"),
            "mode": _test_state.get("mode"),
            "core_network": _test_state.get("core_network"),
            "parameters": _test_state.get("parameters", {}),
            "ue_details": _test_state.get("ues", []),
            "latency_stats": _test_state.get("latency_stats", {}),
            "ngap_stats": _test_state.get("ngap_stats", {}),
            "start_time": _test_state.get("start_time"),
            "end_time": _test_state.get("end_time"),
        }


def _save_history():
    """Save current test record to history directory."""
    try:
        record = _build_history_record()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        mode = record.get("mode", "unknown")
        cn = record.get("core_network", "unknown")
        filename = f"{ts}_{mode}_{cn}.json"
        filepath = os.path.join(_HISTORY_DIR, filename)

        with open(filepath, "w") as f:
            json.dump(record, f, indent=2, default=str)

        logger.info(f"Test history saved: {filepath}")
    except Exception as e:
        logger.error(f"Failed to save test history: {e}")
