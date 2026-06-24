"""
FastAPI application entry point for CoreSimRunner.

Run with: uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import sys
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

# Ensure backend/ is on the Python path so both `api` and `coresimrunner` are importable
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from api.ws import ws_hub
from api.routes import provision, test, config, profiles

app = FastAPI(
    title="CoreSimRunner API",
    description="5G/4G Core Network Testing Platform",
    version="1.0.0",
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(provision.router, prefix="/api", tags=["Provision"])
app.include_router(test.router, prefix="/api", tags=["Test"])
app.include_router(config.router, prefix="/api", tags=["Config"])
app.include_router(profiles.router, prefix="/api", tags=["Profiles"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "CoreSimRunner"}


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_hub.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_hub.disconnect(websocket)


# Serve frontend static files in production (after npm run build)
# Must be LAST so it doesn't shadow API routes
_FRONTEND_DIST = os.path.join(
    os.path.dirname(_BACKEND_DIR), "frontend", "dist"
)
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
