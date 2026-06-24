"""
WebSocket hub for real-time event broadcasting.

Manages WebSocket connections and broadcasts events to all connected clients.
"""

import asyncio
import json
from typing import Set
from fastapi import WebSocket
from loguru import logger


class WebSocketHub:
    """Manages WebSocket connections and broadcasts events to all clients."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """Store the main event loop reference (call from async context at startup)."""
        self._loop = loop

    async def connect(self, websocket: WebSocket):
        """Accept and register a new WebSocket connection."""
        # Lazily capture the loop on first connect
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
        logger.info(f"WebSocket client disconnected ({len(self._connections)} total)")

    async def broadcast(self, event_type: str, data: dict):
        """Broadcast an event to all connected WebSocket clients."""
        message = json.dumps({"type": event_type, "data": data})
        disconnected = set()

        async with self._lock:
            for ws in self._connections:
                try:
                    await ws.send_text(message)
                except Exception:
                    disconnected.add(ws)

        # Clean up disconnected clients
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


# Global singleton
ws_hub = WebSocketHub()
