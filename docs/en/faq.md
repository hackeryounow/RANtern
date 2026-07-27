# FAQ

## Deployment

### Q: Deployment says an image is missing?

The platform tries to pull missing images automatically. If the image is in a private registry, log in first:

```bash
docker login swr.cn-north-4.myhuaweicloud.com
```

For locally built images (e.g. `docker_ueransim`, `docker_srslte`), make sure they are built in the current Docker daemon. You can also upload tar bundles via the "Docker Images" drawer in the UI.

### Q: A container exits immediately after starting?

Common causes:
1. **Config error** — check the container logs (click the node → log console)
2. **Dependency not ready** — other NFs fail to connect before NRF/MongoDB finish starting
3. **Port conflict** — a host port is already in use
4. **Insufficient privileges** — UPF/SGW-U require privileged mode

### Q: Open5GS NRF reports a certificate error?

Open5GS does not use TLS. If you see certificate-related errors, check whether a Free5GC config template was used by mistake.

### Q: Free5GC NRF reports `read-only file system`?

The NRF regenerates TLS certificates on startup. Make sure the certificate directory is mounted in **read-write mode** (the platform sets this to rw by default).

## Networking

### Q: Containers cannot communicate?

1. Confirm all containers are on the same Docker network
2. Check for IP assignment conflicts (`docker network inspect <network>`)
3. Confirm firewall rules (UPF needs `ip_forward` and iptables rules)

### Q: UE cannot register to the core network?

Troubleshooting steps:
1. Confirm the gNB/eNB has connected to the AMF/MME (look for NGAP/S1AP setup messages in the logs)
2. Confirm the UE's IMSI/KI/OP match the core network subscription data
3. Confirm the PLMN (MCC/MNC) configuration matches
4. For a UERANSIM UE, confirm the gNB IP in `gnbSearchList` is correct

### Q: MongoDB data lost?

MongoDB persists to a Docker named volume. Data is only cleared when you run `docker volume rm` or a Destroy operation. A normal Stop does not lose data.

## Frontend

### Q: The page loads blank?

1. Confirm the backend API is running (`curl http://localhost:8000/api/health`)
2. Confirm the Nginx config is correct (in dev mode Vite proxies to port 8000)
3. Clear the browser cache and retry

### Q: The topology graph cannot be dragged/zoomed?

- Confirm the browser supports WebGL (AntV X6 uses SVG rendering, so this is rarely the issue)
- Try refreshing the page to re-initialize the graph engine
- Check the browser console for JavaScript errors

### Q: Logs not showing?

1. Confirm the WebSocket connection is healthy (browser DevTools → Network → WS)
2. Confirm the container is running (`docker ps`)
3. Try closing the tab and clicking the node again to reopen logs

## SIP Dialing

### Q: WebRTC registration fails?

1. Confirm the Asterisk service is running
2. Check that the WSS port (default 8089) is reachable
3. Confirm the SIP credentials are configured correctly (Settings page)
4. If using HTTPS, ensure the SSL certificate is valid

### Q: No audio on a call?

1. Check that the RTP port range (10000-10099) is open
2. Confirm `ASTERISK_EXTERNAL_IP` is set correctly
3. Check that the firewall allows the UDP ports

## System Requirements

### Q: Minimum hardware requirements?

| Scenario | CPU | Memory | Disk |
|----------|-----|--------|------|
| Platform services only | 2 cores | 4 GB | 20 GB |
| + Full Open5GS | 4 cores | 8 GB | 40 GB |
| + Full Free5GC | 4 cores | 8 GB | 40 GB |
| + srsRAN (4G RAN) | 4 cores | 16 GB | 50 GB |

> Note: the `docker_srslte` image is ~4.3 GB, so sufficient disk space is required.
