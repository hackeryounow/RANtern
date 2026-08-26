/**
 * TopologyEditor — interactive AntV X6 network topology editor.
 *
 * Drag NFs from the palette onto the canvas, wire them NIC-to-NIC (ports),
 * configure each NF/link in the right sidebar, then Run to deploy all
 * containers. After deploy, right-click a node for logs / shell / restart /
 * stop, surfaced in the bottom console panel.
 *
 * The X6 graph is the source of truth for layout + wiring; the topology
 * document (nodes + links) is derived from it on save/deploy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { Dnd } from '@antv/x6-plugin-dnd';
import { Selection } from '@antv/x6-plugin-selection';
import { Snapline } from '@antv/x6-plugin-snapline';
import { Keyboard } from '@antv/x6-plugin-keyboard';
import { Button, Dropdown, Input, Segmented, Select, Space, Tooltip, message, Modal, notification } from 'antd';
import {
  SaveOutlined, CaretRightOutlined, StopOutlined,
  FolderOpenOutlined, ClearOutlined, ContainerOutlined,
  CodeOutlined, TableOutlined,
  ExpandOutlined, TagOutlined, ApartmentOutlined, DeploymentUnitOutlined, PlusOutlined,
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  DashboardOutlined, ZoomInOutlined, ZoomOutOutlined, ImportOutlined,
} from '@ant-design/icons';
import {
  listTopologies, getTopologyDoc, updateTopology, deployTopology, undeployTopology,
  getTopologyStatus, restartTopologyNode, stopTopologyNode, getDefaultTemplate,
  getDefaultTemplateVariants,
  startLinkCapture, getNfKinds, checkTopologyImagesDoc, pullDockerImage,
} from '../../services/api';
import type { TopologyDoc, TopologyNode, TopologyLink, TopologyImageStatus } from '../../services/api';
import NFNodeShape from './NFNodeShape';
import BridgeShape from './BridgeShape';
import NFPalette, { type NfKind } from './NFPalette';
import NFConfigSidebar, { type Selection as SidebarSelection } from '../NFConfigSidebar';
import NodeConsolePanel, { type ConsoleTab } from './NodeConsolePanel';
import ImagesDrawer from './ImagesDrawer';
import TopologiesDrawer from './TopologiesDrawer';
import YamlPanel from './YamlPanel';
import InspectPanel from './InspectPanel';
import {
  NODE_WIDTH, NODE_HEIGHT, BRIDGE_WIDTH, BRIDGE_HEIGHT,
  nfColor, perimeterPortPosition, bridgePortPosition, PORT_RADIUS,
} from './nfMeta';

const mono = 'Consolas, Liberation Mono, Menlo, monospace';

// ── Register the custom React shapes once ───────────────────────────────
let shapeRegistered = false;
function ensureShapeRegistered() {
  if (shapeRegistered) return;
  register({
    shape: 'nf-node',
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    component: NFNodeShape,
  });
  register({
    shape: 'bridge-node',
    width: BRIDGE_WIDTH,
    height: BRIDGE_HEIGHT,
    component: BridgeShape,
  });
  shapeRegistered = true;
}

function buildPorts(ifaceNames: string[], accent: string) {
  return {
    groups: {
      nic: {
        position: { name: 'absolute' },
        attrs: {
          circle: {
            r: PORT_RADIUS,
            magnet: true,
            // Invisible connector: keep the magnet hit-area but hide the dot.
            fill: 'transparent',
            stroke: 'transparent',
            style: { cursor: 'crosshair' },
          },
        },
      },
    },
    items: ifaceNames.map((name, i) => ({
      id: name,
      group: 'nic',
      args: perimeterPortPosition(i, ifaceNames.length),
    })),
  };
}

/**
 * Ports for a bridge: multiple visual connection points (taps) along the bus
 * bar, all belonging to the single `net0` network. Port IDs are `net0.N`;
 * graphToDoc strips the `.N` suffix so the data model stays `iface: "net0"`.
 */
function buildBridgePorts(tapCount: number, width = BRIDGE_WIDTH) {
  const count = Math.max(tapCount, 2); // always show at least 2 taps
  return {
    groups: {
      nic: {
        position: { name: 'absolute' },
        attrs: {
          circle: {
            r: PORT_RADIUS,
            magnet: true,
            // Invisible connector: keep the magnet hit-area but hide the dot.
            fill: 'transparent',
            stroke: 'transparent',
            style: { cursor: 'crosshair' },
          },
        },
      },
    },
    items: Array.from({ length: count }, (_, i) => ({
      id: `net0.${i}`,
      group: 'nic',
      args: bridgePortPosition(i, count, width),
    })),
  };
}

/** Strip the visual tap suffix (e.g. "net0.2" -> "net0") for bridge ports. */
function bridgeIface(port: string): string {
  const m = port.match(/^(net0)\.\d+$/);
  return m ? m[1] : port;
}

function stripPrefix(ip?: string): string | undefined {
  if (!ip) return undefined;
  return ip.includes('/') ? ip.split('/')[0] : ip;
}

const EDGE_LABEL = (a: string, b: string) => ({
  position: 0.5,
  attrs: {
    label: { text: `${a} ↔ ${b}`, fill: '#7d92b8', fontSize: 9, fontFamily: mono, textAnchor: 'middle' },
    rect: { fill: '#0d1117', stroke: '#24466e55', rx: 3, ry: 3, refWidth: 6, refHeight: 4, refX: -3, refY: -2 },
  },
});

const EDGE_STROKE = '#3a5580';

