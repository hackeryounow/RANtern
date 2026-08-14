# ULCL（Uplink Classifier）配置介绍 —— Free5GC 与 Open5GS

> 本文介绍 5G 核心网中 **ULCL（Uplink Classifier，上行分类器）** 的概念、作用，
> 并分别给出 **Free5GC** 与 **Open5GS** 两套开源核心网的 ULCL 配置方法。
> Free5GC 部分依据其官网配置文档及本地 `free5gc-compose` 的 ULCL 配置；
> Open5GS 部分依据 `docker_open5gs` 的 SMF/UPF 配置结构与 Open5GS 的 ULCL/Branching-Point 机制。

---

## 1. ULCL 概念

**ULCL（Uplink Classifier，上行分类器）** 是 3GPP 在 Release 16 引入的一种用户面分流机制
（TS 23.501 / TS 23.502）。它在 PDU 会话内部插入一个 **分流节点**，根据流量描述
（目的 IP / 端口 / 应用）把上行流量导向不同的 **PDU 会话锚点（PSA, PDU Session Anchor）**，
从而实现「同一个 PDU 会话，部分流量走本地边缘、其余流量走中心锚点」的本地分流（Local Breakout / MEC）。

核心网元角色：

| 角色 | 全称 | 作用 |
|------|------|------|
| **I-UPF** | Intermediate UPF（中间 UPF） | 位于 gNB 与锚点之间，承载 N3（面向 gNB）与 N9（面向锚点）。在 ULCL 场景中，I-UPF 同时充当 **ULCL / Branching Point**，按分流规则把流量复制到不同 PSA。 |
| **PSA-UPF** | PDU Session Anchor UPF | PDU 会话锚点，分配并锚定 UE IP，连接数据网络（DN）。一个 PDU 会话可有多个 PSA。 |
| **ULCL/BP** | Uplink Classifier / Branching Point | 分流功能实体。ULCL 基于 IP 五元组分流；Branching Point 基于流量复制。通常由 I-UPF 兼任。 |

数据面拓扑（单 I-UPF + 双 PSA 的典型 ULCL）：

```
                 ┌──(N9)── PSA-UPF(本地/边缘) ── 本地 DN (如 1.0.0.1)
UE ──(N3)── gNB ── I-UPF(ULCL)
                 └──(N9)── PSA-UPF(中心锚点) ── 互联网 DN
```

- **默认路径**：gNB → I-UPF → 中心 PSA-UPF → 互联网。
- **分流路径**：当流量命中分流规则（如目的 `1.0.0.1/32`），I-UPF 将其导向本地 PSA-UPF → 本地 DN。
- 下行方向对称：本地 DN 的响应经本地 PSA → I-UPF 汇聚后回到 UE。

> ULCL 与多 UPF 的关系：ULCL 必然涉及多个 UPF（至少 1 个 I-UPF + 1 个 PSA），
> 但「多 UPF」不一定开启 ULCL（也可能只是 N9 级联）。是否分流由 SMF 的 ULCL 开关与路由规则决定。

---

## 2. Free5GC ULCL 配置

Free5GC 通过 **SMF 配置（`smfcfg.yaml`）+ UE 路由配置（`uerouting.yaml`）+ 多个 UPF 配置** 实现 ULCL。
本地参考实现位于 `free5gc-compose/config/ULCL/` 与 `docker-compose-ulcl.yaml`。

### 2.1 用户面拓扑与节点

Free5GC 在 `smfcfg.yaml` 的 `userplaneInformation` 中显式声明用户面拓扑图（节点 + 链路）：

```yaml
configuration:
  ulcl: true                       # ★ 开启 ULCL 的总开关
  userplaneInformation:
    upNodes:                       # 用户面节点（AN 或 UPF）
      gNB1:
        type: AN
        nodeID: gnb.free5gc.org
      I-UPF:                       # 中间 UPF（兼任 ULCL）
        type: UPF
        nodeID: i-upf.free5gc.org
        sNssaiUpfInfos:
          - sNssai: { sst: 1, sd: 010203 }
            dnnUpfInfoList:
              - dnn: internet
                dnaiList: [ mec ]  # 关联本地 DN 接入标识（DNAI）
        interfaces:
          - interfaceType: N3      # 面向 gNB
            endpoints: [ i-upf.free5gc.org ]
            networkInstances: [ internet ]
          - interfaceType: N9      # 面向 PSA-UPF
            endpoints: [ i-upf.free5gc.org ]
            networkInstances: [ internet ]
      PSA-UPF:                     # PDU 会话锚点
        type: UPF
        nodeID: psa-upf.free5gc.org
        sNssaiUpfInfos:
          - sNssai: { sst: 1, sd: 010203 }
            dnnUpfInfoList:
              - dnn: internet
                pools:
                  - cidr: 10.60.0.0/16   # ★ UE IP 地址池在锚点 UPF 上分配
        interfaces:
          - interfaceType: N9
            endpoints: [ psa-upf.free5gc.org ]
            networkInstances: [ internet ]
    links:                         # 用户面拓扑链路（A-B 无向边）
      - { A: gNB1,  B: I-UPF }
      - { A: I-UPF, B: PSA-UPF }
```

