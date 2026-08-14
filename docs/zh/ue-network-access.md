# UE 入网操作文档

> 本文档以 `docker_open5gs` 部署（Open5GS 5G SA 核心网 + UERANSIM 虚拟基站/终端）为例，
> 说明 UE（终端）从开机到获得数据业务的完整入网操作流程，包含注册（Registration）与
> PDU 会话建立（PDU Session Establishment）两大流程，以及数据面连通性验证。

---

## 1. 概述

UE 入网（5G 网络接入）指终端通过基站接入 5G 核心网，完成 **注册（Registration）** 并建立
**PDU 会话（PDU Session）**，从而获得数据业务能力的过程。整体流程如下：

```
UE ──(N1/N2)── gNB ──(NGAP/N2)── AMF ──(Nsmf)── SMF ──(PFCP/N4)── UPF ──(N6)── DN(互联网)
                                  │
                                  ├── AUSF/UDM/UDR（鉴权与用户数据）
                                  └── NRF/SCP（服务发现）
```

入网包含的关键步骤：

1. **核心网 NF 启动**：AMF、SMF、UPF、UDM、AUSF、UDR、NRF 等。
2. **基站 gNB 启动**：与 AMF 建立 NGAP（SCTP）连接，广播 PLMN。
3. **终端用户开户（Provisioning）**：在 UDM/HSS 中写入用户签约数据（IMSI、K、OP/OPC、切片、DNN）。
4. **UE 注册流程**：PLMN 选择 → 小区选择 → 初始注册 → 鉴权（5G-AKA）→ 安全模式命令（SMC）→ 注册完成。
5. **PDU 会话建立**：UE 请求建立 PDU 会话 → SMF 选 UPF、建立 N4 会话 → 分配 UE IP、创建 TUN 接口（`uesimtun0`）。
6. **数据面验证**：通过 `uesimtun0` 访问外网（如 ping 8.8.8.8）。

---

## 2. 环境准备

| 组件 | 说明 |
|------|------|
| `docker_open5gs` | Open5GS 核心网 + IMS + UERANSIM 的 Docker 化部署 |
| 核心网镜像 | `docker_open5gs`（同一镜像运行各 NF，按 `COMPONENT_NAME` 区分） |
| 基站/终端镜像 | `docker_ueransim`（运行 nr-gnb / nr-ue） |
| 数据库 | MongoDB（存储用户签约数据，Open5GS WebUI/UDM 读取） |
| 编排文件 | `sa-deploy.yaml`（基础 5G SA 核心网）或 `sa-vonr-*-deploy.yaml`（含 IMS/VoNR） |
| 基站/终端编排 | `nr-gnb.yaml` / `nr-ue.yaml`（或 ipv6 变体 `nr-gnb-ipv6.yaml` / `nr-ue-ipv6.yaml`） |

环境变量集中在 `.env`（或 `.env.ipv6`）中，关键字段：

```bash
MCC=460              # 移动国家码
MNC=09               # 移动网络码（须与用户 IMSI 中的 MNC 一致）
AMF_IP=172.22.0.10   # AMF 地址（gNB 通过它建立 NGAP）
NR_GNB_IP=172.22.0.23
NR_UE_IP=172.22.0.24
UE1_IMSI=460090000000001          # 用户 IMSI
UE1_KI=465B5CE8B199B49FAA5F0A2EE238A6BC   # 鉴权密钥 K
UE1_OP=E8ED289DEBA952E4283B54E88E6183CA   # OPC（opType=OPC 时直接作为 OPC 使用）
UE1_AMF=8000
SMF_DNS1=8.8.8.8
UE_IPV4_INTERNET=172.28.0.0/16    # UE 互联网会话地址池
```

---

## 3. 启动核心网

按说明文档（README）启动 5G SA 核心网：

```bash
cd docker_open5gs
docker compose --env-file .env.ipv6 -f sa-vonr-ipv6-deploy.yaml up -d \
    nrf scp ausf udr udm smf upf amf pcf bsf nssf
```

