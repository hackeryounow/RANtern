"""
Core Network Management API routes.

Provides endpoints for:
- Deploying/undeploying core networks
- Container status monitoring
- Log viewing & streaming
- Interactive shell access
- NF configuration updates
- Packet capture
"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from loguru import logger

router = APIRouter()


# ── Request / Response Models ──


class DeployRequest(BaseModel):
    type: str = Field(..., description="Core network type: free5gc, open5gs, oai-cn5g, custom")


class UndeployRequest(BaseModel):
    type: str


class NFConfigUpdate(BaseModel):
    image: Optional[str] = None
    env: Optional[dict] = None


class CaptureStartRequest(BaseModel):
    src_nf: str
    dst_nf: str
    src_container: Optional[str] = ""
    dst_container: Optional[str] = ""


class CaptureStopRequest(BaseModel):
    session_id: str


# ── Deploy / Undeploy ──


@router.get("/core/types")
async def list_core_types():
    """List available core network types."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    return {"types": mgr.list_network_types()}


@router.post("/core/deploy")
async def deploy_core(req: DeployRequest):
    """Deploy a core network."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        result = mgr.deploy(req.type)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/core/undeploy")
async def undeploy_core(req: UndeployRequest):
    """Undeploy a core network."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        result = mgr.undeploy(req.type)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Container Status ──


@router.get("/core/status")
async def get_core_status(type: Optional[str] = None):
    """Get status of all core-network NF containers."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        statuses = mgr.get_nf_status(type)
        active_type = mgr.get_active_type()
        return {"containers": statuses, "active_type": active_type}
    except Exception as e:
        logger.error(f"Error getting core status: {e}")
        return {"containers": [], "active_type": None, "error": str(e)}


# ── Topology ──


@router.get("/core/topology")
async def get_topology(type: Optional[str] = None):
    """Get topology graph data for React Flow."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        return mgr.get_topology(type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── NF Logs ──


@router.get("/core/nf/{name}/logs")
async def get_nf_logs(name: str, tail: int = Query(200, ge=1, le=5000)):
    """Get recent logs from an NF container."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        logs = mgr.get_nf_logs(name, tail=tail)
        return {"container": name, "logs": logs}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── NF Restart ──


@router.post("/core/nf/{name}/restart")
async def restart_nf(name: str):
    """Restart a single NF container."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        return mgr.restart_nf(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── NF Config Update ──


@router.put("/core/nf/{name}/config")
async def update_nf_config(name: str, req: NFConfigUpdate):
    """Update NF config (image/env), then restart container."""
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()
    try:
        return mgr.update_nf_config(name, image=req.image, env=req.env)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Packet Capture ──


@router.post("/core/capture/start")
async def start_capture(req: CaptureStartRequest):
    """Start packet capture between two NFs."""
    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    try:
        result = svc.start_capture(
            src_nf=req.src_nf,
            dst_nf=req.dst_nf,
            src_container=req.src_container or "",
            dst_container=req.dst_container or "",
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/core/capture/stop")
async def stop_capture(req: CaptureStopRequest):
    """Stop an active capture session."""
    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    try:
        return svc.stop_capture(req.session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/core/capture/summary/{session_id}")
async def get_capture_summary(session_id: str, max_packets: int = Query(100, ge=1, le=1000)):
    """Get decoded packet summary for browser display."""
    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    try:
        return svc.get_capture_summary(session_id, max_packets=max_packets)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/core/capture/download/{session_id}")
async def download_capture(session_id: str):
    """Download pcap file."""
    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    try:
        pcap_path = svc.get_pcap_path(session_id)
        return FileResponse(
            pcap_path,
            media_type="application/vnd.tcpdump.pcap",
            filename=f"{session_id}.pcap",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/core/capture/sessions")
async def list_capture_sessions():
    """List all capture sessions."""
    from coresimrunner.packet_capture import get_packet_capture_service
    svc = get_packet_capture_service()
    return {"sessions": svc.list_sessions()}


# ── WebSocket: Log Streaming ──


@router.websocket("/ws/core/nf/{name}/logs")
async def ws_nf_logs(websocket: WebSocket, name: str):
    """Stream container logs in real-time via WebSocket."""
    await websocket.accept()
    from coresimrunner.core_network_manager import get_core_network_manager
    mgr = get_core_network_manager()

    try:
        # Send initial batch
        logs = mgr.get_nf_logs(name, tail=50)
        for line in logs:
            await websocket.send_text(line)

        # Stream new lines
        import threading
        import queue

        log_queue = queue.Queue()

        def _stream():
            try:
                for line in mgr.stream_nf_logs(name):
                    log_queue.put(line)
            except Exception:
                log_queue.put(None)

        thread = threading.Thread(target=_stream, daemon=True)
        thread.start()

        while True:
            try:
                line = log_queue.get(timeout=0.5)
                if line is None:
                    break
                await websocket.send_text(line)
            except queue.Empty:
                # Send ping to keep alive
                try:
                    await websocket.send_text("")
                except Exception:
                    break
            except Exception:
                break

    except WebSocketDisconnect:
        pass
    except ValueError as e:
        await websocket.send_text(json.dumps({"error": str(e)}))
    except Exception as e:
        logger.error(f"WebSocket log stream error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── WebSocket: Interactive Shell ──


@router.websocket("/ws/core/nf/{name}/shell")
async def ws_nf_shell(websocket: WebSocket, name: str, shell: str = "bash"):
    """Interactive shell into a container via WebSocket."""
    await websocket.accept()

    import subprocess
    import select
    import os
    import pty

    try:
        # Check container exists
        from coresimrunner.core_network_manager import get_core_network_manager
        mgr = get_core_network_manager()
        mgr.client.containers.get(name)  # raises NotFound if missing

        # Start docker exec with interactive TTY
        cmd = ["docker", "exec", "-i", name, shell]
        master_fd, slave_fd = pty.openpty()

        proc = subprocess.Popen(
            cmd,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
        )
        os.close(slave_fd)

        await websocket.send_text(f"\r\n\x1b[32m[Connected to {name} ({shell})]\x1b[0m\r\n")

        async def _read_output():
            """Read from PTY master and send to websocket."""
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

        def _read_pty(fd):
            """Blocking read from PTY."""
            try:
                rlist, _, _ = select.select([fd], [], [], 1.0)
                if rlist:
                    data = os.read(fd, 4096)
                    return data.decode("utf-8", errors="replace")
                return ""
            except (OSError, ValueError):
                return None

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
            os.close(master_fd)
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()

    except Exception as e:
        await websocket.send_text(f"\r\n\x1b[31m[Error: {e}]\x1b[0m\r\n")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
