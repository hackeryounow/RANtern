# 系统架构

## 总体架构

RANtern 采用前后端分离 + 容器编排的架构：

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│   Vite + Ant Design + AntV X6 (拓扑图) + SIP.js         │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                   Backend (FastAPI)                       │
│   拓扑引擎 · 容器编排 · 配置生成 · 日志流 · REST API     │
└───┬──────────────┬──────────────┬───────────────────────┘
    │              │              │
┌───▼───┐    ┌────▼────┐   ┌────▼─────────────────────┐
│ Redis │    │PostgreSQL│   │   Docker Engine           │
│ 状态  │    │ 持久化  │   │  (核心网容器实例)          │
└───────┘    └─────────┘   └──────────────────────────┘
```

## 服务组成

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| **Frontend** | React 18 + Vite + antd + AntV X6 | 拓扑可视化编辑、日志面板、SIP 拨号 |
| **Backend** | Python FastAPI + uvicorn | REST API、WebSocket 日志流、Docker 编排 |
| **Redis** | Redis 7 | 拓扑状态缓存、部署会话管理 |
| **PostgreSQL** | PostgreSQL 16 | NF 目录持久化、测试历史、用户配置 |
| **Asterisk** | Asterisk PBX | SIP/WebRTC 信令服务（VoLTE 拨号测试） |
| **Nginx** | Nginx | 前端静态资源 + HTTPS + API 反向代理 |

## 核心模块

### 拓扑引擎（Topology Engine）

- 解析前端提交的拓扑文档（nodes + links）
- 为每个节点生成 Docker 容器规格（image、env、volumes、network）
- 管理容器生命周期：创建 → 启动 → 停止 → 销毁
- 自动分配 IP 地址（172.22.0.0/24 子网）

### NF 注册表（NF Registry）

- 声明式网元目录，定义所有可用 NF 类型
- 每个条目包含：镜像、环境变量、端口、依赖关系、配置挂载
- 支持 Open5GS（单镜像 + COMPONENT_NAME）和 Free5GC（独立镜像）两种模式

### 配置生成器（Config Gen）

- **Open5GS**：从模板目录复制 per-NF 配置文件，通过环境变量注入参数
- **Free5GC**：渲染 YAML 配置文件（SBI 地址、NRF 发现、PLMN 等）
- 支持证书目录挂载（Free5GC NRF 需要 TLS 证书）

### 日志系统

- WebSocket 实时推送容器日志
- 支持多节点日志标签页并行查看
- ANSI 颜色渲染

## 网络模型

所有核心网容器运行在同一个 Docker bridge 网络中：

- 默认子网：`172.22.0.0/24`
- 网关：`172.22.0.1`
- 每个 NF 容器自动分配静态 IP（从 172.22.0.10 开始）
- 容器间通过 Docker DNS（容器名）或静态 IP 互访

## 数据流

```
用户拖拽拓扑 → POST /api/topology/deploy
  → 拓扑引擎解析 → 配置生成 → Docker API 创建容器
  → WebSocket 推送部署进度 + 容器日志
  → 前端实时更新节点状态（running/exited）
```
