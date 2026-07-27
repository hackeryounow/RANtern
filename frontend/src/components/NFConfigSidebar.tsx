/**
 * NFConfigSidebar — right-hand inspector for the selected node or link.
 *
 * Node mode: edit the NF's NIC table (iface name + IP + live peer) and its
 * config overrides. Link mode: inspect the two `node:iface` endpoints, set
 * the IP on each side, and delete the wire. This is where ContainerLab-style
 * NIC configuration happens.
 */
import { useState } from 'react';
import { Typography, Input, Button, Tag, Divider, Switch, Space, Tooltip } from 'antd';
import {
  CloseOutlined, DeleteOutlined, PlusOutlined, ApiOutlined, NodeIndexOutlined, SettingOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import type { TopologyNode, TopologyLink } from '../services/api';
import { nfColor } from './topology/nfMeta';
import ConfigForm, { useConfigSchema } from './topology/ConfigForm';

const { Text } = Typography;

export type Selection =
  | { type: 'node'; nodeId: string }
  | { type: 'link'; linkId: string }
  | null;

interface NFConfigSidebarProps {
  core: string;
  selection: Selection;
  nodes: TopologyNode[];
  links: TopologyLink[];
  globals: Record<string, any>;
  kindImages?: Record<string, string>;
  statuses?: Record<string, string>;
  readOnly?: boolean;
  onPatchNode: (nodeId: string, patch: { interfaces?: Record<string, any>; config?: Record<string, any> }) => void;
  onPatchGlobals: (globals: Record<string, any>) => void;
  onDeleteLink: (linkId: string) => void;
  onClose: () => void;
}

const mono = 'Consolas, Liberation Mono, Menlo, monospace';

export default function NFConfigSidebar({
  core,
  selection,
  nodes,
  links,
  globals,
  kindImages,
  statuses,
  readOnly,
  onPatchNode,
  onPatchGlobals,
  onDeleteLink,
  onClose,
}: NFConfigSidebarProps) {
  const node = selection?.type === 'node' ? nodes.find((n) => n.id === selection.nodeId) : undefined;
  const link = selection?.type === 'link' ? links.find((l) => l.id === selection.linkId) : undefined;

  // Nothing selected -> show the lab-wide global defaults panel.
  if (!selection || (!node && !link)) {
    return (
      <div style={panelStyle}>
        <GlobalPanel core={core} globals={globals} readOnly={readOnly} onPatchGlobals={onPatchGlobals} />
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {node ? (
        <NodePanel core={core} node={node} links={links} nodes={nodes} kindImages={kindImages} status={statuses?.[node.id]} readOnly={readOnly} onPatchNode={onPatchNode} onClose={onClose} />
      ) : link ? (
        <LinkPanel link={link} nodes={nodes} readOnly={readOnly} onPatchNode={onPatchNode} onDeleteLink={onDeleteLink} onClose={onClose} />
      ) : null}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  width: 330,
  flexShrink: 0,
  borderLeft: '1px solid #1e3a5f',
  background: '#0d1117',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflowY: 'auto',
};

function Header({ title, onClose, accent }: { title: string; onClose: () => void; accent?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderBottom: '1px solid #1e3a5f',
        position: 'sticky',
        top: 0,
        background: '#0d1117',
        zIndex: 1,
      }}
    >
      <Space size={6}>
        {accent && <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />}
        <Text style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 700, fontFamily: mono }}>{title}</Text>
      </Space>
      <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} style={{ color: '#64748b' }} />
    </div>
  );
}