export default function TopologyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const dndRef = useRef<Dnd | null>(null);

  // Refs expose the latest state/actions to the one-time graph event handlers
  // (the graph is initialised once, so plain closures would go stale).
  const isDeployedRef = useRef(false);
  const actionsRef = useRef<{
    deleteSelected: () => void;
    deleteCell: (id: string) => void;
    save: () => void;
    deploy: () => void;
    deselect: () => void;
    onNodeClick: (nodeId: string, clientX: number, clientY: number) => void;
  }>({
    deleteSelected: () => {},
    deleteCell: () => {},
    save: () => {},
    deploy: () => {},
    deselect: () => {},
    onNodeClick: () => {},
  });

  // ContainerLab-style "connect from a free interface" flow. Right-clicking a
  // design-phase node lists its unwired interfaces; picking one arms
  // pendingConnect, then clicking a target node (and one of its free
  // interfaces, if several) draws the wire.
  const [pendingConnect, setPendingConnect] = useState<{ nodeId: string; iface: string } | null>(null);
  const pendingConnectRef = useRef<{ nodeId: string; iface: string } | null>(null);
  const [targetMenu, setTargetMenu] = useState<{ x: number; y: number; nodeId: string; ifaces: string[] } | null>(null);

  const [topoName, setTopoName] = useState('my-topology');
  const [coreType, setCoreType] = useState('open5gs');
  const [savedTopos, setSavedTopos] = useState<{ name: string; core_type: string }[]>([]);

  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [links, setLinks] = useState<TopologyLink[]>([]);
  const [globals, setGlobals] = useState<Record<string, any>>({});
  const [selection, setSelection] = useState<SidebarSelection>(null);

  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [undeploying, setUndeploying] = useState(false);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; linkId: string } | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [toposOpen, setToposOpen] = useState(false);
  const [consoleTabs, setConsoleTabs] = useState<ConsoleTab[]>([]);
  const [activeConsole, setActiveConsole] = useState<string | null>(null);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);

  const [yamlOpen, setYamlOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({});
  const [topoStats, setTopoStats] = useState<{ running: number; total: number; cpu: number }>({ running: 0, total: 0, cpu: 0 });
  const [kindImages, setKindImages] = useState<Record<string, string>>({});
  const [templateVariants, setTemplateVariants] = useState<{ id: string; label: string }[]>([]);

  // ── Fetch the NF catalog (kind -> docker image) for info display ──
  useEffect(() => {
    getNfKinds(coreType)
      .then((r) => {
        const map: Record<string, string> = {};
        (r.data?.kinds || []).forEach((k: NfKind) => {
          if (k.image) map[k.kind] = k.image;
        });
        setKindImages(map);
      })
      .catch(() => setKindImages({}));
  }, [coreType]);

  // ── Fetch the available default-template variants for the current core ──
  useEffect(() => {
    getDefaultTemplateVariants(coreType)
      .then((r) => setTemplateVariants(r.data || []))
      .catch(() => setTemplateVariants([]));
  }, [coreType]);

  // ── Derive the topology document from the graph ──
  const graphToDoc = useCallback((): TopologyDoc => {
    const g = graphRef.current;
    const docNodes: TopologyNode[] = [];
    const docLinks: TopologyLink[] = [];
    if (g) {
      g.getNodes().forEach((n) => {
        const d = (n.getData() || {}) as any;
        const p = n.getPosition();
        docNodes.push({ id: n.id, kind: d.kind, x: p.x, y: p.y, interfaces: d.interfaces || {}, config: d.config || {} });
      });
      g.getEdges().forEach((e) => {
        const s = e.getSource() as any;
        const t = e.getTarget() as any;
        // Bridge visual taps (net0.N) map to the single net0 interface.
        const sNode = g.getCellById(s.cell);
        const tNode = g.getCellById(t.cell);
        const sIface = (sNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(s.port) : s.port;
        const tIface = (tNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(t.port) : t.port;
        docLinks.push({ id: e.id, endpoints: [{ node: s.cell, iface: sIface }, { node: t.cell, iface: tIface }] });
      });
    }
    return { name: topoName, core_type: coreType, globals, nodes: docNodes, links: docLinks };
  }, [topoName, coreType, globals]);

  const syncFromGraph = useCallback(() => {
    const doc = graphToDoc();
    setNodes(doc.nodes);
    setLinks(doc.links);
  }, [graphToDoc]);

  // ── Initialise the graph ──
  useEffect(() => {
    if (!containerRef.current) return;
    ensureShapeRegistered();

    const graph = new Graph({
      container: containerRef.current,
      background: { color: '#0b0f18' },
      grid: { visible: true, size: 20, type: 'dot', args: { color: '#1a2744', thickness: 1 } },
      connecting: {
        snap: true,
        allowBlank: false,
        allowLoop: false,
        allowMulti: 'withPort',
        highlight: true,
        router: { name: 'manhattan' },
        connector: { name: 'rounded' },
        connectionPoint: 'anchor',
        anchor: 'center',
        // Any magnet on the canvas is a NIC port, so always allow starting a
        // wire from it. (Checking magnet.getAttribute('port') here is fragile
        // across X6 versions and blocked linking.)
        validateMagnet() {
          return true;
        },
        validateConnection({ sourceCell, sourcePort, targetCell, targetPort }) {
          if (!sourcePort || !targetPort) return false;
          if (sourceCell === targetCell && sourcePort === targetPort) return false;
          return true;
        },
        createEdge() {
          return this.createEdge({
            shape: 'edge',
            zIndex: -1,
            attrs: { line: { stroke: EDGE_STROKE, strokeWidth: 1.5, targetMarker: null, sourceMarker: null } },
          });
        },
      },
      highlighting: {
        magnetAdsorbed: { name: 'stroke', args: { attrs: { fill: '#00d4ff', stroke: '#00d4ff' } } },
      },
      interacting: { edgeMovable: false, edgeLabelMovable: false },
      // Drag on blank canvas pans the view (lets users reach off-screen nodes);
      // ctrl/⌘ + mouse-wheel zooms. Node dragging is unaffected.
      panning: { enabled: true, eventTypes: ['leftMouseDown'] },
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.2, maxScale: 4, zoomAtMousePosition: true },
    });

    // rubberband (left-drag selection box) is disabled because left-drag on blank
    // now pans the canvas; shift+click still multi-selects nodes.
    graph.use(new Selection({ rubberband: false, showNodeSelectionBox: true, movable: true, multiple: true, modifiers: 'shift' }));
    graph.use(new Snapline());
    dndRef.current = new Dnd({ target: graph });
    graphRef.current = graph;

    // ── Keyboard shortcuts (canvas-scoped; won't fire while typing in inputs) ──
    graph.use(new Keyboard({ enabled: true }));
    graph.bindKey(['delete', 'backspace'], () => actionsRef.current.deleteSelected());
    graph.bindKey(['ctrl+s', 'meta+s'], (e) => {
      e.preventDefault();
      actionsRef.current.save();
    });
    graph.bindKey(['ctrl+enter', 'meta+enter'], () => actionsRef.current.deploy());
    graph.bindKey('escape', () => actionsRef.current.deselect());

    // ── Events ──
    // node:click is routed through actionsRef so the one-time handler can see
    // the latest pending-connect state (either complete a wire or select).
    graph.on('node:click', ({ e, node }) => {
      actionsRef.current.onNodeClick(node.id, e.clientX, e.clientY);
    });
    graph.on('edge:click', ({ edge }) => setSelection({ type: 'link', linkId: edge.id }));
    graph.on('blank:click', () => {
      actionsRef.current.deselect();
    });
    graph.on('edge:connected', ({ edge }) => {
      const s = edge.getSource() as any;
      const t = edge.getTarget() as any;
      if (s?.port && t?.port) {
        // Show clean iface names (strip bridge tap suffix).
        const sNode = graph.getCellById(s.cell);
        const tNode = graph.getCellById(t.cell);
        const sLabel = (sNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(s.port) : s.port;
        const tLabel = (tNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(t.port) : t.port;
        edge.setLabels([EDGE_LABEL(sLabel, tLabel)]);
      }
      syncFromGraph();
    });
    graph.on('node:contextmenu', ({ e, node }) => {
      e.preventDefault();
      // The menu opens for every node; the renderer decides between runtime
      // actions (deployed) and the free-interface connect menu (design phase).
      const rect = containerRef.current!.getBoundingClientRect();
      setLinkMenu(null);
      setTargetMenu(null);
      setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId: node.id });
    });
    graph.on('edge:contextmenu', ({ e, edge }) => {
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      setCtxMenu(null);
      setTargetMenu(null);
      setLinkMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, linkId: edge.id });
    });

    // ── Hover delete button (design phase only) ──
    graph.on('node:mouseenter', ({ node }) => {
      if (isDeployedRef.current) return;
      node.addTools({
        name: 'button',
        args: {
          markup: [
            { tagName: 'circle', selector: 'button', attrs: { r: 8, fill: '#ff4d4f', stroke: '#0d1117', strokeWidth: 1 } },
            { tagName: 'text', selector: 'icon', attrs: { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#ffffff', 'font-size': 9, 'font-weight': 700, text: '✕', 'pointer-events': 'none' } },
          ],
          x: '100%',
          y: 0,
          offset: { x: -2, y: 2 },
          onClick: () => actionsRef.current.deleteCell(node.id),
        },
      });
    });
    graph.on('node:mouseleave', ({ node }) => {
      node.removeTools();
    });
    graph.on('node:moved', () => syncFromGraph());
    graph.on('node:added', () => syncFromGraph());
    graph.on('node:removed', ({ node }) => {
      setSelection((sel) => (sel?.type === 'node' && sel.nodeId === node.id ? null : sel));
      syncFromGraph();
    });
    graph.on('edge:removed', ({ edge }) => {
      setSelection((sel) => (sel?.type === 'link' && sel.linkId === edge.id ? null : sel));
      syncFromGraph();
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        graph.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      graph.dispose();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load saved topology list ──
  const refreshTopoList = useCallback(() => {
    listTopologies()
      .then((r) => setSavedTopos(r.data?.topologies || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshTopoList();
  }, [refreshTopoList]);

  // ── Status polling -> node LEDs ──
  const refreshStatus = useCallback(() => {
    if (!topoName) return;
    getTopologyStatus(topoName)
      .then((r) => {
        const map: Record<string, string> = {};
        let running = 0;
        let cpu = 0;
        const containers = r.data?.containers || [];
        containers.forEach((c: any) => {
          if (c.node_id) map[c.node_id] = c.status;
          if (c.status === 'running') {
            running += 1;
            cpu += c.cpu_pct || 0;
          }
        });
        setNodeStatuses(map);
        setTopoStats({ running, total: containers.length, cpu });
        graphRef.current?.getNodes().forEach((n) => {
          const d = (n.getData() || {}) as any;
          n.setData({ ...d, status: map[n.id] || 'not_found' });
        });
      })
      .catch(() => {});
  }, [topoName]);

  useEffect(() => {
    if (!topoName) return;
    refreshStatus();
    const iv = setInterval(refreshStatus, 4000);
    return () => clearInterval(iv);
  }, [topoName, refreshStatus]);

  // ── Node id generator ──
  const nextNodeId = useCallback((kind: string) => {
    const existing = graphRef.current?.getNodes().map((n) => n.id) || [];
    let max = 0;
    existing.forEach((id) => {
      const m = id.match(new RegExp(`^${kind}(\\d+)$`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${kind}${max + 1}`;
  }, []);

  // ── Drag from palette ──
  const handleStartDrag = useCallback(
    (kind: NfKind, e: React.MouseEvent) => {
      const g = graphRef.current;
      const dnd = dndRef.current;
      if (!g || !dnd) return;
      const id = nextNodeId(kind.kind);

      // Bridge = single Docker network (net0). Show 4 initial connection taps.
      if (kind.kind === 'bridge') {
        const ifaces: Record<string, any> = { net0: {} };
        const node = g.createNode({
          shape: 'bridge-node',
          id,
          width: BRIDGE_WIDTH,
          height: BRIDGE_HEIGHT,
          data: { kind: 'bridge', label: kind.label, nodeId: id, interfaces: ifaces, config: {} },
          ports: buildBridgePorts(4),
        });
        dnd.start(node, e.nativeEvent);
        return;
      }

      const ifaces: Record<string, any> = {};
      (kind.interfaces || []).forEach((name) => {
        ifaces[name] = {};
      });
      if (Object.keys(ifaces).length === 0) ifaces.eth0 = {};
      const accent = nfColor(kind.kind);
      const node = g.createNode({
        shape: 'nf-node',
        id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: { kind: kind.kind, label: kind.label, nodeId: id, interfaces: ifaces, config: {}, status: 'not_found' },
        ports: buildPorts(Object.keys(ifaces), accent),
      });
      dnd.start(node, e.nativeEvent);
    },
    [nextNodeId],
  );

  // ── Add custom node (from palette dialog) ──
  const handleAddCustom = useCallback(
    (def: { name: string; image: string; interfaces: string[]; config: Record<string, any> }) => {
      const g = graphRef.current;
      if (!g) return;
      const id = def.name || `custom${Date.now()}`;
      const ifaces: Record<string, any> = {};
      def.interfaces.forEach((n) => { ifaces[n] = {}; });
      const accent = '#a78bfa'; // purple for custom nodes
      const node = g.addNode({
        shape: 'nf-node',
        id,
        x: 200 + Math.random() * 200,
        y: 150 + Math.random() * 150,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: {
          kind: 'custom',
          label: def.name,
          nodeId: id,
          interfaces: ifaces,
          config: { ...def.config, image: def.image || undefined },
          status: 'not_found',
          image: def.image,
        },
        ports: buildPorts(Object.keys(ifaces), accent),
      });
      g.centerCell(node);
      syncFromGraph();
      message.success(`Added custom node "${id}"`);
    },
    [syncFromGraph],
  );

  // ── Sidebar patches ──
  const handlePatchNode = useCallback(
    (nodeId: string, patch: { interfaces?: Record<string, any>; config?: Record<string, any> }) => {
      const cell = graphRef.current?.getCellById(nodeId);
      if (!cell || !cell.isNode()) return;
      const d = (cell.getData() || {}) as any;
      const merged = { ...d, ...patch };
      if (merged.kind === 'bridge') {
        if (patch.interfaces) {
          // Count current links to determine how many taps to show.
          const tapCount = Math.max(Object.keys(patch.interfaces).length, 4);
          cell.setProp('ports', buildBridgePorts(tapCount));
        }
        cell.setData(merged);
        syncFromGraph();
        return;
      }
      const firstIface = Object.values<any>(merged.interfaces || {})[0];
      merged.ip = stripPrefix(firstIface?.ip);
      if (patch.interfaces) {
        cell.setProp('ports', buildPorts(Object.keys(patch.interfaces), nfColor(merged.kind)));
      }
      cell.setData(merged);
      syncFromGraph();
    },
    [syncFromGraph],
  );

  // ── Structural deletion (guarded by deployed state) ──
  // Removing a node also drops its wires (X6 removes connected edges); the
  // node:removed / edge:removed handlers then sync the document.
  const deleteCells = useCallback((cells: any[]) => {
    if (!cells.length) return;
    if (isDeployedRef.current) {
      message.warning('Topology is deployed — undeploy it before changing the structure');
      return;
    }
    const g = graphRef.current;
    if (!g) return;
    g.removeCells(cells);
    setSelection(null);
  }, []);

  const deleteCell = useCallback((id: string) => {
    const cell = graphRef.current?.getCellById(id);
    if (cell) deleteCells([cell]);
  }, [deleteCells]);

  const deleteSelected = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const selected = (g as any).getSelectedCells?.() || [];
    deleteCells(selected);
  }, [deleteCells]);

  const handleDeleteLink = useCallback((linkId: string) => {
    if (isDeployedRef.current) {
      message.warning('Topology is deployed — undeploy it before changing the structure');
      return;
    }
    graphRef.current?.removeCell(linkId);
    setSelection(null);
  }, []);

  // ── ContainerLab-style connect flow (design phase) ────────────────────
  // Right-click a node -> pick one of its FREE interfaces -> click a target
  // node (auto-picks its single free interface, or opens a picker) -> wire.

  /** Interface names of a node that have no wire attached yet. */
  const getFreeInterfaces = useCallback((nodeId: string): string[] => {
    const g = graphRef.current;
    if (!g) return [];
    const cell = g.getCellById(nodeId);
    if (!cell || !cell.isNode()) return [];
    const d = (cell.getData() || {}) as any;
    const ifaces = Object.keys(d.interfaces || {});
    // A bridge is a shared L2 network (net0) — it always has room for a tap.
    if (d.kind === 'bridge') return ifaces;
    const used = new Set<string>();
    g.getEdges().forEach((e) => {
      ([e.getSource(), e.getTarget()] as any[]).forEach((ep) => {
        if (ep?.cell === nodeId) used.add(bridgeIface(String(ep.port)));
      });
    });
    return ifaces.filter((i) => !used.has(i));
  }, []);

  /** Pick the lowest free visual tap (net0.N) on a bridge, growing taps if needed. */
  const allocateBridgeTap = useCallback((nodeId: string): string => {
    const g = graphRef.current;
    if (!g) return 'net0.0';
    const cell = g.getCellById(nodeId);
    const used = new Set<number>();
    g.getEdges().forEach((e) => {
      ([e.getSource(), e.getTarget()] as any[]).forEach((ep) => {
        if (ep?.cell === nodeId) {
          const m = String(ep.port).match(/^net0\.(\d+)$/);
          if (m) used.add(parseInt(m[1], 10));
        }
      });
    });
    let idx = 0;
    while (used.has(idx)) idx += 1;
    const portId = `net0.${idx}`;
    const existing = ((cell as any)?.getPorts?.() || []) as any[];
    if (cell && !existing.some((p) => p.id === portId)) {
      const width = (cell as any).getSize?.().width || BRIDGE_WIDTH;
      (cell as any).setProp?.('ports', buildBridgePorts(Math.max(existing.length, idx + 1), width));
    }
    return portId;
  }, []);

  /** Map a logical iface to the actual X6 port id (bridge -> net0.N tap). */
  const resolvePort = useCallback(
    (nodeId: string, iface: string): string => {
      const kind = (graphRef.current?.getCellById(nodeId)?.getData() as any)?.kind;
      return kind === 'bridge' ? allocateBridgeTap(nodeId) : iface;
    },
    [allocateBridgeTap],
  );

  /** Draw a wire between two (node, iface) endpoints and sync the doc. */
  const connectPair = useCallback(
    (src: { nodeId: string; iface: string }, tgt: { nodeId: string; iface: string }) => {
      const g = graphRef.current;
      if (!g) return;
      const srcPort = resolvePort(src.nodeId, src.iface);
      const tgtPort = resolvePort(tgt.nodeId, tgt.iface);
      const edge = g.addEdge({
        shape: 'edge',
        zIndex: -1,
        source: { cell: src.nodeId, port: srcPort },
        target: { cell: tgt.nodeId, port: tgtPort },
        attrs: { line: { stroke: EDGE_STROKE, strokeWidth: 1.5, targetMarker: null, sourceMarker: null } },
      });
      edge.setLabels([EDGE_LABEL(bridgeIface(srcPort), bridgeIface(tgtPort))]);
      syncFromGraph();
      message.success(`Linked ${src.nodeId}:${bridgeIface(srcPort)} ↔ ${tgt.nodeId}:${bridgeIface(tgtPort)}`);
    },
    [resolvePort, syncFromGraph],
  );

  const finishConnect = useCallback(() => {
    setPendingConnect(null);
    setTargetMenu(null);
    (graphRef.current as any)?.cleanSelection?.();
  }, []);

  const cancelConnect = useCallback(() => {
    setPendingConnect(null);
    setTargetMenu(null);
  }, []);

  /** Arm the connect flow from a chosen source interface. */
  const startConnect = useCallback((nodeId: string, iface: string) => {
    setCtxMenu(null);
    setTargetMenu(null);
    setPendingConnect({ nodeId, iface });
    const g = graphRef.current;
    const cell = g?.getCellById(nodeId);
    if (g && cell) {
      (g as any).cleanSelection?.();
      (g as any).select?.(cell);
    }
  }, []);

  /** Handle a node click while the connect flow is armed. */
  const completeConnect = useCallback(
    (targetNodeId: string, clientX: number, clientY: number) => {
      const pending = pendingConnectRef.current;
      if (!pending) return;
      if (targetNodeId === pending.nodeId) {
        message.warning('Choose a different target node');
        return;
      }
      const g = graphRef.current;
      if (!g) return;
      const isBridge = (g.getCellById(targetNodeId)?.getData() as any)?.kind === 'bridge';
      const free = isBridge ? ['net0'] : getFreeInterfaces(targetNodeId);
      if (free.length === 0) {
        message.warning(`${targetNodeId} has no free interface`);
        return;
      }
      if (free.length === 1) {
        connectPair(pending, { nodeId: targetNodeId, iface: free[0] });
        finishConnect();
        return;
      }
      // Several free interfaces -> let the user pick one on the target.
      const rect = containerRef.current!.getBoundingClientRect();
      setTargetMenu({ x: clientX - rect.left, y: clientY - rect.top, nodeId: targetNodeId, ifaces: free });
    },
    [getFreeInterfaces, connectPair, finishConnect],
  );

  // ── Auto-pull missing Docker images when a document is loaded ──
  // After any doc is rendered (saved topology / default template), ask the
  // backend which node images are absent locally and pull them automatically,
  // reporting per-image progress in a single stacked notification.
  const pullStateRef = useRef<Record<string, 'pulling' | 'done' | 'error'>>({});

  const renderPullNotification = useCallback(() => {
    const entries = Object.entries(pullStateRef.current);
    if (!entries.length) return;
    const active = entries.filter(([, s]) => s === 'pulling').length;
    const icon = (s: string) =>
      s === 'done' ? (
        <CheckCircleOutlined style={{ color: '#52c41a' }} />
      ) : s === 'error' ? (
        <CloseCircleOutlined style={{ color: '#ff7875' }} />
      ) : (
        <LoadingOutlined style={{ color: '#00d4ff' }} />
      );
    notification.open({
      key: 'nf-image-pull',
      message:
        active > 0
          ? `Auto-pulling ${active} missing image${active > 1 ? 's' : ''}\u2026`
          : 'Image pull finished',
      description: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(([img, s]) => (
            <div
              key={img}
              style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13, fontFamily: mono }}
            >
              {icon(s)}
              <span style={{ wordBreak: 'break-all', color: s === 'error' ? '#ff7875' : undefined }}>
                {img}
              </span>
              {s === 'error' && (
                <span style={{ color: '#8a9bb8', fontSize: 12 }}>(build or upload it locally)</span>
              )}
            </div>
          ))}
        </div>
      ),
      duration: active > 0 ? 0 : 6,
      placement: 'bottomRight',
    });
  }, []);

  const ensureImages = useCallback(
    (doc: TopologyDoc) => {
      checkTopologyImagesDoc(doc)
        .then((r) => {
          const images: TopologyImageStatus[] = r.data?.images || [];
          const missing = Array.from(
            new Set(images.filter((i) => !i.exists).map((i) => i.image)),
          );
          if (!missing.length) return;
          // Drop finished history from previous loads when nothing is active.
          const anyActive = Object.values(pullStateRef.current).some((s) => s === 'pulling');
          if (!anyActive) pullStateRef.current = {};
          missing.forEach((img) => {
            pullStateRef.current[img] = 'pulling';
          });
          renderPullNotification();
          missing.forEach((img) => {
            pullDockerImage(
              img,
              (evt) => {
                if (evt.done) {
                  pullStateRef.current[img] = 'done';
                  renderPullNotification();
                } else if (evt.error) {
                  pullStateRef.current[img] = 'error';
                  renderPullNotification();
                }
              },
              () => {
                // Socket closed without a terminal event -> treat as failed.
                if (pullStateRef.current[img] === 'pulling') {
                  pullStateRef.current[img] = 'error';
                  renderPullNotification();
                }
              },
            );
          });
        })
        .catch(() => {
          /* image check is best-effort; never block editing */
        });
    },
    [renderPullNotification],
  );

  // ── Render a topology document into the graph ──
  const renderDoc = useCallback((doc: TopologyDoc, label: string) => {
    const g = graphRef.current;
    if (!g) return;
    g.clearCells();
    setTopoName(doc.name);
    setCoreType(doc.core_type || 'open5gs');
    setGlobals(doc.globals || {});

    // Pre-scan: count links per bridge node to size the taps.
    const bridgeLinkCount: Record<string, number> = {};
    (doc.links || []).forEach((l) => {
      (l.endpoints || []).forEach((ep) => {
        const nd = (doc.nodes || []).find((n) => n.id === ep.node);
        if (nd?.kind === 'bridge') {
          bridgeLinkCount[ep.node] = (bridgeLinkCount[ep.node] || 0) + 1;
        }
      });
    });

    (doc.nodes || []).forEach((n) => {
      const ifaces = n.interfaces || { eth0: {} };
      if (n.kind === 'bridge') {
        const taps = Math.max(bridgeLinkCount[n.id] || 0, 4);
        // Widen the bus bar so many SBI taps spread out like a real backplane
        // (>= node width apart so NFs aligned over taps never overlap).
        const bw = Math.max(BRIDGE_WIDTH, taps * 170);
        g.addNode({
          shape: 'bridge-node',
          id: n.id,
          x: n.x ?? 80,
          y: n.y ?? 80,
          width: bw,
          height: BRIDGE_HEIGHT,
          data: {
            kind: 'bridge',
            label: 'BRIDGE',
            nodeId: n.id,
            interfaces: ifaces,
            config: n.config || {},
          },
          ports: buildBridgePorts(taps, bw),
        });
        return;
      }
      const accent = nfColor(n.kind);
      const firstIface = Object.values<any>(ifaces)[0];
      g.addNode({
        shape: 'nf-node',
        id: n.id,
        x: n.x ?? 80,
        y: n.y ?? 80,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: {
          kind: n.kind,
          label: n.kind.toUpperCase(),
          nodeId: n.id,
          interfaces: ifaces,
          config: n.config || {},
          status: 'not_found',
          ip: stripPrefix(firstIface?.ip),
        },
        ports: buildPorts(Object.keys(ifaces), accent),
      });
    });

    // Track tap assignment for bridge ports (distribute links across taps).
    const bridgeTapIdx: Record<string, number> = {};
    const resolvePort = (ep: { node: string; iface: string }): string => {
      const nd = (doc.nodes || []).find((n) => n.id === ep.node);
      if (nd?.kind === 'bridge') {
        const key = ep.node;
        const idx = bridgeTapIdx[key] || 0;
        bridgeTapIdx[key] = idx + 1;
        return `net0.${idx}`;
      }
      return ep.iface;
    };

    (doc.links || []).forEach((l) => {
      const [a, b] = l.endpoints || [];
      if (!a || !b) return;
      const portA = resolvePort(a);
      const portB = resolvePort(b);
      g.addEdge({
        id: l.id,
        shape: 'edge',
        zIndex: -1,
        source: { cell: a.node, port: portA },
        target: { cell: b.node, port: portB },
        attrs: { line: { stroke: EDGE_STROKE, strokeWidth: 1.5, targetMarker: null, sourceMarker: null } },
        labels: [EDGE_LABEL(a.iface, b.iface)],
      });
    });
    syncFromGraph();
    message.success(`Loaded ${label}`);
    ensureImages(doc);
    // Fit the topology to the viewport so the canvas space is used well.
    setTimeout(() => g.zoomToFit({ padding: 40, maxScale: 1.2 }), 100);
  }, [syncFromGraph, ensureImages]);

  // ── Load a saved topology into the graph ──
  const loadTopology = useCallback((name: string) => {
    getTopologyDoc(name)
      .then((r) => renderDoc(r.data as TopologyDoc, name))
      .catch((e) => message.error(e.response?.data?.detail || 'Failed to load'));
  }, [renderDoc]);

  // ── Load a 3GPP default template variant for the current core ──
  const handleLoadDefaultTemplate = useCallback((variant: string, label: string) => {
    const apply = () => {
      getDefaultTemplate(coreType, variant)
        .then((r) => renderDoc(r.data as TopologyDoc, `${coreType} ${label} template`))
        .catch((e) => message.error(e.response?.data?.detail || 'Failed to load template'));
    };
    if (graphRef.current && graphRef.current.getNodes().length > 0) {
      Modal.confirm({
        title: 'Load default template?',
        content: `This replaces the current canvas with the 3GPP-wired ${coreType} "${label}" template.`,
        onOk: apply,
      });
    } else {
      apply();
    }
  }, [coreType, renderDoc]);

  // ── Start packet capture on a link ──
  const handleStartLinkCapture = useCallback(
    async (linkId: string) => {
      setLinkMenu(null);
      try {
        await startLinkCapture(topoName, linkId);
        message.success('Capture started — see the Capture tab to stop / view / download');
      } catch (e: any) {
        message.error(e.response?.data?.detail || 'Capture failed (save & deploy the topology first)');
      }
    },
    [topoName],
  );

  // ── Save / Deploy / Undeploy ──
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!topoName.trim()) {
      message.warning('Enter a topology name');
      return false;
    }
    setSaving(true);
    try {
      await updateTopology(topoName, graphToDoc());
      refreshTopoList();
      message.success('Topology saved');
      return true;
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, [topoName, graphToDoc, refreshTopoList]);

  // After deploy the engine assigns + persists final interface IPs. Surgically
  // update graph node data (keeping positions/selection) so the sidebar shows
  // the assigned addresses and the doc state matches the running containers.
  const applyDocDataToGraph = useCallback((doc: TopologyDoc) => {
    const g = graphRef.current;
    if (!g) return;
    (doc.nodes || []).forEach((n) => {
      const cell = g.getCellById(n.id);
      if (!cell || !cell.isNode()) return;
      const d = (cell.getData() || {}) as any;
      const ifaces = n.interfaces || {};
      const patch: Record<string, any> = { ...d, interfaces: ifaces, config: n.config || {} };
      if (d.kind !== 'bridge') {
        const firstIface = Object.values<any>(ifaces)[0];
        patch.ip = stripPrefix(firstIface?.ip);
      }
      cell.setData(patch);
    });
    setGlobals(doc.globals || {});
    syncFromGraph();
  }, [syncFromGraph]);

  const handleDeploy = useCallback(async () => {
    const ok = await handleSave();
    if (!ok) return;
    setDeploying(true);
    try {
      const r = await deployTopology(topoName);
      const data = r.data || {};
      if (data.status === 'deployed') {
        message.success(`Topology deployed (${(data.containers || []).length} containers)`);
      } else if (data.status === 'partial') {
        const failed = (data.containers || []).filter((c: any) => c.status === 'error');
        message.warning(
          `Deploy partial — ${failed.length} container(s) failed: ` +
            failed.map((c: any) => `${c.node_id}: ${c.error}`).join('; '),
          8,
        );
      } else {
        message.warning(`Deploy finished with status: ${data.status}`);
      }
      // Reflect the engine-assigned interface IPs and lock config (deployed).
      try {
        const docR = await getTopologyDoc(topoName);
        applyDocDataToGraph(docR.data as TopologyDoc);
      } catch {
        /* non-fatal */
      }
      refreshStatus();
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message || 'Deploy failed', 8);
    } finally {
      setDeploying(false);
    }
  }, [topoName, handleSave, applyDocDataToGraph, refreshStatus]);

  const handleUndeploy = useCallback(() => {
    Modal.confirm({
      title: 'Undeploy topology?',
      content: `This stops and removes all containers for "${topoName}".`,
      okType: 'danger',
      onOk: async () => {
        setUndeploying(true);
        try {
          await undeployTopology(topoName);
          message.success('Topology undeployed');
          refreshStatus();
        } catch (e: any) {
          message.error(e.response?.data?.detail || 'Undeploy failed');
        } finally {
          setUndeploying(false);
        }
      },
    });
  }, [topoName, refreshStatus]);

  const handleClear = useCallback(() => {
    graphRef.current?.clearCells();
    setSelection(null);
    syncFromGraph();
  }, [syncFromGraph]);

  // ── New topology (clear + reset name) ──
  const handleNew = useCallback(() => {
    const doNew = () => {
      graphRef.current?.clearCells();
      setSelection(null);
      setTopoName('my-topology');
      setGlobals({});
      syncFromGraph();
    };
    if (graphRef.current && graphRef.current.getNodes().length > 0) {
      Modal.confirm({
        title: 'Create new topology?',
        content: 'This clears the current canvas. Unsaved changes will be lost.',
        onOk: doNew,
      });
    } else {
      doNew();
    }
  }, [syncFromGraph]);

  const handleCoreChange = useCallback(
    (core: string) => {
      if (graphRef.current && graphRef.current.getNodes().length > 0 && core !== coreType) {
        Modal.confirm({
          title: 'Switch core type?',
          content: 'Changing the core type clears the current canvas.',
          onOk: () => {
            setCoreType(core);
            handleClear();
          },
        });
      } else {
        setCoreType(core);
      }
    },
    [coreType, handleClear],
  );

  // ── Console (logs / shell) ──
  const openConsole = useCallback((nodeId: string, mode: 'logs' | 'shell') => {
    const key = `${nodeId}-${mode}`;
    setConsoleTabs((tabs) => (tabs.some((t) => t.key === key) ? tabs : [...tabs, { key, nodeId, nodeLabel: nodeId, mode }]));
    setActiveConsole(key);
    setConsoleCollapsed(false);
    setCtxMenu(null);
  }, []);

  const closeConsoleTab = useCallback((key: string) => {
    setConsoleTabs((tabs) => {
      const next = tabs.filter((t) => t.key !== key);
      setActiveConsole((cur) => (cur === key ? next[next.length - 1]?.key ?? null : cur));
      return next;
    });
  }, []);

  const handleRestartNode = useCallback(
    async (nodeId: string) => {
      setCtxMenu(null);
      try {
        await restartTopologyNode(topoName, nodeId);
        message.success(`${nodeId} restarting`);
      } catch (e: any) {
        message.error(e.response?.data?.detail || 'Restart failed');
      }
    },
    [topoName],
  );

  const handleStopNode = useCallback(
    async (nodeId: string) => {
      setCtxMenu(null);
      try {
        await stopTopologyNode(topoName, nodeId);
        message.success(`${nodeId} stopped`);
      } catch (e: any) {
        message.error(e.response?.data?.detail || 'Stop failed');
      }
    },
    [topoName],
  );

  // ── Toolbar: Fit to viewport ──
  const handleFitViewport = useCallback(() => {
    graphRef.current?.zoomToFit({ padding: 40, maxScale: 1.2 });
  }, []);

  // ── Toolbar: Zoom in / out ──
  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoom(0.1);
  }, []);
  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoom(-0.1);
  }, []);

  // ── Toolbar: Toggle edge labels ──
  const handleToggleLabels = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const next = !labelsVisible;
    setLabelsVisible(next);
    g.getEdges().forEach((edge) => {
      if (next) {
        // Restore labels from source/target port info
        const s = edge.getSource() as any;
        const t = edge.getTarget() as any;
        const sNode = g.getCellById(s.cell);
        const tNode = g.getCellById(t.cell);
        const sLabel = (sNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(s.port) : s.port;
        const tLabel = (tNode?.getData() as any)?.kind === 'bridge' ? bridgeIface(t.port) : t.port;
        edge.setLabels([EDGE_LABEL(sLabel || '', tLabel || '')]);
      } else {
        edge.setLabels([]);
      }
    });
  }, [labelsVisible]);

  // ── Toolbar: Auto layout (bridge-centric radial) ──
  const handleAutoLayout = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const nodesArr = g.getNodes();
    if (nodesArr.length === 0) return;

    // Separate bridge, RAN, user-plane, and control-plane nodes.
    const bridgeNodes: any[] = [];
    const ranNodes: any[] = [];
    const upNodes: any[] = [];   // UPF, ext-dn
    const cpNodes: any[] = [];   // everything else (SBI NFs)

    nodesArr.forEach((n) => {
      const kind = (n.getData() as any)?.kind || '';
      if (kind === 'bridge') bridgeNodes.push(n);
      else if (kind === 'gnb' || kind === 'ue' || kind === 'ran') ranNodes.push(n);
      else if (kind === 'upf' || kind === 'ext-dn') upNodes.push(n);
      else cpNodes.push(n);
    });

    const cx = 500, cy = 300; // bridge center

    // Place bridge(s) at center.
    bridgeNodes.forEach((n, i) => n.setPosition(cx, cy + i * 80));

    // RAN nodes on the left.
    ranNodes.forEach((n, i) => n.setPosition(60, cy - 60 + i * 160));

    // User-plane nodes below-left.
    upNodes.forEach((n, i) => n.setPosition(260, cy + 200 + i * 150));

    // Control-plane NFs in a grid on the right.
    const cols = 3;
    cpNodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      n.setPosition(cx + 200 + col * 180, 80 + row * 130);
    });

    syncFromGraph();
    setTimeout(() => g.zoomToFit({ padding: 40, maxScale: 1.2 }), 100);
  }, [syncFromGraph]);

  // ── Inspect panel: focus node on graph ──
  const handleFocusNode = useCallback((nodeId: string) => {
    const g = graphRef.current;
    if (!g) return;
    const cell = g.getCellById(nodeId);
    if (cell) {
      g.centerCell(cell);
      g.select(cell);
    }
  }, []);

  // ── YAML apply handler ──
  const handleYamlApply = useCallback((doc: TopologyDoc) => {
    renderDoc(doc, doc.name);
  }, [renderDoc]);

  // A topology is considered deployed once any of its containers exist.
  // While deployed, interface IPs are final and config editing is locked.
  const isDeployed = Object.values(nodeStatuses).some((s) => s && s !== 'not_found');

  // Per-node deployed check (used by the context menu to branch between
  // runtime actions and structural actions such as Delete).
  const isNodeDeployed = (nodeId: string) => {
    const s = nodeStatuses[nodeId];
    return !!s && s !== 'not_found';
  };

  // Keep the refs fresh so the one-time graph handlers (keyboard, hover
  // delete, context menu, node click) always act on the latest state/actions.
  useEffect(() => {
    isDeployedRef.current = isDeployed;
    pendingConnectRef.current = pendingConnect;
    actionsRef.current = {
      deleteSelected,
      deleteCell,
      save: () => {
        handleSave();
      },
      deploy: () => {
        handleDeploy();
      },
      deselect: () => {
        setSelection(null);
        setCtxMenu(null);
        setLinkMenu(null);
        cancelConnect();
      },
      onNodeClick: (nodeId, clientX, clientY) => {
        if (pendingConnectRef.current) {
          completeConnect(nodeId, clientX, clientY);
        } else {
          setSelection({ type: 'node', nodeId });
        }
      },
    };
  }, [isDeployed, pendingConnect, deleteSelected, deleteCell, handleSave, handleDeploy, cancelConnect, completeConnect]);

  // Free (unwired) interfaces of the right-clicked node, shown in the
  // design-phase context menu so the user can start a ContainerLab-style wire.
  const ctxFreeIfaces =
    ctxMenu && !isNodeDeployed(ctxMenu.nodeId) ? getFreeInterfaces(ctxMenu.nodeId) : [];

  // ── Render ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0e17' }}>
      {/* Toolbar — identity on the left, live stats + actions on the right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid #16233c',
          background: 'linear-gradient(180deg, #0d1420 0%, #0b0f18 100%)',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Input
          size="small"
          value={topoName}
          onChange={(e) => setTopoName(e.target.value)}
          placeholder="topology name"
          style={{ width: 160, fontFamily: mono, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}
        />
        <Tooltip title="New topology">
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleNew} className="topo-tbtn" />
        </Tooltip>
        <Segmented
          size="small"
          value={coreType}
          onChange={(v) => handleCoreChange(String(v))}
          options={[
            { value: 'open5gs', label: 'Open5GS' },
            { value: 'free5gc', label: 'Free5GC' },
          ]}
        />
        <Select
          size="small"
          placeholder="Open saved topology..."
          value={savedTopos.some((t) => t.name === topoName) ? topoName : undefined}
          onChange={(v) => v && loadTopology(v)}
          style={{ width: 210 }}
          popupMatchSelectWidth={false}
          suffixIcon={<FolderOpenOutlined />}
          options={savedTopos.map((t) => ({ value: t.name, label: `${t.name} (${t.core_type})` }))}
        />

        <Space size={4} style={{ marginLeft: 'auto' }} className="topo-toolbar">
          {/* Live running / CPU stats for this topology */}
          <Tooltip title={`${topoStats.running} of ${topoStats.total} containers running`}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 8,
                border: '1px solid #1e3a5f',
                background: 'rgba(255,255,255,0.02)',
                fontFamily: mono,
                fontSize: 11.5,
                marginRight: 4,
              }}
            >
              <span style={{ color: topoStats.running > 0 ? '#52c41a' : '#64748b' }}>●</span>
              <span style={{ color: '#b8c4e0' }}>{topoStats.running}/{topoStats.total} running</span>
              <span style={{ color: '#334155' }}>|</span>
              <DashboardOutlined style={{ color: '#00d4ff' }} />
              <span style={{ color: '#b8c4e0' }}>{topoStats.cpu.toFixed(1)}% CPU</span>
            </span>
          </Tooltip>

          <Tooltip title="Saved topologies & configs">
            <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={() => setToposOpen(true)} className="topo-tbtn" />
          </Tooltip>
          <Tooltip title="Docker images">
            <Button type="text" size="small" icon={<ContainerOutlined />} onClick={() => setImagesOpen(true)} className="topo-tbtn" />
          </Tooltip>
          <Tooltip title="View / edit topology YAML">
            <Button type="text" size="small" icon={<CodeOutlined />} onClick={() => setYamlOpen((v) => !v)} className={`topo-tbtn${yamlOpen ? ' topo-tbtn-active' : ''}`} />
          </Tooltip>
          <Tooltip title="Inspect nodes/links">
            <Button type="text" size="small" icon={<TableOutlined />} onClick={() => setInspectOpen((v) => !v)} className={`topo-tbtn${inspectOpen ? ' topo-tbtn-active' : ''}`} />
          </Tooltip>
          <Tooltip title="Clear canvas">
            <Button type="text" size="small" icon={<ClearOutlined />} onClick={() => {
              if (graphRef.current && graphRef.current.getNodes().length > 0) {
                Modal.confirm({
                  title: 'Clear canvas?',
                  content: 'This removes all nodes and links. Unsaved changes will be lost.',
                  okText: 'Clear',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  onOk: handleClear,
                });
              } else {
                handleClear();
              }
            }} className="topo-tbtn" />
          </Tooltip>

          <span className="topo-toolbar-divider" />

          <Button size="small" icon={<SaveOutlined />} onClick={() => handleSave()} loading={saving}
            style={{ borderRadius: 8 }}>
            Save
          </Button>
          <Tooltip title="Ctrl+Enter">
            <Button size="small" type="primary" icon={<CaretRightOutlined />} onClick={handleDeploy} loading={deploying}
              style={{ borderRadius: 8, background: 'linear-gradient(135deg, #23a55a, #15803d)', border: 'none', fontWeight: 600, boxShadow: '0 2px 10px rgba(34,197,94,0.25)' }}>
              Run
            </Button>
          </Tooltip>
          <Button size="small" danger ghost icon={<StopOutlined />} onClick={handleUndeploy} loading={undeploying}
            style={{ borderRadius: 8 }}>
            Stop
          </Button>
        </Space>
      </div>

      {/* Body: palette + canvas + sidebar */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <NFPalette core={coreType} onStartDrag={handleStartDrag} onAddCustom={handleAddCustom} />

        <div style={{ flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          {nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div
                style={{
                  pointerEvents: 'auto',
                  textAlign: 'center',
                  maxWidth: 440,
                  padding: '34px 40px',
                  borderRadius: 20,
                  background: 'rgba(13, 20, 32, 0.78)',
                  border: '1px solid #1c2b47',
                  backdropFilter: 'blur(10px)',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
                }}
              >
                <div
                  style={{
                    width: 62, height: 62, margin: '0 auto 16px', borderRadius: 18,
                    background: 'linear-gradient(135deg, rgba(0,212,255,0.16), rgba(99,102,241,0.16))',
                    border: '1px solid rgba(0,212,255,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 24px rgba(0,212,255,0.15)',
                  }}
                >
                  <ApartmentOutlined style={{ fontSize: 27, color: '#00d4ff' }} />
                </div>
                <div style={{ color: '#f0f4ff', fontSize: 16, fontWeight: 700 }}>Design your core network</div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 6, lineHeight: 1.7 }}>
                  Drag NF components from the palette, wire their interfaces,
                  then Run to deploy the containers.
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                  {templateVariants.length > 0 && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: templateVariants.map((v) => ({
                          key: v.id,
                          label: v.label,
                          onClick: () => handleLoadDefaultTemplate(v.id, v.label),
                        })),
                      }}
                    >
                      <Button type="primary" size="small" icon={<ImportOutlined />}
                        style={{ borderRadius: 8, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none', fontWeight: 600 }}>
                        Load 3GPP template
                      </Button>
                    </Dropdown>
                  )}
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setToposOpen(true)}
                    style={{ borderRadius: 8 }}>
                    Open saved
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Right-click context menu */}
          {ctxMenu && (
            <div
              style={{
                position: 'absolute',
                left: ctxMenu.x,
                top: ctxMenu.y,
                zIndex: 10,
                minWidth: 150,
                background: '#111827',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                padding: 4,
              }}
              onMouseLeave={() => setCtxMenu(null)}
            >
              {isNodeDeployed(ctxMenu.nodeId) ? (
                <>
                  <CtxItem label="View Logs" onClick={() => openConsole(ctxMenu.nodeId, 'logs')} />
                  <CtxItem label="Open Terminal" onClick={() => openConsole(ctxMenu.nodeId, 'shell')} />
                  <div style={{ height: 1, background: '#1e3a5f', margin: '4px 0' }} />
                  <CtxItem label="Restart" onClick={() => handleRestartNode(ctxMenu.nodeId)} />
                  <CtxItem label="Stop Container" danger onClick={() => handleStopNode(ctxMenu.nodeId)} />
                </>
              ) : (
                <>
                  <div
                    style={{
                      padding: '4px 10px 6px',
                      fontSize: 11,
                      color: '#64748b',
                      fontFamily: mono,
                      borderBottom: '1px solid #1e3a5f',
                      marginBottom: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ctxMenu.nodeId} · connect a free interface
                  </div>
                  {ctxFreeIfaces.length === 0 ? (
                    <div style={{ padding: '6px 10px', fontSize: 12, color: '#475569', fontFamily: mono, whiteSpace: 'nowrap' }}>
                      No free interface
                    </div>
                  ) : (
                    ctxFreeIfaces.map((iface) => (
                      <CtxItem
                        key={iface}
                        label={`⤳ ${iface}`}
                        onClick={() => startConnect(ctxMenu.nodeId, iface)}
                      />
                    ))
                  )}
                </>
              )}
            </div>
          )}

          {/* Right-click link context menu */}
          {linkMenu && (
            <div
              style={{
                position: 'absolute',
                left: linkMenu.x,
                top: linkMenu.y,
                zIndex: 10,
                minWidth: 180,
                background: '#111827',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                padding: 4,
              }}
              onMouseLeave={() => setLinkMenu(null)}
            >
              <CtxItem
                label="Capture packets on this link"
                onClick={() => handleStartLinkCapture(linkMenu.linkId)}
              />
              <CtxItem label="Delete link" danger onClick={() => handleDeleteLink(linkMenu.linkId)} />
            </div>
          )}

          {/* Target-interface picker (connect flow, when the target has several free ifaces) */}
          {targetMenu && (
            <div
              style={{
                position: 'absolute',
                left: targetMenu.x,
                top: targetMenu.y,
                zIndex: 12,
                minWidth: 160,
                background: '#111827',
                border: '1px solid #00d4ff66',
                borderRadius: 8,
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                padding: 4,
              }}
              onMouseLeave={() => setTargetMenu(null)}
            >
              <div
                style={{
                  padding: '4px 10px 6px',
                  fontSize: 11,
                  color: '#64748b',
                  fontFamily: mono,
                  borderBottom: '1px solid #1e3a5f',
                  marginBottom: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {targetMenu.nodeId} · pick target interface
              </div>
              {targetMenu.ifaces.map((iface) => (
                <CtxItem
                  key={iface}
                  label={`⤰ ${iface}`}
                  onClick={() => {
                    const pending = pendingConnectRef.current;
                    if (!pending) return;
                    connectPair(pending, { nodeId: targetMenu.nodeId, iface });
                    finishConnect();
                  }}
                />
              ))}
            </div>
          )}

          {/* Floating view controls (bottom-right) */}
          <div className="topo-fab">
            <Tooltip title="Zoom in" placement="left">
              <button className="topo-fab-btn" onClick={handleZoomIn}><ZoomInOutlined /></button>
            </Tooltip>
            <Tooltip title="Zoom out" placement="left">
              <button className="topo-fab-btn" onClick={handleZoomOut}><ZoomOutOutlined /></button>
            </Tooltip>
            <Tooltip title="Fit to viewport" placement="left">
              <button className="topo-fab-btn" onClick={handleFitViewport}><ExpandOutlined /></button>
            </Tooltip>
            <Tooltip title="Auto layout" placement="left">
              <button className="topo-fab-btn" onClick={handleAutoLayout}><DeploymentUnitOutlined /></button>
            </Tooltip>
            <div className="topo-fab-sep" />
            <Tooltip title="Toggle link labels" placement="left">
              <button className={`topo-fab-btn${labelsVisible ? ' active' : ''}`} onClick={handleToggleLabels}><TagOutlined /></button>
            </Tooltip>
          </div>

          {/* Pending-connect banner (connect flow armed) */}
          {pendingConnect && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: '#0d1117',
                border: '1px solid #00d4ff66',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                fontFamily: mono,
                color: '#00d4ff',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              <span>
                Connecting <b>{pendingConnect.nodeId}:{pendingConnect.iface}</b> → click a target node
              </span>
              <span style={{ color: '#64748b' }}>(Esc to cancel)</span>
              <Button size="small" type="text" onClick={cancelConnect} style={{ color: '#ff7875', height: 20 }}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <YamlPanel
          open={yamlOpen}
          onClose={() => setYamlOpen(false)}
          topoName={topoName}
          doc={graphToDoc()}
          onApply={handleYamlApply}
        />

        <NFConfigSidebar
          core={coreType}
          selection={selection}
          nodes={nodes}
          links={links}
          globals={globals}
          kindImages={kindImages}
          statuses={nodeStatuses}
          readOnly={isDeployed}
          onPatchNode={handlePatchNode}
          onPatchGlobals={setGlobals}
          onDeleteLink={handleDeleteLink}
          onClose={() => setSelection(null)}
        />
      </div>

      {/* Inspect panel (below canvas, above console) */}
      {inspectOpen && (
        <InspectPanel
          nodes={nodes}
          links={links}
          statuses={nodeStatuses}
          kindImages={kindImages}
          onFocusNode={handleFocusNode}
          onLogs={(id) => openConsole(id, 'logs')}
          onRestart={handleRestartNode}
          onStop={handleStopNode}
        />
      )}

      {/* Bottom console */}
      <NodeConsolePanel
        topoName={topoName}
        tabs={consoleTabs}
        activeKey={activeConsole}
        height={260}
        collapsed={consoleCollapsed}
        onSelectTab={(k) => {
          setActiveConsole(k);
          setConsoleCollapsed(false);
        }}
        onCloseTab={closeConsoleTab}
        onToggleCollapse={() => setConsoleCollapsed((c) => !c)}
        onCloseAll={() => {
          setConsoleTabs([]);
          setActiveConsole(null);
        }}
      />

      {/* Drawers */}
      <ImagesDrawer open={imagesOpen} onClose={() => setImagesOpen(false)} />
      <TopologiesDrawer
        open={toposOpen}
        onClose={() => setToposOpen(false)}
        onLoad={(name) => loadTopology(name)}
      />
    </div>
  );
}

function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12,
        color: danger ? '#ff4d4f' : '#e0e7ff',
        fontFamily: mono,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = '#1e293b')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
    >
      {label}
    </div>
  );
}
