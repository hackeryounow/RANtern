/**
 * NFPalette — left-hand catalog of draggable Network Function kinds.
 *
 * Fetches the NF catalog from `/api/nf-kinds?core=<core>`, groups entries by
 * category (5G Control / 5G User / 4G EPC / Data / RAN) and lets the user
 * drag a kind onto the X6 canvas. The actual drag is started by the parent
 * (TopologyEditor) which owns the Dnd plugin + node factory.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Typography, Empty, Spin, Button, Modal, Space, message } from 'antd';
import { SearchOutlined, DragOutlined, PlusOutlined } from '@ant-design/icons';
import { getNfKinds } from '../../services/api';
import { nfColor, CATEGORY_LABELS } from './nfMeta';

const { Text } = Typography;

export interface NfKind {
  kind: string;
  label: string;
  category: string;
  cores: string[];
  interfaces: string[];
  image?: string;
}

interface NFPaletteProps {
  core: string;
  onStartDrag: (kind: NfKind, e: React.MouseEvent) => void;
  onAddCustom: (def: { name: string; image: string; interfaces: string[]; config: Record<string, any> }) => void;
}

const CATEGORY_ORDER = ['5g-control', '5g-user', '4g-epc', 'data', 'ran', 'network'];

export default function NFPalette({ core, onStartDrag, onAddCustom }: NFPaletteProps) {
  const [kinds, setKinds] = useState<NfKind[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [width, setWidth] = useState(210);
  const dragging = useRef(false);

  // Custom node modal
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customImage, setCustomImage] = useState('');
  const [customIfaces, setCustomIfaces] = useState('eth0');
  const [customConfig, setCustomConfig] = useState('{\n  \n}');

  useEffect(() => {
    setLoading(true);
    getNfKinds(core)
      .then((r) => setKinds(r.data?.kinds || []))
      .catch(() => setKinds([]))
      .finally(() => setLoading(false));
  }, [core]);

  const filtered = kinds.filter(
    (k) =>
      !query.trim() ||
      k.kind.toLowerCase().includes(query.toLowerCase()) ||
      k.label.toLowerCase().includes(query.toLowerCase()),
  );

  const grouped = CATEGORY_ORDER.map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat] || cat,
    items: filtered.filter((k) => k.category === cat),
  })).filter((g) => g.items.length > 0);

  // ── Resize handle logic ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(160, Math.min(480, startW + ev.clientX - startX));
      setWidth(w);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #1e3a5f',
        background: '#0d1117',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
        }}
      />
      <div style={{ padding: '10px 10px 6px' }}>
        <Text style={{ color: '#8a9bb8', fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
          NF COMPONENTS
        </Text>
        <Input
          size="small"
          placeholder="Search NF..."
          prefix={<SearchOutlined style={{ color: '#475569' }} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          style={{
            marginTop: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        ) : grouped.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No NFs" />
        ) : (
          grouped.map((g) => (
            <div key={g.key} style={{ marginBottom: 8 }}>
              {/* Section header: label + hairline + count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 6px' }}>
                <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {g.label}
                </span>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #1e3a5f, transparent)' }} />
                <span style={{ color: '#475569', fontSize: 10, fontFamily: 'Consolas, monospace' }}>{g.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {g.items.map((k) => {
                  const accent = nfColor(k.kind);
                  return (
                    <div
                      key={k.kind}
                      onMouseDown={(e) => onStartDrag(k, e)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 9px',
                        borderRadius: 8,
                        border: '1px solid #1a2740',
                        background: '#101826',
                        cursor: 'grab',
                        userSelect: 'none',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}77`;
                        (e.currentTarget as HTMLDivElement).style.background = `${accent}14`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = '#1a2740';
                        (e.currentTarget as HTMLDivElement).style.background = '#101826';
                      }}
                    >
                      <span style={{ width: 3, height: 18, borderRadius: 2, background: accent, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e0e7ff', fontSize: 12, fontWeight: 600, lineHeight: 1.25 }}>
                          {k.label}
                        </div>
                        <div
                          style={{
                            color: '#5a6988',
                            fontSize: 10,
                            fontFamily: 'Consolas, monospace',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {k.interfaces.join(' · ')}
                        </div>
                      </div>
                      <DragOutlined style={{ color: '#3d4c66', fontSize: 12 }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Custom node button */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #1e3a5f' }}>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          block
          onClick={() => setCustomOpen(true)}
          style={{ color: '#8a9bb8', borderColor: '#1e3a5f', fontSize: 13 }}
        >
          Custom Node
        </Button>
      </div>

      <Modal
        title={<span style={{ fontSize: 13 }}>Add Custom Node</span>}
        open={customOpen}
        onCancel={() => setCustomOpen(false)}
        onOk={() => {
          const name = customName.trim() || 'custom1';
          const ifaces = customIfaces.split(',').map((s) => s.trim()).filter(Boolean);
          let config: Record<string, any> = {};
          try {
            config = JSON.parse(customConfig);
          } catch {
            message.error('Invalid JSON config');
            return;
          }
          onAddCustom({ name, image: customImage.trim(), interfaces: ifaces.length ? ifaces : ['eth0'], config });
          setCustomOpen(false);
          setCustomName('');
          setCustomImage('');
          setCustomIfaces('eth0');
          setCustomConfig('{\n  \n}');
        }}
        okText="Add"
        width={420}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <div>
            <div style={{ fontSize: 13, color: '#8a9bb8', marginBottom: 4 }}>Node name</div>
            <Input size="small" placeholder="e.g. my-server" value={customName} onChange={(e) => setCustomName(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#8a9bb8', marginBottom: 4 }}>Docker image</div>
            <Input size="small" placeholder="e.g. nginx:latest" value={customImage} onChange={(e) => setCustomImage(e.target.value)} style={{ fontFamily: 'Consolas, monospace' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#8a9bb8', marginBottom: 4 }}>Interfaces (comma-separated)</div>
            <Input size="small" placeholder="eth0, eth1" value={customIfaces} onChange={(e) => setCustomIfaces(e.target.value)} style={{ fontFamily: 'Consolas, monospace' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#8a9bb8', marginBottom: 4 }}>
              Config (JSON) — env vars, ports, volumes, etc.
            </div>
            <Input.TextArea
              rows={6}
              value={customConfig}
              onChange={(e) => setCustomConfig(e.target.value)}
              placeholder='{"env": {"KEY": "val"}, "ports": ["8080:80"]}'
              style={{
                fontFamily: 'Consolas, monospace',
                fontSize: 13,
                background: '#0d1117',
                borderColor: '#1e3a5f',
                color: '#e0e7ff',
              }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