// ── Node panel ──────────────────────────────────────────────────────────
function NodePanel({
  core,
  node,
  links,
  nodes,
  kindImages,
  status,
  readOnly,
  onPatchNode,
  onClose,
}: {
  core: string;
  node: TopologyNode;
  links: TopologyLink[];
  nodes: TopologyNode[];
  kindImages?: Record<string, string>;
  status?: string;
  readOnly?: boolean;
  onPatchNode: NFConfigSidebarProps['onPatchNode'];
  onClose: () => void;
}) {
  const [rawMode, setRawMode] = useState(false);
  const schema = useConfigSchema(core, node.kind);
  const accent = nfColor(node.kind);
  const ifaces = node.interfaces || {};
  const ifaceNames = Object.keys(ifaces);

  // Resolve the docker image: per-node override -> custom config -> catalog default.
  const image = node.config?.image || node.image || kindImages?.[node.kind] || '';

  // Map iface -> connected peer "node:iface"
  const peerOf = (iface: string): string => {
    for (const l of links) {
      const eps = l.endpoints || [];
      const self = eps.find((e) => e.node === node.id && e.iface === iface);
      if (self) {
        const other = eps.find((e) => !(e.node === node.id && e.iface === iface));
        if (other) return `${other.node}:${other.iface}`;
      }
    }
    return '';
  };

  const setIfaceIp = (iface: string, ip: string) => {
    const next = { ...ifaces, [iface]: { ...(ifaces[iface] || {}), ip: ip || undefined } };
    onPatchNode(node.id, { interfaces: next });
  };

  const addIface = () => {
    let i = ifaceNames.length;
    let name = `eth${i}`;
    while (ifaces[name]) {
      i += 1;
      name = `eth${i}`;
    }
    onPatchNode(node.id, { interfaces: { ...ifaces, [name]: {} } });
  };

  const removeIface = (iface: string) => {
    const next = { ...ifaces };
    delete next[iface];
    onPatchNode(node.id, { interfaces: next });
  };

  return (
    <>
      <Header title={node.id} onClose={onClose} accent={accent} />
      <div style={{ padding: 12 }}>
        <Space size={6} wrap style={{ marginBottom: 10 }}>
          <Tag color="blue" style={{ borderRadius: 4, fontSize: 12 }}>{node.kind.toUpperCase()}</Tag>
          <Tag style={{ borderRadius: 4, fontSize: 12, background: '#1e293b', color: '#8a9bb8', border: '1px solid #334155' }}>
            {core}
          </Tag>
          {status && status !== 'not_found' && (
            <Tag
              style={{
                borderRadius: 4, fontSize: 12,
                background: status === 'running' ? '#0f2a1f' : '#2a1a1a',
                color: status === 'running' ? '#52c41a' : '#ff7875',
                border: `1px solid ${status === 'running' ? '#14532d' : '#5f2a2a'}`,
              }}
            >
              {status}
            </Tag>
          )}
        </Space>

        {readOnly && (
          <div
            style={{
              marginBottom: 10,
              padding: '6px 10px',
              borderRadius: 6,
              background: '#1a2332',
              border: '1px solid #2d4a6f',
              fontSize: 12,
              color: '#7dd3fc',
            }}
          >
            Deployed — interface IPs are assigned and configuration is locked.
            Undeploy to edit.
          </div>
        )}

        {/* Runtime / image info */}
        <div style={{ border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, background: '#111827', marginBottom: 14 }}>
          <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600 }}>
            <ContainerOutlined /> RUNTIME
          </Text>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Docker image</Text>
            <div
              style={{
                fontFamily: mono, fontSize: 13, color: image ? '#7dd3fc' : '#475569',
                background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '3px 6px',
                marginTop: 2, wordBreak: 'break-all',
              }}
            >
              {image || '— (not set)'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600 }}>
            <ApiOutlined /> INTERFACES (NIC)
          </Text>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={addIface} disabled={readOnly} style={{ color: '#00d4ff', fontSize: 13 }}>
            Add
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {ifaceNames.length === 0 && <Text type="secondary" style={{ fontSize: 13 }}>No interfaces</Text>}
          {ifaceNames.map((iface) => {
            const peer = peerOf(iface);
            return (
              <div key={iface} style={{ border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, background: '#111827' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ color: accent, fontSize: 12, fontWeight: 700, fontFamily: mono }}>{iface}</Text>
                  <Space size={4}>
                    {peer ? (
                      <Tooltip title="Connected peer">
                        <Tag style={{ borderRadius: 4, fontSize: 11, background: '#0f2a1f', color: '#52c41a', border: '1px solid #14532d' }}>
                          {peer}
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Tag style={{ borderRadius: 4, fontSize: 11, background: '#1e293b', color: '#64748b', border: '1px solid #334155' }}>
                        unlinked
                      </Tag>
                    )}
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeIface(iface)} disabled={readOnly} style={{ fontSize: 12 }} />
                  </Space>
                </div>
                <Input
                  size="small"
                  placeholder="IP e.g. 172.22.0.10/24"
                  value={ifaces[iface]?.ip || ''}
                  onChange={(e) => setIfaceIp(iface, e.target.value)}
                  disabled={readOnly}
                  style={{ background: 'rgba(255,255,255,0.03)', fontFamily: mono, fontSize: 13 }}
                />
              </div>
            );
          })}
        </div>

        <Divider style={{ margin: '4px 0 10px', borderColor: '#1e3a5f' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600 }}>
            <SettingOutlined /> CONFIG OVERRIDES
          </Text>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Raw JSON</Text>
            <Switch size="small" checked={rawMode} onChange={setRawMode} disabled={readOnly} />
          </Space>
        </div>

        {rawMode ? (
          <RawConfigEditor node={node} onPatchNode={onPatchNode} readOnly={readOnly} />
        ) : (
          <ConfigForm
            fields={schema.node}
            value={node.config || {}}
            onChange={(config) => onPatchNode(node.id, { config })}
            disabled={readOnly}
          />
        )}
      </div>
    </>
  );
}

