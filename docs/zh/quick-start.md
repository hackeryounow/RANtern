# 快速开始

## 简介

RANtern（CoreSimRunner）是一个 5G/4G 核心网仿真测试平台，提供可视化的网络功能（NF）拓扑编排、一键部署、实时日志监控和 SIP 拨号测试等能力。支持 **Open5GS** 和 **Free5GC** 两种核心网实现。

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Docker | 20.10+ | 容器运行时 |
| Docker Compose | v2+ | 服务编排 |
| Node.js | 18+ | 前端构建（开发时） |
| Python | 3.10+ | 后端运行（开发时） |

## 一键启动

```bash
# 克隆项目
git clone <repo-url> && cd RANtern

# 启动全部服务（Redis + PostgreSQL + Backend + Frontend + Asterisk）
docker compose up --build -d
```

启动后访问：

- **前端界面**：`http://localhost`（Nginx 代理）
- **后端 API**：`http://localhost:8000`
- **API 文档**：`http://localhost:8000/docs`（Swagger UI）

## 本地开发模式

```bash
# 1. 启动基础设施
docker compose up -d redis postgres

# 2. 启动后端（热重载）
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000

# 3. 启动前端（Vite dev server）
cd frontend
npm install
npm run dev
```

前端开发服务器默认运行在 `http://localhost:5173`，已配置代理转发 `/api` 到后端。

## 第一次使用

1. **进入 Core Network 页面** — 点击左侧导航栏 "Core Network"
2. **选择核心网类型** — 顶部切换 Open5GS / Free5GC
3. **拖拽网元** — 从左侧组件面板拖入 AMF、SMF、UPF 等网元
4. **连接网元** — 拖拽端口连线建立 SBI / N2 / N3 等接口连接
5. **部署拓扑** — 点击工具栏 Deploy 按钮，平台自动创建 Docker 容器
6. **查看日志** — 点击已部署节点，在底部控制台查看实时日志

## 默认测试拓扑

平台内置了 Open5GS 和 Free5GC 的默认拓扑模板，可在拓扑编辑器中通过 "Topologies" 抽屉一键加载：

- **Open5GS 5G**：NRF + SCP + AMF + SMF + UPF + AUSF + UDM + UDR + PCF + MongoDB
- **Free5GC 5G**：NRF + AMF + SMF + UPF + AUSF + UDM + UDR + PCF + MongoDB

## 下一步

- 了解 [系统架构](/docs/architecture) 以理解平台设计
- 查看 [网元组件介绍](/docs/nf-components) 了解各镜像和配置参数
- 使用 [拓扑编辑器](/docs/topology-editor) 构建自定义网络
