# 3GPP Network Function Functions

This page describes the standard functions and key responsibilities of each core Network Function (NF) based on 3GPP **TS 23.501** (5G system architecture), to help you understand what each node in a topology actually *does*. For deployment details (images, ports, mounts) see [NF Components](/docs/nf-components); for how these NFs interact end to end, see [Core Network Procedures](/docs/procedures).

> Note: the following are functional summaries. Section numbers reference the general TS 23.501 version and are not verbatim quotes from the specification.

## 5G Core Network Functions (TS 23.501 §6.2)

### AMF — Access and Mobility Management Function (§6.2.1)

The first control-plane anchor a UE reaches (N1/N2 termination point).

- Registration management: handles UE registration / deregistration
- Connection management: establishes the signaling connection between UE and core
- Mobility management: tracking area updates, mobility events during handover
- Access authentication and authorization: works with AUSF / UDM
- Security anchor: anchors NAS ciphering / integrity protection
- Routes session management messages to the SMF

### SMF — Session Management Function (§6.2.2)

Responsible for the PDU session control plane.

- PDU session establishment / modification / release
- Allocates IP addresses to the UE
- Selects and controls the UPF (via N4 / PFCP)
- Policy enforcement and QoS control (interacts with PCF)
- Downlink data notification and session-related NAS handling

### UPF — User Plane Function (§6.2.3)

The user-plane data forwarding node (N3 / N6 / N9).

- Packet routing and forwarding (user-plane data anchor)
- Packet inspection and QoS flow to DRB mapping
- Uplink / downlink traffic measurement and charging reporting
- Downlink data buffering and triggering
- Acts as the PDU session anchor (session / branching point)

### AUSF — Authentication Server Function (§6.2.4)

- Performs 3GPP access authentication for the UE (5G-AKA / EAP-AKA')
- Works with the UDM to obtain authentication vectors
- Anchors the security context

### UDM — Unified Data Management (§6.2.5)

- Generates 3GPP access authentication credentials
- User identifier handling (SUPI / SUCI de-concealment)
- Subscription data management
- Session management subscription data, access authorization
- Interacts with the UDR to store/retrieve user data

### UDR — Unified Data Repository (§6.2.6)

- Stores subscription data, policy data, and structured exposure data
- Acts as the data persistence layer for UDM / PCF (Nudr interface)

### PCF — Policy Control Function (§6.2.7)

- Provides policy rules to control-plane NFs (AMF / SMF)
- QoS and charging policies for sessions / service data flows
- Mobility-related policies
- Reads policy subscription data from the UDR

### NRF — Network Repository Function (§6.2.8)

- Service discovery: maintains available NF instances and their supported services
- NF registration / deregistration / status notification
- Returns target NF instances to consumer NFs (the core of SBI service-based architecture)

### NSSF — Network Slice Selection Function (§6.2.9)

- Selects the set of network slices serving the UE
- Determines the allowed NSSAI and maps it to subscribed S-NSSAI
- Determines the set of AMFs serving the UE

### BSF — Binding Support Function (§6.2.10)

- Binds the PCF to the corresponding UE / session
- Helps consumer NFs find the correct PCF when multiple PCFs are deployed

### CHF — Charging Function (§6.2.11)

- Online / offline charging
- Receives charging events from NFs such as the SMF and generates charging records

### SCP — Service Communication Proxy (§6.2.12)

- Proxies SBI requests between NFs in the indirect communication model
- Provides NF selection, load balancing, and message routing

---

## 4G EPC Network Element Mapping (TS 23.501 §6.3 interworking)

The platform also supports the 4G EPC. The table below maps EPC network elements to their 5GC functional equivalents:

| 4G EPC Element | Function | Equivalent 5GC NF |
|----------------|----------|-------------------|
| **MME** | Mobility Management Entity: NAS signaling, authentication, bearer management | AMF (+ SMF session part) |
| **SGW-C** | Serving Gateway control plane: bearer / mobility anchor | SMF |
| **SGW-U** | Serving Gateway user plane: data forwarding / anchor | UPF |
| **PGW-C** | PDN Gateway control plane: IP allocation, policy | SMF (+ PCF) |
| **PGW-U** | PDN Gateway user plane: data forwarding to PDN | UPF |
| **HSS** | Home Subscriber Server: subscription / authentication data | UDM (+ UDR / AUSF) |
| **PCRF** | Policy and Charging Rules Function | PCF |

---

## Inter-NF Interfaces (Reference Points) Quick Reference

| Interface | Connects | Main Purpose |
|-----------|----------|--------------|
| N1 | UE ↔ AMF | NAS signaling |
| N2 | (R)AN ↔ AMF | NGAP signaling |
| N3 | (R)AN ↔ UPF | GTP-U user plane |
| N4 | SMF ↔ UPF | PFCP session control |
| N6 | UPF ↔ DN | Data network egress |
| N11 | AMF ↔ SMF | Session management signaling |
| N12 | AMF ↔ AUSF | Authentication |
| N8 / N10 | UDM ↔ AMF / SMF | Subscription / session data |
| N7 | SMF ↔ PCF | Policy |
| Nnrf | NF ↔ NRF | Service registration / discovery (SBI) |

> SBI (Service Based Interface): 5GC control-plane NFs interconnect over HTTP/2-based service interfaces, with the NRF providing unified service discovery.
