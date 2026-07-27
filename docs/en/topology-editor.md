# Topology Editor

## Overview

The topology editor is RANtern's core interactive surface, built on the AntV X6 graph engine. Users build core network topologies by drag and drop and deploy them as a Docker container cluster in one click.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (Deploy / Stop / Destroy / Save / Load / YAML)   │
├────────┬─────────────────────────────────────────────────┤
│        │                                                 │
│ Compo- │            Canvas (AntV X6)                      │
│ nent   │      Drag NFs · Wire · Pan · Zoom               │
│ Panel  │                                                 │
│(resize)│                                                 │
│        │                                                 │
├────────┴─────────────────────────────────────────────────┤
│  Log console (multi-tab · real-time logs · ANSI colors)   │
└──────────────────────────────────────────────────────────┘
```

## Component Panel

The left panel lists all available NFs, grouped by category:

- **5G Control Plane** — AMF, SMF, NRF, SCP, AUSF, UDM, UDR, PCF, NSSF, BSF, CHF
- **5G User Plane** — UPF
- **4G EPC** — MME, SGW-C, SGW-U, HSS, PCRF
- **Data / Storage** — MongoDB, WebUI
- **RAN / External** — gNodeB, eNodeB, UE (5G), UE (4G), Ext DN
- **Networking** — Bridge (L2)

The panel supports:
- **Search filter** — type a keyword to quickly locate an NF
- **Drag to add** — drag an NF onto the canvas
- **Custom node** — click "Custom Node" to add any Docker image
- **Resize** — drag the panel's right edge to adjust width (160px ~ 480px)

## Canvas Operations

| Action | How |
|--------|-----|
| Add NF | Drag from the left panel onto the canvas |
| Move NF | Drag the node |
| Wire | Drag from one node's port to another node's port |
| Pan canvas | Middle-mouse drag / drag on blank area |
| Zoom | Mouse wheel |
| Delete | Select and press Delete |
| View properties | Click a node/link; the Inspect panel opens on the right |

## Toolbar Functions

| Button | Function |
|--------|----------|
| ▶ Deploy | Deploy the current topology (create and start all containers) |
| ⏹ Stop | Stop all deployed containers |
| 🗑 Destroy | Destroy all containers + network + volumes |
| 💾 Save | Save the topology to the server |
| 📂 Load | Load a saved topology from the server |
| 📋 YAML | View/edit the current topology's YAML definition |
| 🏷 Toggle Labels | Show/hide link labels |
| 🐳 Images | Open the Docker image management drawer |

## Node Configuration

Click a placed node and the config sidebar (NFConfigSidebar) opens on the right, where you can edit:

- **PLMN config** — MCC, MNC
- **Network slices** — S-NSSAI (SST/SD), DNN, CIDR
- **Interface IPs** — IP address of each logical interface
- **Custom env vars** — key-value pairs

## Log Console

After deployment, click any node to view real-time logs in the bottom console:

- Multiple tabs to view several nodes' logs in parallel
- ANSI color rendering
- Pause/resume the log stream
- Clear logs
- Close a single tab or close all at once

## Topology Templates

Open the template drawer via the toolbar "Topologies" button:

- View the list of saved topologies
- Load a template onto the canvas in one click
- View a topology's YAML definition (full-screen modal)
- Delete topologies you no longer need

## Keyboard Shortcuts

| Shortcut | Function |
|----------|----------|
| `Delete` / `Backspace` | Delete selected node/link |
| `Ctrl + S` | Save topology |
| `Ctrl + =` / `Ctrl + -` | Zoom in/out |
| `Ctrl + 0` | Reset zoom |
