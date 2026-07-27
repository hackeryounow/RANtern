# 网元组件介绍

## 镜像模型概览

RANtern 支持两种核心网实现，它们的容器化策略不同：

| 特性 | Open5GS | Free5GC |
|------|---------|---------|
| 镜像策略 | **单镜像** + `COMPONENT_NAME` 环境变量 | **独立镜像** `free5gc/<nf>:v4.0.1` |
| 镜像名 | `docker_open5gs:v2.8.0-beta` | `free5gc/amf:v4.0.1` 等 |
| 配置方式 | 挂载 `/mnt/<nf>/` 目录，init 脚本 sed 替换 | 挂载 `/free5gc/config/<nf>cfg.yaml` |
| 服务发现 | 静态 IP + 配置文件写死 | NRF 注册发现（SBI） |
| TLS 证书 | 不需要 | 需要（NRF 启动时生成，挂载 `/free5gc/cert`） |

---

## Open5GS 网元

### 镜像信息

```
镜像: swr.cn-north-4.myhuaweicloud.com/cn_5gc/docker_open5gs:v2.8.0-beta
大小: ~1.2 GB
入口: /open5gs_init.sh → /mnt/<nf>/<nf>_init.sh
```

所有 Open5GS NF 共用同一个镜像，通过 `COMPONENT_NAME` 环境变量区分启动哪个网元。每个 NF 的配置文件和初始化脚本挂载在 `/mnt/<nf>/` 目录。

### 5G 控制面

| 网元 | COMPONENT_NAME | 端口 | 依赖 | 说明 |
|------|---------------|------|------|------|
| **AMF** | `amf` | 38412/sctp, 7777/tcp, 9091/tcp | nrf, scp, ausf, udm, udr, pcf, bsf | 接入和移动性管理 |
| **SMF** | `smf` | 3868/sctp, 8805/udp, 2123/udp, 7777/tcp | nrf, scp, amf | 会话管理（DEPLOY_MODE=5G） |
| **NRF** | `nrf` | 7777/tcp | — | NF 注册与发现 |
| **SCP** | `scp` | 7777/tcp | nrf | 服务通信代理 |
| **AUSF** | `ausf` | 7777/tcp | nrf, scp | 认证服务 |
| **UDM** | `udm` | 7777/tcp | nrf, scp | 统一数据管理 |
| **UDR** | `udr` | 7777/tcp | nrf, scp, mongodb | 用户数据仓库 |
| **PCF** | `pcf` | 7777/tcp, 9091/tcp | nrf, scp, mongodb | 策略控制 |
| **NSSF** | `nssf` | 7777/tcp | nrf, scp, mongodb | 网络切片选择 |
| **BSF** | `bsf` | 7777/tcp | nrf, scp, mongodb | 绑定支持 |

### 5G 用户面

| 网元 | COMPONENT_NAME | 端口 | 特殊权限 | 说明 |
|------|---------------|------|---------|------|
| **UPF** | `upf` | 2152/udp, 8805/udp, 9091/tcp | NET_ADMIN, privileged, ip_forward | 用户面转发 |

### 4G EPC

| 网元 | COMPONENT_NAME | 端口 | 依赖 | 说明 |
|------|---------------|------|------|------|
| **MME** | `mme` | 36412/sctp, 2123/udp | hss, sgwc, sgwu | 移动性管理（DEPLOY_MODE=4G） |
| **SGW-C** | `sgwc` | 2123/udp, 2152/udp | mme | 服务网关控制面 |
| **SGW-U** | `sgwu` | 2152/udp | sgwc | 服务网关用户面（privileged） |
| **HSS** | `hss` | 3868/sctp | mongodb | 用户签约数据 |
| **PCRF** | `pcrf` | 3868/sctp | mongodb | 策略和计费规则 |

### 关键环境变量

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `COMPONENT_NAME` | 启动的网元名称 | `amf` |
| `DEPLOY_MODE` | 部署模式（SMF/MME 使用） | `5G` / `4G` |
| `MCC` | 移动国家码 | `999` |
| `MNC` | 移动网络码 | `70` |
| `UE_IPV4_INTERNET` | UE 数据网络 CIDR | `10.45.0.0/16` |

---

## Free5GC 网元

### 镜像信息

```
镜像: free5gc/<nf>:v4.0.1  (每个 NF 独立镜像)
大小: ~150-200 MB 每个
入口: ./<nf> -c ./config/<nf>cfg.yaml
工作目录: /free5gc
```

### 5G 控制面

| 网元 | 镜像 | 端口 | 依赖 | 额外环境变量 |
|------|------|------|------|-------------|
| **AMF** | `free5gc/amf:v4.0.1` | 8000/tcp, 38412/sctp | nrf | GIN_MODE=release |
| **SMF** | `free5gc/smf:v4.0.1` | 8000/tcp | nrf, amf | GIN_MODE=release |
| **NRF** | `free5gc/nrf:v4.0.1` | 8000/tcp | mongodb | DB_URI=mongodb://db/free5gc |
| **AUSF** | `free5gc/ausf:v4.0.1` | 8000/tcp | nrf | GIN_MODE=release |
| **UDM** | `free5gc/udm:v4.0.1` | 8000/tcp | nrf | GIN_MODE=release |
| **UDR** | `free5gc/udr:v4.0.1` | 8000/tcp | nrf, mongodb | DB_URI=mongodb://db/free5gc |
| **PCF** | `free5gc/pcf:v4.0.1` | 8000/tcp | nrf | GIN_MODE=release |
| **NSSF** | `free5gc/nssf:v4.0.1` | 8000/tcp | nrf | GIN_MODE=release |
| **CHF** | `free5gc/chf:v4.0.1` | 8000/tcp | nrf, mongodb | DB_URI=mongodb://db/free5gc |

