# 部署与配置

## Docker Compose 部署

### 开发环境

```bash
docker compose up --build -d
```

### 生产环境

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

## 环境变量

在项目根目录创建 `.env` 文件配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_PORT` | 6379 | Redis 对外端口 |
| `REDIS_PASSWORD` | (空) | Redis 密码 |
| `POSTGRES_DB` | rantern | PostgreSQL 数据库名 |
| `POSTGRES_USER` | rantern | PostgreSQL 用户名 |
| `POSTGRES_PASSWORD` | rantern_dev | PostgreSQL 密码 |
| `POSTGRES_PORT` | 5432 | PostgreSQL 对外端口 |
| `BACKEND_PORT` | 8000 | 后端 API 端口 |
| `FRONTEND_PORT` | 80 | 前端 HTTP 端口 |
| `FRONTEND_HTTPS_PORT` | 443 | 前端 HTTPS 端口 |
| `PUBLIC_HOST` | localhost | 对外访问域名/IP |
| `VITE_API_URL` | http://localhost:8000 | 前端 API 地址 |
| `VITE_WS_URL` | ws://localhost:8000/ws | WebSocket 地址 |
| `ASTERISK_WSS_PORT` | 8089 | SIP WebSocket 端口 |
| `ASTERISK_SIP_PORT` | 5060 | SIP UDP 端口 |

## 核心网容器网络

部署核心网拓扑时，平台自动创建 Docker 网络：

- 网络名称：`topo-<topology-name>`
- 子网：`172.22.0.0/24`（可在拓扑 YAML 中自定义）
- 网关：`172.22.0.1`
- IP 分配：从 `172.22.0.10` 开始自动递增

## 镜像管理

### 所需镜像清单

**Open5GS 拓扑：**
```
swr.cn-north-4.myhuaweicloud.com/cn_5gc/docker_open5gs:v2.8.0-beta
mongo:6.0
docker_ueransim:latest      # 5G 基站/终端
docker_srslte:latest        # 4G 基站/终端
ghcr.io/hellt/network-multitool  # 外部数据网络
```

**Free5GC 拓扑：**
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
docker_ueransim:latest      # 5G 基站/终端
```

### 镜像拉取

- 部署时自动检测本地镜像，缺失则尝试 pull
- 也可通过 UI 的 "Docker Images" 抽屉手动上传 tar 包
- 私有仓库镜像需提前 `docker login`

## 配置模板目录

后端配置模板位于 `backend/coresimrunner/config_gen/templates/`：

```
templates/
├── open5gs/          # Open5GS per-NF 配置
│   ├── amf/          # amf.yaml + amf_init.sh
│   ├── smf/
│   ├── upf/
│   ├── ...
│   ├── ueransim/     # UERANSIM gNB/UE 配置
│   └── srslte/       # srsRAN eNB/UE 配置
└── free5gc/          # Free5GC 配置模板
    └── cert/         # TLS 证书
```

## SSL/HTTPS

生产环境启用 HTTPS：

```bash
# 生成自签名证书
./scripts/generate-ssl.sh

# 证书输出到 nginx/ssl/
# 重新部署前端
docker compose up -d frontend
```

## 数据持久化

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| Redis 数据 | Docker volume `redis-data` | 拓扑状态缓存 |
| PostgreSQL | Docker volume `pgdata` | NF 目录、测试历史 |
| 核心网日志 | `backend/data/` (挂载) | 容器运行日志 |
| 拓扑文件 | PostgreSQL | 保存的拓扑定义 |
| MongoDB (核心网) | Docker named volume | 用户签约数据 |
