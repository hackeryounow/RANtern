# Quick Start

## Introduction

RANtern (CoreSimRunner) is a 5G/4G core network simulation and testing platform. It provides visual Network Function (NF) topology orchestration, one-click deployment, real-time log monitoring, and SIP dialing tests. It supports both **Open5GS** and **Free5GC** core network implementations.

## Requirements

| Dependency | Minimum Version | Notes |
|------------|-----------------|-------|
| Docker | 20.10+ | Container runtime |
| Docker Compose | v2+ | Service orchestration |
| Node.js | 18+ | Frontend build (development) |
| Python | 3.10+ | Backend runtime (development) |

## One-Click Launch

```bash
# Clone the project
git clone <repo-url> && cd RANtern

# Start all services (Redis + PostgreSQL + Backend + Frontend + Asterisk)
docker compose up --build -d
```

After startup, visit:

- **Frontend UI**: `http://localhost` (Nginx proxy)
- **Backend API**: `http://localhost:8000`
- **API Docs**: `http://localhost:8000/docs` (Swagger UI)

## Local Development Mode

```bash
# 1. Start infrastructure
docker compose up -d redis postgres

# 2. Start the backend (hot reload)
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000

# 3. Start the frontend (Vite dev server)
cd frontend
npm install
npm run dev
```

The frontend dev server runs at `http://localhost:5173` by default, with a proxy configured to forward `/api` to the backend.

## First Steps

1. **Open the Core Network page** — click "Core Network" in the left navigation bar
2. **Select a core type** — switch between Open5GS / Free5GC at the top
3. **Drag in NFs** — drag AMF, SMF, UPF, etc. from the component palette on the left
4. **Wire the NFs** — drag port-to-port to establish SBI / N2 / N3 interface links
5. **Deploy the topology** — click the Deploy button in the toolbar; the platform creates Docker containers automatically
6. **View logs** — click a deployed node and watch real-time logs in the bottom console

## Default Test Topologies

The platform ships with default topology templates for Open5GS and Free5GC, loadable in one click from the "Topologies" drawer in the topology editor:

- **Open5GS 5G**: NRF + SCP + AMF + SMF + UPF + AUSF + UDM + UDR + PCF + MongoDB
- **Free5GC 5G**: NRF + AMF + SMF + UPF + AUSF + UDM + UDR + PCF + MongoDB

## Next Steps

- Read [Architecture](/docs/architecture) to understand the platform design
- See [NF Components](/docs/nf-components) for images and configuration parameters
- Use the [Topology Editor](/docs/topology-editor) to build custom networks
