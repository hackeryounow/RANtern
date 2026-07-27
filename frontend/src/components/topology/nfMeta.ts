/**
 * Shared metadata + geometry helpers for the AntV X6 topology editor.
 *
 * NF accent colors, status colors, node dimensions and the port-layout math
 * used to distribute one NIC port per interface around a node's border
 * (ContainerLab-style endpoint wiring).
 */

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 74;

/** Bridge (L2 segment) node dimensions — rendered as a thin horizontal line. */
export const BRIDGE_WIDTH = 300;
export const BRIDGE_HEIGHT = 14;

/**
 * How far a port circle sits OUTSIDE the node border. Offsetting ports fully
 * outside the body guarantees they never overlap the React shape's div (which
 * lives inside the node's foreignObject), so pointer events always reach the
 * port magnet and NIC-to-NIC linking works reliably.
 */
export const PORT_RADIUS = 6;
export const PORT_OFFSET = PORT_RADIUS + 2;

/** Accent color per NF kind (used for node border + ports). */
export const NF_COLORS: Record<string, string> = {
  amf: '#00d4ff',
  smf: '#6366f1',
  upf: '#f59e0b',
  nrf: '#10b981',
  scp: '#a855f7',
  ausf: '#ec4899',
  udm: '#8b5cf6',
  udr: '#14b8a6',
  pcf: '#f97316',
  nssf: '#06b6d4',
  bsf: '#64748b',
  chf: '#d946ef',
  // 4G EPC
  mme: '#0ea5e9',
  sgwc: '#3b82f6',
  sgwu: '#f97316',
  hss: '#8b5cf6',
  pcrf: '#f43f5e',
  // data / ran
  mongodb: '#22c55e',
  db: '#22c55e',
  webui: '#38bdf8',
  gnb: '#84cc16',
  enb: '#a3e635',
  'ue-nr': '#4ade80',
  'ue-lte': '#bef264',
  'ext-dn': '#84cc16',
  // networking
  bridge: '#38bdf8',
  // custom
  custom: '#a78bfa',
};

export function nfColor(kind: string): string {
  return NF_COLORS[kind] || '#00d4ff';
}

/** LED color for a container status. */
export function statusColor(status?: string): string {
  switch (status) {
    case 'running':
      return '#52c41a';
    case 'restarting':
    case 'created':
      return '#faad14';
    case 'exited':
    case 'dead':
      return '#ff4d4f';
    default:
      return '#475569'; // not deployed / unknown
  }
}

/**
 * Compute the position for port `index` of `count` distributed clockwise
 * around the rectangle perimeter, pushed `offset` px OUTSIDE the border so the
 * port circle never overlaps the node body (keeps the magnet clickable).
 * Returns {x, y} in the node's local coordinate space.
 */
export function perimeterPortPosition(
  index: number,
  count: number,
  width = NODE_WIDTH,
  height = NODE_HEIGHT,
  offset = PORT_OFFSET,
): { x: number; y: number } {
  if (count <= 0) return { x: width / 2, y: -offset };
  // A single NIC sits at bottom-centre so SBI-only NFs drop a clean vertical
  // cable straight down to the bridge bus bar below them.
  if (count === 1) return { x: width / 2, y: height + offset };
  const perimeter = 2 * (width + height);
  // Offset by half a step so ports don't sit exactly on corners.
  const dist = ((index + 0.5) / count) * perimeter;

  // Walk the perimeter and push the point outward from that edge.
  if (dist <= width) {
    return { x: dist, y: -offset }; // top edge -> above
  }
  if (dist <= width + height) {
    return { x: width + offset, y: dist - width }; // right edge -> right
  }
  if (dist <= 2 * width + height) {
    return { x: width - (dist - width - height), y: height + offset }; // bottom -> below
  }
  return { x: -offset, y: height - (dist - 2 * width - height) }; // left -> left
}

/**
 * Position for a bridge port: distributed along the horizontal centre line of
 * the (thin) bridge bar, like taps on an Ethernet bus.
 */
export function bridgePortPosition(
  index: number,
  count: number,
  width = BRIDGE_WIDTH,
  height = BRIDGE_HEIGHT,
): { x: number; y: number } {
  if (count <= 0) return { x: width / 2, y: height / 2 };
  return { x: ((index + 0.5) / count) * width, y: height / 2 };
}

/** Short label for a category key. */
export const CATEGORY_LABELS: Record<string, string> = {
  '5g-control': '5G Control Plane',
  '5g-user': '5G User Plane',
  '4g-epc': '4G EPC',
  data: 'Data / Storage',
  ran: 'RAN / External',
  network: 'Networking',
};
