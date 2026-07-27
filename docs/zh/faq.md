# 常见问题

## 部署相关

### Q: 部署时提示镜像不存在？

平台会尝试自动 pull 缺失镜像。如果镜像在私有仓库，需要先登录：

```bash
docker login swr.cn-north-4.myhuaweicloud.com
```

对于本地构建的镜像（如 `docker_ueransim`、`docker_srslte`），确保已在当前 Docker daemon 中构建完成。也可通过 UI 的 "Docker Images" 抽屉上传 tar 包。

### Q: 容器启动后立即退出？

常见原因：
1. **配置错误** — 查看容器日志（点击节点 → 日志控制台）
2. **依赖未就绪** — NRF/MongoDB 未启动完成时其他 NF 连接失败
3. **端口冲突** — 宿主机端口被占用
4. **权限不足** — UPF/SGW-U 需要 privileged 模式

### Q: Open5GS NRF 报证书错误？

Open5GS 不使用 TLS，如果出现证书相关错误，请检查是否误用了 Free5GC 的配置模板。

### Q: Free5GC NRF 报 `read-only file system`？

NRF 启动时会重新生成 TLS 证书。确保证书目录挂载为 **读写模式**（平台已默认设置为 rw）。

## 网络相关

### Q: 容器间无法通信？

1. 确认所有容器在同一个 Docker 网络中
2. 检查 IP 分配是否冲突（`docker network inspect <network>`）
3. 确认防火墙规则（UPF 需要 `ip_forward` 和 iptables 规则）

### Q: UE 无法注册到核心网？

排查步骤：
1. 确认 gNB/eNB 已成功连接 AMF/MME（查看日志中的 NGAP/S1AP 建立消息）
2. 确认 UE 的 IMSI/KI/OP 与核心网签约数据一致
3. 确认 PLMN (MCC/MNC) 配置一致
4. 对于 UERANSIM UE，确认 `gnbSearchList` 中的 gNB IP 正确

### Q: MongoDB 数据丢失？

MongoDB 使用 Docker named volume 持久化。只有执行 `docker volume rm` 或 Destroy 操作时才会清除数据。普通 Stop 不会丢失数据。

## 前端相关

### Q: 页面加载空白？

1. 确认后端 API 正常运行（`curl http://localhost:8000/api/health`）
2. 确认 Nginx 配置正确（开发模式下 Vite 代理到 8000 端口）
3. 清除浏览器缓存后重试

### Q: 拓扑图无法拖拽/缩放？

- 确认浏览器支持 WebGL（AntV X6 使用 SVG 渲染，一般无此问题）
- 尝试刷新页面重新初始化图引擎
- 检查浏览器控制台是否有 JavaScript 错误

### Q: 日志不显示？

1. 确认 WebSocket 连接正常（浏览器 DevTools → Network → WS）
2. 确认容器正在运行（`docker ps`）
3. 尝试关闭标签页后重新点击节点打开日志

## SIP 拨号相关

### Q: WebRTC 注册失败？

1. 确认 Asterisk 服务正常运行
2. 检查 WSS 端口（默认 8089）是否可达
3. 确认 SIP 凭证配置正确（Settings 页面）
4. 如使用 HTTPS，确保 SSL 证书有效

### Q: 通话无声音？

1. 检查 RTP 端口范围（10000-10099）是否开放
2. 确认 `ASTERISK_EXTERNAL_IP` 设置正确
3. 检查防火墙是否放行 UDP 端口

## 系统要求

### Q: 最低硬件要求？

| 场景 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| 仅平台服务 | 2 核 | 4 GB | 20 GB |
| + Open5GS 全套 | 4 核 | 8 GB | 40 GB |
| + Free5GC 全套 | 4 核 | 8 GB | 40 GB |
| + srsRAN (4G RAN) | 4 核 | 16 GB | 50 GB |

> 注：`docker_srslte` 镜像约 4.3 GB，需要足够磁盘空间。
