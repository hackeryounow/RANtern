/**
 * NFNodeShape — custom AntV X6 React node for a Network Function.
 *
 * Renders the NF body (label, kind badge, status LED, primary IP). The NIC
 * ports themselves are drawn by X6's port system (configured per-node in
 * TopologyEditor) so they act as real connection magnets.
 */
import { useEffect, useState } from 'react';
import type { Node } from '@antv/x6';
import { nfColor, statusColor } from './nfMeta';

export interface NFNodeData {
  kind: string;
  label: string;
  nodeId: string;
  status?: string;
  ip?: string;
  image?: string;
}

export default function NFNodeShape({ node }: { node?: Node }) {
  const [data, setData] = useState<NFNodeData>(() => (node?.getData() as NFNodeData) || ({} as NFNodeData));

  useEffect(() => {
    if (!node) return;
    const update = () => setData((node.getData() as NFNodeData) || ({} as NFNodeData));
    update();
    node.on('change:data', update);
    return () => {
      node.off('change:data', update);
    };
  }, [node]);

  const kind = data.kind || 'nf';
  const accent = nfColor(kind);
  const led = statusColor(data.status);
  const deployed = !!data.status && data.status !== 'not_found';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        borderRadius: 10,
        border: `1.5px solid ${accent}66`,
        background: `linear-gradient(160deg, #151d2e 0%, #0f1520 100%)`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 ${accent}18`,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}44)`, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '5px 10px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        {/* Title row: LED + node id */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: led,
              boxShadow: `0 0 6px ${led}`,
              flexShrink: 0,
              animation: data.status === 'running' ? 'nf-pulse 2s infinite' : undefined,
            }}
          />
          <span
            style={{
              color: '#f0f4ff',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={data.nodeId}
          >
            {data.nodeId || kind}
          </span>
          {deployed && (
            <span style={{ fontSize: 8, color: led, marginLeft: 'auto', flexShrink: 0 }}>{data.status}</span>
          )}
        </div>

        {/* Kind badge + IP */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 8,
              fontWeight: 600,
              padding: '0 4px',
              borderRadius: 3,
              background: `${accent}18`,
              color: accent,
              border: `1px solid ${accent}33`,
              lineHeight: '13px',
              letterSpacing: 0.5,
            }}
          >
            {(data.label || kind).toUpperCase()}
          </span>
          {data.ip && (
            <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {data.ip}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