> 仅做数据面入网测试时，IMS 相关组件（pyhss、icscf、scscf、pcscf 等）可不启动。

确认 NF 已启动且 AMF 监听 NGAP 端口：

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
docker logs amf 2>&1 | grep -i "ngap_server"
# 期望: ngap_server() [172.22.0.10]:38412
```

---

## 4. 启动基站 gNB

```bash
docker compose --env-file .env.ipv6 -f nr-gnb-ipv6.yaml up -d --force-recreate nr_gnb
```

gNB 启动后会读取 `.env` 中的 `MCC/MNC` 生成配置（`ueransim-gnb.yaml`），并向 AMF 发起 NG Setup：

```bash
docker logs nr_gnb 2>&1 | grep -i "NG Setup"
# 期望: NG Setup procedure is successful
docker logs amf 2>&1 | grep -i "Number of gNBs"
# 期望: [Added] Number of gNBs is now 1
```

gNB 关键配置（渲染后）：

```yaml
mcc: '460'
mnc: '09'
tac: 1
ngapIp: 172.22.0.23
gtpIp: 172.22.0.23
amfConfigs:
  - address: 172.22.0.10
    port: 38412
slices:
  - sst: 1
    sd: '000001'      # 须与用户签约切片一致
```

---

## 5. 终端用户开户（Provisioning）

UE 要成功入网，核心网（UDM）中必须存在与 UE 凭据一致的签约用户。两种方式：

### 方式一：Open5GS WebUI

打开 `http://<DOCKER_HOST_IP>:9999`，默认账号 `admin` / 密码 `1423`，新增 Subscriber，
填写 IMSI、K、OPC（OP Type 选 OPC）、切片（S-NSSAI）与会话（DNN）。

### 方式二：命令行 `open5gs-dbctl`

```bash
docker exec -it webui bash -c \
  "cd /open5gs && ./misc/db/open5gs-dbctl --db_uri=mongodb://mongo/open5gs \
   add_ue_with_slice \
   460090000000001 \
   465B5CE8B199B49FAA5F0A2EE238A6BC \
   E8ED289DEBA952E4283B54E88E6183CA \
   internet 1 000001"
```

参数含义：`IMSI  K  OPC  DNN(apn)  SST  SD`。

> 注意：若镜像内只有旧版 `mongo` shell 而脚本调用 `mongosh`，可建立软链
> `ln -sf /usr/bin/mongo /usr/local/bin/mongosh`（容器重建后失效）。

---

## 6. 启动 UE

```bash
docker compose --env-file .env.ipv6 -f nr-ue-ipv6.yaml up -d --force-recreate nr_ue
```

UE 配置（`ueransim-ue.yaml`）关键字段：

```yaml
supi: 'imsi-460090000000001'
mcc: '460'
mnc: '09'
key: '465B5CE8B199B49FAA5F0A2EE238A6BC'
op: 'E8ED289DEBA952E4283B54E88E6183CA'
opType: 'OPC'                 # 存储的是 OPC 时必须为 OPC
amf: '8000'
gnbSearchList:
  - 172.22.0.23
sessions:
  - type: 'IPv4'              # 须与签约会话类型匹配
    apn: 'internet'
    slice:
      sst: 1
      sd: '000001'
configured-nssai:
  - sst: 1
    sd: '000001'
default-nssai:
  - sst: 1
    sd: '000001'
```

---

## 7. 验证注册流程

```bash
docker logs nr_ue 2>&1 | grep -iE "registration|security mode|auth|sqn|mm-"
```

成功的注册流程日志（关键节点）：

```
Selected plmn[460/09]
Selected cell plmn[460/09] tac[1] category[SUITABLE]
Sending Initial Registration
Authentication Request received
Sending Authentication Failure due to SQN out of range   # 新用户首次鉴权的正常 SQN 重同步
Authentication Request received
Security Mode Command received
Initial Registration is successful                        # 注册成功
```

> **SQN out of range**：新用户首次鉴权时 UE 侧 SQN 与网络侧不一致，UE 通过
> AUTS 触发重同步，第二次鉴权即成功，属正常现象。