function RawConfigEditor({ node, onPatchNode, readOnly }: { node: TopologyNode; onPatchNode: NFConfigSidebarProps['onPatchNode']; readOnly?: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(node.config || {}, null, 2));
  const [err, setErr] = useState('');
  return (
    <div>
      <Input.TextArea
        rows={10}
        value={text}
        disabled={readOnly}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value || '{}');
            setErr('');
            onPatchNode(node.id, { config: parsed });
          } catch (e2: any) {
            setErr(e2.message);
          }
        }}
        style={{ fontFamily: mono, fontSize: 13, background: '#111827' }}
      />
      {err && <Text type="danger" style={{ fontSize: 12 }}>{err}</Text>}
    </div>
  );
}

// ── Global (lab-wide) defaults panel ─────────────────────────────────────
function GlobalPanel({
  core,
  globals,
  readOnly,
  onPatchGlobals,
}: {
  core: string;
  globals: Record<string, any>;
  readOnly?: boolean;
  onPatchGlobals: (g: Record<string, any>) => void;
}) {
  const schema = useConfigSchema(core);
  return (
    <>
      <Header title="Lab Settings" onClose={() => {}} accent="#00d4ff" />
      <div style={{ padding: 12 }}>
        <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600 }}>
          <SettingOutlined /> GLOBAL DEFAULTS
        </Text>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '2px 0 12px' }}>
          Applied to every NF unless overridden per-node. Select a node to override.
        </Text>
        <ConfigForm fields={schema.global} value={globals} onChange={onPatchGlobals} disabled={readOnly} />
      </div>
    </>
  );
}

// ── Link panel ──────────────────────────────────────────────────────────
function LinkPanel({
  link,
  nodes,
  readOnly,
  onPatchNode,
  onDeleteLink,
  onClose,
}: {
  link: TopologyLink;
  nodes: TopologyNode[];
  readOnly?: boolean;
  onPatchNode: NFConfigSidebarProps['onPatchNode'];
  onDeleteLink: (id: string) => void;
  onClose: () => void;
}) {
  const eps = link.endpoints || [];
  const [a, b] = [eps[0], eps[1]];

  const nodeById = (id?: string) => nodes.find((n) => n.id === id);

  const setEndpointIp = (ep: { node: string; iface: string } | undefined, ip: string) => {
    if (!ep) return;
    const n = nodeById(ep.node);
    if (!n) return;
    const ifaces = { ...(n.interfaces || {}) };
    ifaces[ep.iface] = { ...(ifaces[ep.iface] || {}), ip: ip || undefined };
    onPatchNode(n.id, { interfaces: ifaces });
  };

  const EndpointCard = ({ ep }: { ep?: { node: string; iface: string } }) => {
    if (!ep) return null;
    const n = nodeById(ep.node);
    const accent = n ? nfColor(n.kind) : '#64748b';
    const ip = n?.interfaces?.[ep.iface]?.ip || '';
    return (
      <div style={{ border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, background: '#111827' }}>
        <Space size={6} style={{ marginBottom: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
          <Text style={{ color: '#f0f4ff', fontSize: 12, fontWeight: 700, fontFamily: mono }}>{ep.node}</Text>
          <Tag style={{ borderRadius: 4, fontSize: 11, background: `${accent}1f`, color: accent, border: `1px solid ${accent}40` }}>
            {ep.iface}
          </Tag>
        </Space>
        <Input
          size="small"
          placeholder="IP e.g. 172.22.0.10/24"
          value={ip}
          onChange={(e) => setEndpointIp(ep, e.target.value)}
          disabled={readOnly}
          style={{ fontFamily: mono, fontSize: 13, background: 'rgba(255,255,255,0.03)' }}
        />
      </div>
    );
  };

  return (
    <>
      <Header title="NIC Link" onClose={onClose} accent="#00d4ff" />
      <div style={{ padding: 12 }}>
        <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600 }}>
          <NodeIndexOutlined /> ENDPOINTS
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}>
          <EndpointCard ep={a} />
          <div style={{ textAlign: 'center', color: '#475569', fontSize: 13 }}>↕</div>
          <EndpointCard ep={b} />
        </div>
        <Divider style={{ margin: '8px 0', borderColor: '#1e3a5f' }} />
        <Button danger icon={<DeleteOutlined />} block onClick={() => onDeleteLink(link.id)} disabled={readOnly}>
          Delete Link
        </Button>
      </div>
    </>
  );
}