要点：
- `ulcl: true` 是开启 ULCL 的总开关。
- 节点名（`gNB1` / `I-UPF` / `PSA-UPF`）必须与 `uerouting.yaml` 中的拓扑节点名一致。
- **UE IP 地址池（`pools.cidr`）配置在 PSA-UPF 上**（锚点分配 UE IP），I-UPF 不分配 UE IP。
- I-UPF 同时声明 N3 与 N9 接口；PSA-UPF 仅声明 N9。

### 2.2 UE 路由与分流规则（uerouting.yaml）

分流路径与规则在 `uerouting.yaml` 中按 UE（或 UE 组）配置：

```yaml
ueRoutingInfo:
  UE1:                              # 路由组名
    members:
      - imsi-208930000000001        # 组内 UE 的 SUPI
    topology:                       # 该组的用户面拓扑（上行 A->B，下行 B->A）
      - { A: gNB1,  B: I-UPF }      # 默认路径由该拓扑推导
      - { A: I-UPF, B: PSA-UPF }
    specificPath:                   # ★ 分流路径（特定目的走指定路径）
      - dest: 1.0.0.1/32            # 目的地址（命中即分流）
        path: [ I-UPF ]             # 该路径经过的节点

pfdDataForApp:                      # 应用级 PFD（按应用分流，可选）
  - applicationId: app1
    pfds:
      - pfdID: pfd1
        flowDescriptions:
          - permit out ip from 1.0.0.1/32 to 10.60.0.0/16
```

要点：
- `topology` 定义默认转发路径；`specificPath` 定义命中 `dest`（目的 IP/网段，可含端口）时的分流路径。
- `pfdDataForApp` 支持按 **应用（PFD，Packet Flow Description）** 分流，粒度比单纯 IP 更细。
- SUPI 用于把路由规则绑定到具体 UE。

### 2.3 各 UPF 配置（upfcfg）

每个 UPF 独立配置文件，关键是 **PFCP（N4）节点** 与 **GTP-U（N3/N9）接口列表**：

I-UPF（`upfcfg-i-upf.yaml`）—— 同时具备 N3 与 N9：

```yaml
pfcp:
  addr: i-upf.free5gc.org
  nodeID: i-upf.free5gc.org
gtpu:
  forwarder: gtp5g
  ifList:
    - { addr: i-upf.free5gc.org, type: N3 }   # 面向 gNB
    - { addr: i-upf.free5gc.org, type: N9 }   # 面向 PSA-UPF
dnnList:
  - { dnn: internet, cidr: 10.60.0.0/16 }
```

PSA-UPF（`upfcfg-psa-upf.yaml`）—— 仅 N9（锚点）：

```yaml
pfcp:
  addr: psa-upf.free5gc.org
  nodeID: psa-upf.free5gc.org
gtpu:
  forwarder: gtp5g
  ifList:
    - { addr: psa-upf.free5gc.org, type: N9 }
dnnList:
  - { dnn: internet, cidr: 10.60.0.0/16 }     # UE IP 池
```

> Free5GC UPF 依赖内核 `gtp5g` 模块转发用户面（`forwarder: gtp5g`），UPF 容器需 `cap_add: NET_ADMIN`。

### 2.4 编排（docker-compose-ulcl.yaml）

两个 UPF 作为独立服务，SMF 同时挂载 ULCL 版 `smfcfg.yaml` 与 `uerouting.yaml`：

