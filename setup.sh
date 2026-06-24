#!/bin/bash

# Setup script for CoreSimRunner
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║   CoreSimRunner — Setup                  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Backend setup ───
echo "▸ Setting up backend..."
cd backend

# Install coresimrunner package + API deps
pip install -e . 2>/dev/null || true
pip install fastapi "uvicorn[standard]" websockets loguru 2>/dev/null || true
pip install -r coresimrunner/requirements.txt 2>/dev/null || true

# Check required Python packages
python3 -c "import pycrate_asn1dir" 2>/dev/null && echo "  ✓ pycrate" || echo "  ⚠ pycrate not found — install separately"
python3 -c "import CryptoMobile" 2>/dev/null && echo "  ✓ CryptoMobile" || echo "  ⚠ CryptoMobile not found — install separately"
python3 -c "import sctp" 2>/dev/null && echo "  ✓ pysctp" || echo "  ⚠ pysctp not found — install separately"

cd "$SCRIPT_DIR"

# ─── Frontend setup ───
if [ -d "frontend" ]; then
    echo ""
    echo "▸ Setting up frontend..."
    cd frontend
    npm install 2>/dev/null || echo "  ⚠ npm install failed — try manually: cd frontend && npm install"
    cd "$SCRIPT_DIR"
else
    echo ""
    echo "⚠ frontend/ directory not found — skipping frontend setup"
fi

# ─── Default profile ───
if [ ! -f "backend/data/profiles/default.env" ] && [ -f "src/.env" ]; then
    mkdir -p backend/data/profiles
    cp src/.env backend/data/profiles/default.env
    echo ""
    echo "  ✓ Copied src/.env to backend/data/profiles/default.env"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup complete!                        ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Run the backend API server:"
echo "  cd backend && PYTHONPATH=\$(pwd) uvicorn api.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "Run the frontend dev server:"
echo "  cd frontend && npm run dev"
echo ""
echo "Build frontend for production (served by FastAPI):"
echo "  cd frontend && npm run build"
echo ""
echo "Run CLI directly:"
echo "  cd backend && PYTHONPATH=\$(pwd) python3 -m coresimrunner.coresim_runner --mode provision --count 2 --core-network free5gc"
echo "  cd backend && PYTHONPATH=\$(pwd) python3 -m coresimrunner.coresim_runner --mode ue-test --count 10 --core-network free5gc"