---

## 8. 验证 PDU 会话建立

```bash
docker logs nr_ue 2>&1 | grep -iE "pdu|session|tun"
```

成功日志：

```
Sending PDU Session Establishment Request
PDU Session Establishment Accept received
PDU Session establishment is successful PSI[1]
Connection setup for PDU session[1] is successful, TUN interface[uesimtun0, 172.28.0.2] is up.
```

确认 TUN 接口与 UE IP：

```bash
docker exec nr_ue ip addr show uesimtun0
# inet 172.28.0.2/32 scope global uesimtun0
```

---

## 9. 数据面验证（ping 外网）

通过 `uesimtun0` 网卡 ping 公网地址，验证 UE → gNB → UPF → 宿主机 NAT → 互联网 的完整数据面：

```bash
docker exec nr_ue ping -I uesimtun0 -c 4 8.8.8.8
```

期望结果：

```
PING 8.8.8.8 (8.8.8.8) from 172.28.0.2 uesimtun0: 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=2 ttl=101 time=216 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=101 time=216 ms
...
```

> 首个报文可能因路由/ARP 初始化丢失，后续报文正常即表示数据面打通。
> 若 ping 不通，请检查 UPF 的 NAT/路由（UE 子网 `172.28.0.0/16` 是否被 masquerade 到宿主机外网）。

---

## 10. 关键配置要点与常见问题

入网失败绝大多数源于 **配置不一致**。务必保证以下各项在 **UE、gNB、AMF、签约用户** 之间相互匹配：

| 配置项 | 要求 | 不匹配时的典型现象 |
|--------|------|--------------------|
| **PLMN（MCC/MNC）** | UE 的 HPLMN、gNB 广播 PLMN、AMF 服务 PLMN、IMSI 内嵌 PLMN 必须一致 | UE 选不到小区，或注册被拒 `PLMN not allowed` |
| **切片 S-NSSAI（SST/SD）** | UE 请求 NSSAI、gNB 支持切片、AMF 服务切片、签约切片必须一致（含 SD） | AMF 拒绝 `No Allowed-NSSAI` / `Cannot find Requested NSSAI`（cause 62） |
| **鉴权凭据 K / OPC** | UE 的 key/op 与签约用户一致 | 鉴权失败（MAC 校验失败） |
| **opType** | 若存储的是 OPC，UE 必须设 `opType: 'OPC'`；若存储的是 OP 则设 `'OP'` | 鉴权永久失败 |
| **PDU 会话类型** | UE 请求的 session type（IPv4/IPv6/IPv4v6）须与签约会话类型匹配 | `PDU session type [IPV4V6] is not supported` |
| **DNN/APN** | UE 请求的 apn 须在签约会话中存在 | PDU 会话建立被拒 |

### 排障命令速查

```bash
# AMF 侧注册拒绝原因
docker logs amf 2>&1 | grep -iE "reject|cause|nssai|fail|error"

# gNB-AMF NGAP 状态
docker logs amf 2>&1 | grep -i "Number of gNBs"

# UE 侧 NAS 状态机
docker logs nr_ue 2>&1 | grep -iE "mm-|registration|pdu|reject"

# 查看渲染后的实际配置
docker exec nr_gnb cat /UERANSIM/config/ueransim-gnb.yaml
docker exec nr_ue  cat /UERANSIM/config/ueransim-ue.yaml
```

---

## 11. 流程小结

```
1. 起核心网 NF（amf/smf/upf/udm/ausf/udr/nrf...）
2. 起 gNB → NG Setup 成功（AMF: Number of gNBs is now 1）
3. 开户（WebUI 或 open5gs-dbctl，写入 IMSI/K/OPC/切片/DNN）
4. 起 UE → 选 PLMN/小区 → 初始注册 → 鉴权(含 SQN 重同步) → SMC → 注册成功
5. UE 建立 PDU 会话 → uesimtun0 UP，获得 UE IP
6. ping -I uesimtun0 8.8.8.8 验证数据面
```
