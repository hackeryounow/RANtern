"""
FastAPI application entry point for CoreSimRunner.

Run with: uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import sys
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

# Ensure backend/ is on the Python path so both `api` and `coresimrunner` are importable
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from api.ws import ws_hub
from api.routes import provision, test, config, profiles, core_network, topology, docker_images, components, docs, phone


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Initialize Redis UE manager singleton
    from coresimrunner.config_loader import ConfigLoader
    from coresimrunner.redis_manager import RedisUEManager

    try:
        cfg = ConfigLoader()
        redis_host = cfg.get("REDIS_HOST", "127.0.0.1")
        redis_port = cfg.get_int("REDIS_PORT", 6379)
        redis_password = cfg.get("REDIS_PASSWORD", "") or None
        redis_db = cfg.get_int("REDIS_DB", 0)
    except Exception:
        redis_host, redis_port, redis_password, redis_db = "127.0.0.1", 6379, None, 0

    try:
        ue_store = RedisUEManager(
            host=redis_host, port=redis_port, password=redis_password, db=redis_db
        )
        # Clear stale UE state from previous runs
        ue_store.clear_all()
        # Expose globally so route modules can import it
        import api.routes.test as test_mod
        test_mod.ue_store = ue_store
        logger.info("Redis UE manager initialised (cleared on startup)")
    except Exception as e:
        logger.warning(f"Redis not available ({e}); UE state will not be persisted")

    # Initialize PostgreSQL (users, test history, call records, feedbacks)
    try:
        from api.db import init_db
        await init_db()
        # Seed the NF component catalog (idempotent; no-op without PG)
        from api.db import seed_nf_components
        seed_nf_components()
    except Exception as e:
        logger.warning(f"PostgreSQL not available ({e}); history will use file-based storage")

    yield
    # Shutdown: close PostgreSQL pool
    try:
        from api.db import close_pool
        close_pool()
    except Exception:
        pass
    # Shutdown: detach all simulated phones (deregister + close tunnels)
    try:
        from coresimrunner.phone_sim.manager import PhoneRegistry
        PhoneRegistry.shutdown_all()
    except Exception:
        pass


app = FastAPI(
    title="CoreSimRunner API",
    description="5G/4G Core Network Testing Platform",
    version="1.0.0",
    lifespan=lifespan,
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
app.include_router(core_network.router, prefix="/api", tags=["Core Network"])
app.include_router(topology.router, prefix="/api", tags=["Topology"])
app.include_router(docker_images.router, prefix="/api", tags=["Docker Images"])
app.include_router(components.router, prefix="/api", tags=["NF Components"])
app.include_router(docs.router, prefix="/api", tags=["Docs"])
app.include_router(phone.router, prefix="/api", tags=["Phone"])


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
                continue
            # Handle SIP-related JSON messages
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")
                payload = msg.get("data", {})
                if msg_type and msg_type.startswith(("sip_", "call_")):
                    ws_hub.handle_sip_message(websocket, msg_type, payload)
            except json.JSONDecodeError:
                # Not JSON, ignore
                pass
    except WebSocketDisconnect:
        await ws_hub.disconnect(websocket)


# Serve frontend static files in production (after npm run build)
# Must be LAST so it doesn't shadow API routes
_FRONTEND_DIST = os.path.join(
    os.path.dirname(_BACKEND_DIR), "frontend", "dist"
)
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
