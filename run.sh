#!/bin/bash

# CoreSimRunner — Startup Script
# Usage:
#   ./run.sh              Start backend + frontend dev server
#   ./run.sh --prod       Start backend only (serves built frontend from dist/)
#   ./run.sh --backend    Start backend API server only
#   ./run.sh --frontend   Start frontend dev server only

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# ─── Defaults ───
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
START_BACKEND=true
START_FRONTEND=true
PROD_MODE=false

# ─── Colors ───
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'


# pkill -f "uvicorn api.main" 

# ─── Parse args ───
for arg in "$@"; do
    case "$arg" in
        --prod)
            PROD_MODE=true
            START_FRONTEND=false
            ;;
        --backend|-b)
            START_FRONTEND=false
            ;;
        --frontend|-f)
            START_BACKEND=false
            ;;
        --port=*)
            PORT="${arg#*=}"
            ;;
        --host=*)
            HOST="${arg#*=}"
            ;;
        -h|--help)
            echo "Usage: ./run.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --prod         Production mode (backend serves built frontend)"
            echo "  --backend, -b  Start backend API server only"
            echo "  --frontend, -f Start frontend dev server only"
            echo "  --port=PORT    API server port (default: 8000)"
            echo "  --host=HOST    API server host (default: 0.0.0.0)"
            echo "  -h, --help     Show this help"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            exit 1
            ;;
    esac
done

# ─── PIDs for cleanup ───
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    [ -n "$BACKEND_PID" ]   && kill "$BACKEND_PID" 2>/dev/null && echo "  Backend stopped (PID $BACKEND_PID)"
    [ -n "$FRONTEND_PID" ]  && kill "$FRONTEND_PID" 2>/dev/null && echo "  Frontend stopped (PID $FRONTEND_PID)"
    wait 2>/dev/null
    echo -e "${GREEN}Goodbye.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ◆ CoreSimRunner — Starting             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─── Preflight checks ───
if [ "$START_BACKEND" = true ]; then
    if ! command -v python3 &>/dev/null; then
        echo -e "${RED}✗ python3 not found${NC}"
        exit 1
    fi
    if ! python3 -c "import fastapi" 2>/dev/null; then
        echo -e "${YELLOW}⚠ fastapi not installed — run setup.sh first${NC}"
        exit 1
    fi
    if [ ! -d "$BACKEND_DIR" ]; then
        echo -e "${RED}✗ backend/ directory not found${NC}"
        exit 1
    fi
fi

if [ "$START_FRONTEND" = true ]; then
    if ! command -v node &>/dev/null; then
        echo -e "${RED}✗ node not found${NC}"
        exit 1
    fi
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}⚠ node_modules not found — run setup.sh first or: cd frontend && npm install${NC}"
        exit 1
    fi
fi

# ─── Production mode: build frontend if needed ───
if [ "$PROD_MODE" = true ] && [ ! -d "$FRONTEND_DIR/dist" ]; then
    echo -e "${YELLOW}▸ Building frontend for production...${NC}"
    cd "$FRONTEND_DIR"
    npx vite build 2>&1 | tail -3
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}  ✓ Frontend built → frontend/dist/${NC}"
    echo ""
fi

# ─── Start backend ───
if [ "$START_BACKEND" = true ]; then
    echo -e "${CYAN}▸ Starting backend API server on $HOST:$PORT ...${NC}"
    cd "$BACKEND_DIR"
    PYTHONPATH="$BACKEND_DIR" python3 -m uvicorn api.main:app \
        --host "$HOST" \
        --port "$PORT" \
        --log-level info &
    BACKEND_PID=$!
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}  ✓ Backend running (PID $BACKEND_PID)${NC}"
    echo -e "    API  → http://$HOST:$PORT/api/health"
    echo -e "    Docs → http://$HOST:$PORT/docs"
    echo ""
fi

# ─── Start frontend dev server ───
if [ "$START_FRONTEND" = true ]; then
    FRONTEND_PORT="${FRONTEND_PORT:-5173}"
    echo -e "${CYAN}▸ Starting frontend dev server on port $FRONTEND_PORT ...${NC}"
    cd "$FRONTEND_DIR"
    npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" &
    FRONTEND_PID=$!
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}  ✓ Frontend dev server running (PID $FRONTEND_PID)${NC}"
    echo -e "    UI → http://0.0.0.0:$FRONTEND_PORT"
    echo ""
fi

# ─── Summary ───
echo -e "${CYAN}────────────────────────────────────────────${NC}"
if [ "$PROD_MODE" = true ]; then
    echo -e "${GREEN}Production mode — open http://$HOST:$PORT${NC}"
elif [ "$START_BACKEND" = true ] && [ "$START_FRONTEND" = true ]; then
    echo -e "${GREEN}Dev mode — open http://<your-ip>:$FRONTEND_PORT${NC}"
    echo -e "${CYAN}API proxy → http://$HOST:$PORT${NC}"
fi
echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"
echo ""

# ─── Wait for processes ───
wait