```yaml
free5gc-i-upf:
  image: free5gc/upf:v4.0.1
  command: bash -c "./upf-iptables.sh && ./upf -c ./config/upfcfg.yaml"
  volumes:
    - ./config/ULCL/upfcfg-i-upf.yaml:/free5gc/config/upfcfg.yaml
  cap_add: [ NET_ADMIN ]
  networks: { privnet: { aliases: [ i-upf.free5gc.org ] } }

free5gc-psa-upf:
  image: free5gc/upf:v4.0.1
  volumes:
    - ./config/ULCL/upfcfg-psa-upf.yaml:/free5gc/config/upfcfg.yaml
  networks: { privnet: { aliases: [ psa-upf.free5gc.org ] } }

free5gc-smf:
  command: ./smf -c ./config/smfcfg.yaml -u ./config/uerouting.yaml   # ★ -u 指定路由文件
  volumes:
    - ./config/ULCL/smfcfg.yaml:/free5gc/config/smfcfg.yaml
    - ./config/ULCL/uerouting.yaml:/free5gc/config/uerouting.yaml
  depends_on: [ free5gc-nrf, free5gc-i-upf, free5gc-psa-upf ]
```

启动：

```bash
cd free5gc-compose
docker compose -f docker-compose-ulcl.yaml up -d
```

### 2.5 UE 侧配置

ULCL 对 UE 透明，UE 仍按常规配置（`uecfg-ulcl.yaml`），关键是切片/DNN 与 SMF 一致：

```yaml
supi: "imsi-208930000000001"
mcc: "208"
mnc: "93"
key: "8baf473f2f8fd09487cccbd7097c6862"
op: "8e27b6af0e692e750f32667a3b14605d"
opType: "OPC"
sessions:
  - type: "IPv4"
    apn: "internet"
    slice: { sst: 0x01, sd: 0x010203 }   # 须与 smfcfg 的 sNssai 一致
```

### 2.6 Free5GC ULCL 配置要点小结

| 文件 | 关键配置 | 作用 |
|------|----------|------|
| `smfcfg.yaml` | `ulcl: true`、`userplaneInformation`（upNodes + links） | 开启 ULCL，声明用户面拓扑 |
| `uerouting.yaml` | `topology`、`specificPath`、`pfdDataForApp` | 定义默认路径与分流规则 |
| `upfcfg-i-upf.yaml` | N3 + N9 接口 | I-UPF（兼任 ULCL） |
| `upfcfg-psa-upf.yaml` | 仅 N9、UE IP 池 | PSA 锚点 |
| `docker-compose-ulcl.yaml` | 两个 UPF 服务、SMF `-u uerouting.yaml` | 编排 |

---

## 3. Open5GS ULCL 配置

Open5GS 同样支持 ULCL / Branching Point（Release 16 用户面分流）。与 Free5GC 不同，
Open5GS **没有独立的 `uerouting.yaml`**，分流通过 **SMF 连接多个 UPF（PFCP 多客户端）+ 每个 UPF 独立的会话子网**，
并结合 PCF 的会话/业务流策略（PCC 规则）来实现。`docker_open5gs` 默认是单 UPF 部署，
其 SMF/UPF 配置结构天然支持扩展为多 UPF 的 ULCL 拓扑。

### 3.1 默认单 UPF 结构（docker_open5gs）

SMF 通过 PFCP（N4）连接 UPF，并声明会话子网（`smf/smf.yaml`）：

```yaml
smf:
    pfcp:
      server:
        - address: SMF_IP
      client:
        upf:
          - address: UPF_IP          # ★ 默认仅一个 UPF
    session:
      - subnet: UE_IPV4_INTERNET_SUBNET     # 互联网会话子网
        gateway: UE_IPV4_INTERNET_TUN_IP
        dnn: internet
      - subnet: 2001:230:cafe::/48
        gateway: 2001:230:cafe::1
        dnn: internet
      - subnet: UE_IPV4_IMS_SUBNET          # IMS 会话子网
        gateway: UE_IPV4_IMS_TUN_IP
        dnn: ims
    dns:
      - SMF_DNS1
      - SMF_DNS2
```

UPF 侧（`upf/upf.yaml`）声明 PFCP、GTP-U 与会话子网（绑定 TUN 设备）：

```yaml
upf:
    pfcp:
      server:
        - address: UPF_IP
      client:
        smf:
          - address: SMF_IP
    gtpu:
      server:
        - address: UPF_IP
          advertise: UPF_ADVERTISE_IP
    session:
      - subnet: UE_IPV4_INTERNET_SUBNET
        gateway: UE_IPV4_INTERNET_TUN_IP
        dnn: internet
        dev: ogstun                  # ★ 子网绑定到 TUN 设备
      - subnet: UE_IPV4_IMS_SUBNET
        gateway: UE_IPV4_IMS_TUN_IP
        dnn: ims
        dev: ogstun2
```

