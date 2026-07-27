/**
 * BridgeShape — custom AntV X6 React node for a Docker bridge network.
 *
 * Rendered as a thin horizontal "bus" line representing a single L2 network
 * segment (one Docker bridge network). NF nodes plug into the bridge's
 * connection points (taps) which all belong to the same net0 interface.
 * A bridge spawns no container at deploy time — it IS the network.
 */
import { useEffect, useState } from 'react';
import type { Node } from '@antv/x6';
import { nfColor } from './nfMeta';

export interface BridgeNodeData {
  kind: string; // 'bridge'
  label: string;
  nodeId: string;
}

export default function BridgeShape({ node }: { node?: Node }) {
  const [data, setData] = useState<BridgeNodeData>(
    () => (node?.getData() as BridgeNodeData) || ({} as BridgeNodeData),
  );

  useEffect(() => {
    if (!node) return;
    const update = () => setData((node.getData() as BridgeNodeData) || ({} as BridgeNodeData));
    update();
    node.on('change:data', update);
    return () => {
      node.off('change:data', update);
    };
  }, [node]);

  const accent = nfColor('bridge');

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
        position: 'relative',
      }}
    >
      {/* The bus line itself */}
      <div
        style={{
          position: 'absolute',
          left: 4,
          right: 4,
          top: '50%',
          height: 4,
          transform: 'translateY(-50%)',
          borderRadius: 2,
          background: `linear-gradient(90deg, ${accent}55, ${accent}, ${accent}55)`,
          boxShadow: `0 0 10px ${accent}66`,
        }}
      />
      {/* Label chip riding on the line */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 9,
          fontWeight: 700,
          padding: '0 6px',
          borderRadius: 4,
          background: '#0a0e17',
          border: `1px solid ${accent}66`,
          color: accent,
          lineHeight: '13px',
          whiteSpace: 'nowrap',
        }}
        title={data.nodeId}
      >
        {data.nodeId || 'NETWORK'}
      </span>
    </div>
  );
}
