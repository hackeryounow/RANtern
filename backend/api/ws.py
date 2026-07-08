"""
WebSocket hub for real-time event broadcasting.

Manages WebSocket connections and broadcasts events to all connected clients.
Includes SIP call tracking (参考 VoxEra backend server.js).
"""

import asyncio
import json
from typing import Set, Dict, Any, Optional
from fastapi import WebSocket
from loguru import logger


class WebSocketHub:
    """Manages WebSocket connections and broadcasts events to all clients."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

        # SIP state tracking (参考 VoxEra)
        self._sip_owners: Dict[str, Dict[str, Any]] = {}  # extension -> {ws, tab_id, updated_at}
        self._active_calls: Dict[str, Dict[str, Any]] = {}  # call_id -> call details
        self._call_history: list = []

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """Store the main event loop reference (call from async context at startup)."""
        self._loop = loop

    async def connect(self, websocket: WebSocket):
        """Accept and register a new WebSocket connection."""
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logger.info(f"WebSocket client connected ({len(self._connections)} total)")

    async def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection."""
        async with self._lock:
            self._connections.discard(websocket)
        # Clean up SIP owner if this connection owned an extension
        self._clear_sip_owner_by_ws(websocket)
        logger.info(f"WebSocket client disconnected ({len(self._connections)} total)")

    async def broadcast(self, event_type: str, data: dict):
        """Broadcast an event to all connected WebSocket clients.
        Automatically injects server timestamp (ts) into data."""
        from datetime import datetime, timezone
        data_with_ts = dict(data)
        data_with_ts["ts"] = datetime.now(timezone.utc).isoformat()
        message = json.dumps({"type": event_type, "data": data_with_ts})
        disconnected = set()

        async with self._lock:
            for ws in self._connections:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.add(ws)

        if disconnected:
            async with self._lock:
                self._connections -= disconnected

    def broadcast_sync(self, event_type: str, data: dict):
        """Synchronous wrapper for broadcast (used from background threads)."""
        if self._loop is not None and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.broadcast(event_type, data), self._loop
            )
        else:
            logger.warning(f"Event loop not available, cannot broadcast {event_type}")

    # ── SIP Owner Management (参考 VoxEra) ──

    def _set_sip_owner(self, extension: str, websocket: WebSocket, tab_id: str = ""):
        prev = self._sip_owners.get(extension)
        if prev and prev.get("ws") != websocket:
            # Notify previous owner they lost ownership
            asyncio.create_task(self._send_to_ws(
                prev["ws"], "sip_owner_lost", {"extension": extension, "tabId": prev.get("tab_id", "")}
            ))
        self._sip_owners[extension] = {
            "ws": websocket,
            "tab_id": tab_id,
            "updated_at": asyncio.get_event_loop().time(),
        }
        logger.info(f"[SIP] Owner set: ext {extension} (tab {tab_id or 'n/a'})")

    def _clear_sip_owner(self, extension: str, websocket: WebSocket):
        owner = self._sip_owners.get(extension)
        if owner and owner.get("ws") == websocket:
            del self._sip_owners[extension]
            logger.info(f"[SIP] Owner cleared: ext {extension}")

    def _clear_sip_owner_by_ws(self, websocket: WebSocket):
        to_remove = [ext for ext, owner in self._sip_owners.items() if owner.get("ws") == websocket]
        for ext in to_remove:
            del self._sip_owners[ext]
            logger.info(f"[SIP] Owner cleared on disconnect: ext {ext}")

    def _emit_incoming_alert(self, callee: str, payload: dict):
        owner = self._sip_owners.get(callee)
        if owner and owner.get("ws"):
            asyncio.create_task(self._send_to_ws(owner["ws"], "sip_incoming_alert", payload))
            return 1
        return 0

    async def _send_to_ws(self, ws: WebSocket, event_type: str, data: dict):
        try:
            message = json.dumps({"type": event_type, "data": data})
            await ws.send_text(message)
        except Exception as e:
            logger.warning(f"[SIP] Failed to send to WS: {e}")

    # ── Call Tracking (参考 VoxEra) ──

    def _enrich_call(self, call_obj: dict) -> dict:
        duration = 0
        if call_obj.get("connected_at"):
            duration = int(asyncio.get_event_loop().time() - call_obj["connected_at"])
        return {**call_obj, "duration": duration}

    async def _broadcast_active_calls(self):
        calls = [self._enrich_call(c) for c in self._active_calls.values()]
        await self.broadcast("active_calls_update", {"calls": calls})

    def handle_sip_message(self, websocket: WebSocket, msg_type: str, payload: dict):
        """Handle SIP-related WebSocket messages from clients."""
        if msg_type == "sip_online":
            ext = str(payload.get("extension", "")).strip()
            tab_id = str(payload.get("tabId", "")).strip()
            if ext:
                self._set_sip_owner(ext, websocket, tab_id)
                asyncio.create_task(self.broadcast("sip_online", {"extension": ext, "tabId": tab_id}))

        elif msg_type == "sip_offline":
            ext = str(payload.get("extension", "")).strip()
            if ext:
                self._clear_sip_owner(ext, websocket)
            else:
                self._clear_sip_owner_by_ws(websocket)

        elif msg_type == "call_ringing":
            callee = str(payload.get("callee", "")).strip()
            caller = str(payload.get("caller", "Unknown")).strip()
            call_id = payload.get("id")
            if callee:
                delivered = self._emit_incoming_alert(callee, {"id": call_id, "caller": caller, "callee": callee})
                logger.info(f"[SIP] Ring alert: {caller} -> ext {callee} (delivered={delivered})")

        elif msg_type == "call_start":
            call_id = payload.get("id")
            if not call_id:
                return
            if call_id not in self._active_calls:
                self._active_calls[call_id] = {
                    "id": call_id,
                    "caller": payload.get("caller", "Unknown"),
                    "callee": payload.get("callee", "Unknown"),
                    "direction": payload.get("direction", "outbound"),
                    "status": payload.get("status", "calling"),
                    "connected_at": None,
                    "timestamp": asyncio.get_event_loop().time(),
                }
            else:
                self._active_calls[call_id]["status"] = payload.get("status", self._active_calls[call_id]["status"])
            asyncio.create_task(self._broadcast_active_calls())

        elif msg_type == "call_establish":
            call_id = payload.get("id")
            if not call_id:
                return
            call_obj = self._active_calls.get(call_id)
            if not call_obj:
                call_obj = {
                    "id": call_id,
                    "caller": payload.get("caller", "Unknown"),
                    "callee": payload.get("callee", "Unknown"),
                    "direction": payload.get("direction", "outbound"),
                    "status": "connected",
                    "connected_at": None,
                    "timestamp": asyncio.get_event_loop().time(),
                }
                self._active_calls[call_id] = call_obj

            call_obj["status"] = "connected"
            if not call_obj.get("connected_at"):
                call_obj["connected_at"] = asyncio.get_event_loop().time()
                asyncio.create_task(self.broadcast("call_connected", {"id": call_id, "connectedAt": call_obj["connected_at"]}))
                logger.info(f"[SIP] Call Connected (sync): {call_obj['caller']} -> {call_obj['callee']}")
            asyncio.create_task(self._broadcast_active_calls())

        elif msg_type == "call_end":
            call_id = payload.get("id")
            if not call_id:
                return
            call_obj = self._active_calls.pop(call_id, None)
            if not call_obj:
                return

            final_duration = int(payload.get("duration", 0))
            if call_obj.get("connected_at"):
                final_duration = int(asyncio.get_event_loop().time() - call_obj["connected_at"])

            history_call = {
                "id": call_obj["id"],
                "caller": call_obj["caller"],
                "callee": call_obj["callee"],
                "direction": call_obj["direction"],
                "status": payload.get("status", "completed"),
                "duration": final_duration,
                "timestamp": call_obj["timestamp"],
            }
            self._call_history.insert(0, history_call)
            if len(self._call_history) > 200:
                self._call_history.pop()

            logger.info(f"[SIP] Call End: {history_call['caller']} -> {history_call['callee']} [{history_call['status']}, {final_duration}s]")
            asyncio.create_task(self._broadcast_active_calls())
            asyncio.create_task(self.broadcast("call_end_broadcast", {"id": call_id, "callee": call_obj.get("callee"), "caller": call_obj.get("caller")}))
            asyncio.create_task(self.broadcast("call_history_update", {"calls": self._call_history[:50]}))


# Global singleton
ws_hub = WebSocketHub()