### 3.2 扩展为 ULCL（多 UPF）

Open5GS 的 ULCL 通过以下三步配置：

**第一步：SMF 连接多个 UPF（PFCP 多客户端）。**
在 `smf.yaml` 的 `pfcp.client.upf` 下增加边缘 UPF（I-UPF/ULCL）与中心锚点 UPF：

```yaml
smf:
    pfcp:
      server:
        - address: SMF_IP
      client:
        upf:
          - address: I_UPF_IP        # 中间/分流 UPF（靠近 gNB）
          - address: PSA_UPF_IP      # 中心锚点 UPF
    session:
      - subnet: 10.45.0.0/16         # 互联网会话子网（锚点分配 UE IP）
        gateway: 10.45.0.1
        dnn: internet
```

> Open5GS SMF 会按 PFCP 关联与 UPF 容量/选择策略，把 N3  terminating 在 I-UPF、
> N9 锚定在 PSA-UPF，从而构建 I-UPF → PSA-UPF 的多跳用户面。

**第二步：每个 UPF 配置各自的 GTP-U 与会话子网。**
边缘 I-UPF 面向 gNB（N3）并转发到锚点（N9）；PSA-UPF 锚定 UE IP 子网并连接 DN。
各 UPF 的 `upf.yaml` 中 `session.subnet` 需与 SMF 的 `session` 对应。

**第三步：配置分流规则（PCC / 业务流模板）。**
Open5GS 的 ULCL 分流由 **PCF 下发的 PCC 规则** 驱动：通过业务流模板（SDF Filter，目的 IP/端口）
把特定流量绑定到对应的 QoS 流与分流路径。`docker_open5gs` 中 PCF 会话策略位于 `pcf/`，
也可通过 Open5GS WebUI 的切片/会话配置为不同 DNN 指定不同的 UPF/子网。

### 3.3 与 Free5GC 的差异对比

| 维度 | Free5GC | Open5GS |
|------|---------|---------|
| ULCL 开关 | `smfcfg.yaml` 中 `ulcl: true` | 无显式开关，靠多 UPF + PCC 规则 |
| 路由/分流定义 | 独立 `uerouting.yaml`（`specificPath` / `pfdDataForApp`） | 由 PCF 的 PCC 规则（SDF Filter）驱动 |
| 用户面拓扑 | `smfcfg.yaml` 的 `userplaneInformation`（upNodes + links）显式声明 | SMF `pfcp.client.upf` 多 UPF，拓扑由 SMF 选择 |
| UE IP 分配 | PSA-UPF 的 `pools.cidr` | SMF/UPF 的 `session.subnet` |
| 用户面转发 | 内核 `gtp5g` 模块 | Open5GS 自带 GTP 用户面（`ogstun` TUN） |
| 配置入口 | 静态 YAML 文件为主 | YAML + WebUI/PCF 策略 |

### 3.4 Open5GS ULCL 配置要点小结

1. **多 UPF**：SMF `pfcp.client.upf` 列出 I-UPF 与 PSA-UPF 等多个 UPF 地址。
2. **会话子网**：SMF 与 UPF 的 `session.subnet` 保持一致，UE IP 由锚点子网分配，子网绑定 TUN 设备（`dev: ogstun`）。
3. **分流规则**：通过 PCF 的 PCC 规则（SDF Filter，目的 IP/端口）把特定业务流导向边缘 UPF。
4. **N9 级联**：I-UPF 与 PSA-UPF 之间通过 N9（GTP-U）级联，I-UPF 兼任 ULCL/Branching Point。

---

## 4. 参考

- Free5GC 官网配置文档（ULCL / `uerouting.yaml` / `smfcfg.yaml`）：`https://free5gc.org/guide/`
- 本地 Free5GC ULCL 配置：`free5gc-compose/config/ULCL/`、`free5gc-compose/docker-compose-ulcl.yaml`
- 本地 Open5GS 部署：`docker_open5gs/smf/smf.yaml`、`docker_open5gs/upf/upf.yaml`
- 3GPP TS 23.501 / TS 23.502（ULCL 与 Branching Point 架构）
- Open5GS ULCL / N9 多 UPF 讨论：Open5GS GitHub Discussions（#797 "About N9 interface for Uplink Classifier"）