### 5G 用户面

| 网元 | 镜像 | 端口 | 特殊权限 | 说明 |
|------|------|------|---------|------|
| **UPF** | `free5gc/upf:v4.0.1` | 2152/udp, 8805/udp | NET_ADMIN | 启动前执行 iptables 规则 |

### TLS 证书

Free5GC 所有 SBI 通信使用 HTTPS。证书目录挂载在 `/free5gc/cert`（读写模式，NRF 启动时会重新生成证书）。

---

## RAN 组件（基站 & 终端）

### docker_ueransim（5G NR）

```
镜像: docker_ueransim:latest
大小: ~181 MB
入口: /ueransim_image_init.sh
工作目录: /UERANSIM/build
```

通过 `COMPONENT_NAME` 区分角色：

| COMPONENT_NAME | 角色 | 启动命令 | 配置挂载 |
|---------------|------|---------|---------|
| `ueransim-gnb` | 5G 基站 (gNodeB) | `./nr-gnb -c ../config/ueransim-gnb.yaml` | `/mnt/ueransim` |
| `ueransim-ue` | 5G 终端 (UE) | `./nr-ue -c ../config/ueransim-ue.yaml` | `/mnt/ueransim` |

**gNodeB 关键参数（ueransim-gnb.yaml）：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `mcc` / `mnc` | PLMN 标识 | 由环境变量 MCC/MNC 注入 |
| `nci` | NR Cell Identity | `0x000000010` |
| `tac` | Tracking Area Code | `1` |
| `linkIp` / `ngapIp` / `gtpIp` | gNB 本地 IP | 由 NR_GNB_IP 注入 |
| `amfConfigs.address` | AMF 地址 | 由 AMF_IP 注入 |
| `slices[].sst` | 网络切片类型 | `1` |

**UE 关键参数（ueransim-ue.yaml）：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `supi` | 用户标识 (IMSI) | `imsi-999700000000001` |
| `key` | 永久订阅密钥 (KI) | 由 UE1_KI 注入 |
| `op` / `opType` | 运营商代码 | 由 UE1_OP 注入，类型 OP |
| `amf` | AMF 鉴权字段 | `8000` |
| `gnbSearchList` | gNB 搜索列表 | 由 NR_GNB_IP 注入 |
| `sessions[].apn` | PDU 会话 APN | `internet` |

### docker_srslte（4G LTE）

```
镜像: docker_srslte:latest
大小: ~4.28 GB
入口: cd /mnt/srslte && /mnt/srslte/srslte_init.sh
配置目标: /etc/srsran/
```

通过 `COMPONENT_NAME` 区分角色：

| COMPONENT_NAME | 角色 | 启动命令 | 说明 |
|---------------|------|---------|------|
| `enb` | 4G 基站 (eNodeB) | `/usr/local/bin/srsenb` | S1AP 连接 MME |
| `gnb` | 5G 基站 (srsRAN) | `/usr/local/bin/srsenb` | NGAP 连接 AMF |
| `enb_zmq` | 4G 基站 (ZMQ) | `/usr/local/bin/srsenb` | ZeroMQ 射频模拟 |
| `ue_zmq` | 4G 终端 (ZMQ) | `/usr/local/bin/srsue` | ZeroMQ 射频模拟 |
| `ue_5g_zmq` | 5G 终端 (ZMQ) | `/usr/local/bin/srsue` | ZeroMQ 射频模拟 |

**eNodeB 关键参数（enb.conf）：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `enb_id` | eNB 标识 | `0x19B` |
| `mcc` / `mnc` | PLMN 标识 | 由环境变量注入 |
| `mme_addr` | MME 地址 | 由 MME_IP 注入 |
| `gtp_bind_addr` | GTP 绑定地址 | 由 SRS_ENB_IP 注入 |
| `s1c_bind_addr` | S1AP 绑定地址 | 由 SRS_ENB_IP 注入 |
| `n_prb` | 物理资源块数 | `50` |

### docker_ueransim vs docker_srslte 对比

| 维度 | docker_ueransim | docker_srslte |
|------|----------------|---------------|
| 适用制式 | 5G NR | 4G LTE（也支持 5G NR via srsRAN） |
| 镜像大小 | ~181 MB | ~4.28 GB |
| 射频模拟 | 内置（无需 ZMQ） | 需要 ZMQ 模式 |
| 配置格式 | YAML | INI (conf) |
| 配置挂载 | `/mnt/ueransim` | `/mnt/srslte` |
| UE 连接方式 | 自动搜索 gNB | ZMQ 直连 eNB |
| 推荐场景 | 5G SA 测试 | 4G EPS 测试 |

---

## 数据 / 存储组件

| 组件 | 镜像 | 适用核心 | 说明 |
|------|------|---------|------|
| **MongoDB** (Open5GS) | `mongo:6.0` | open5gs | 用户签约数据，named volume `mongodbdata` |
| **MongoDB** (Free5GC) | `mongo:3.6.8` | free5gc | NF 注册数据，named volume `dbdata`，别名 `db` |
| **WebUI** | `docker_open5gs:v2.8.0-beta` | open5gs | Open5GS 管理界面，端口 9999 |

---

## 网络组件

| 组件 | 说明 |
|------|------|
| **Bridge (L2)** | 逻辑网桥，代表一个 Docker 网络段。不生成容器，仅用于拓扑连线 |
| **Ext DN** | 外部数据网络，使用 `network-multitool` 镜像，用于连通性测试 |
