# Architecture

## Overall Architecture

RANtern uses a decoupled frontend/backend architecture with container orchestration:

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│   Vite + Ant Design + AntV X6 (topology) + SIP.js        │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                   Backend (FastAPI)                       │
│   Topology engine · Orchestration · Config gen · Logs    │
└───┬──────────────┬──────────────┬───────────────────────┘
    │              │              │
┌───▼───┐    ┌────▼────┐   ┌────▼─────────────────────┐
│ Redis │    │PostgreSQL│   │   Docker Engine           │
│ State │    │ Persist  │   │  (core network containers)│
└───────┘    └─────────┘   └──────────────────────────┘
```

## Services

| Service | Tech Stack | Responsibility |
|---------|-----------|----------------|
| **Frontend** | React 18 + Vite + antd + AntV X6 | Topology editing, log panel, SIP dialing |
| **Backend** | Python FastAPI + uvicorn | REST API, WebSocket log streaming, Docker orchestration |
| **Redis** | Redis 7 | Topology state cache, deployment session management |
| **PostgreSQL** | PostgreSQL 16 | NF catalog persistence, test history, user config |
| **Asterisk** | Asterisk PBX | SIP/WebRTC signaling (VoLTE dialing tests) |
| **Nginx** | Nginx | Frontend static assets + HTTPS + API reverse proxy |

## Core Modules

### Topology Engine

- Parses the topology document submitted by the frontend (nodes + links)
- Generates a Docker container spec per node (image, env, volumes, network)
- Manages the container lifecycle: create → start → stop → destroy
- Assigns IP addresses automatically (172.22.0.0/24 subnet)

### NF Registry

- A declarative NF catalog defining all available NF types
- Each entry includes: image, environment variables, ports, dependencies, config mounts
- Supports both Open5GS (single image + COMPONENT_NAME) and Free5GC (per-NF image) models

### Config Generator

- **Open5GS**: copies per-NF config files from template directories and injects parameters via environment variables
- **Free5GC**: renders YAML config files (SBI addresses, NRF discovery, PLMN, etc.)
- Supports certificate directory mounting (Free5GC NRF requires TLS certificates)

### Logging System

- Real-time container log streaming over WebSocket
- Multiple node log tabs viewed in parallel
- ANSI color rendering

## Network Model

All core network containers run on a single Docker bridge network:

- Default subnet: `172.22.0.0/24`
- Gateway: `172.22.0.1`
- Each NF container gets a static IP automatically (starting from 172.22.0.10)
- Containers reach each other via Docker DNS (container name) or static IP

## Data Flow

```
User drags topology → POST /api/topology/deploy
  → Topology engine parses → Config generation → Docker API creates containers
  → WebSocket pushes deployment progress + container logs
  → Frontend updates node state in real time (running/exited)
```
