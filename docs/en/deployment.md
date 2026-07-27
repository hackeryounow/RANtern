# Deployment & Configuration

## Docker Compose Deployment

### Development

```bash
docker compose up --build -d
```

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

## Environment Variables

Create a `.env` file in the project root to configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_PORT` | 6379 | Redis exposed port |
| `REDIS_PASSWORD` | (empty) | Redis password |
| `POSTGRES_DB` | rantern | PostgreSQL database name |
| `POSTGRES_USER` | rantern | PostgreSQL user name |
| `POSTGRES_PASSWORD` | rantern_dev | PostgreSQL password |
| `POSTGRES_PORT` | 5432 | PostgreSQL exposed port |
| `BACKEND_PORT` | 8000 | Backend API port |
| `FRONTEND_PORT` | 80 | Frontend HTTP port |
| `FRONTEND_HTTPS_PORT` | 443 | Frontend HTTPS port |
| `PUBLIC_HOST` | localhost | Public domain/IP |
| `VITE_API_URL` | http://localhost:8000 | Frontend API address |
| `VITE_WS_URL` | ws://localhost:8000/ws | WebSocket address |
| `ASTERISK_WSS_PORT` | 8089 | SIP WebSocket port |
| `ASTERISK_SIP_PORT` | 5060 | SIP UDP port |

## Core Network Container Networking

When deploying a core network topology, the platform creates a Docker network automatically:

- Network name: `topo-<topology-name>`
- Subnet: `172.22.0.0/24` (customizable in the topology YAML)
- Gateway: `172.22.0.1`
- IP assignment: auto-incrementing from `172.22.0.10`

## Image Management

### Required Image List

**Open5GS topology:**
```
swr.cn-north-4.myhuaweicloud.com/cn_5gc/docker_open5gs:v2.8.0-beta
mongo:6.0
docker_ueransim:latest      # 5G base station/terminal
docker_srslte:latest        # 4G base station/terminal
ghcr.io/hellt/network-multitool  # external data network
```

**Free5GC topology:**
```
free5gc/amf:v4.0.1
free5gc/smf:v4.0.1
free5gc/nrf:v4.0.1
free5gc/ausf:v4.0.1
free5gc/udm:v4.0.1
free5gc/udr:v4.0.1
free5gc/pcf:v4.0.1
free5gc/nssf:v4.0.1
free5gc/chf:v4.0.1
free5gc/upf:v4.0.1
mongo:3.6.8
docker_ueransim:latest      # 5G base station/terminal
```

### Image Pulling

- On deployment, missing local images are detected and pulled automatically
- You can also upload tar bundles manually via the "Docker Images" drawer in the UI
- Private registry images require a prior `docker login`

## Config Template Directory

Backend config templates live under `backend/coresimrunner/config_gen/templates/`:

```
templates/
├── open5gs/          # Open5GS per-NF config
│   ├── amf/          # amf.yaml + amf_init.sh
│   ├── smf/
│   ├── upf/
│   ├── ...
│   ├── ueransim/     # UERANSIM gNB/UE config
│   └── srslte/       # srsRAN eNB/UE config
└── free5gc/          # Free5GC config templates
    └── cert/         # TLS certificates
```

## SSL/HTTPS

Enable HTTPS for production:

```bash
# Generate a self-signed certificate
./scripts/generate-ssl.sh

# Certificates are output to nginx/ssl/
# Redeploy the frontend
docker compose up -d frontend
```

## Data Persistence

| Data | Storage Location | Description |
|------|------------------|-------------|
| Redis data | Docker volume `redis-data` | Topology state cache |
| PostgreSQL | Docker volume `pgdata` | NF catalog, test history |
| Core network logs | `backend/data/` (mounted) | Container runtime logs |
| Topology files | PostgreSQL | Saved topology definitions |
| MongoDB (core network) | Docker named volume | User subscription data |
