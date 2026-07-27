/**
 * InspectPanel — containerlab-style inspect table.
 *
 * Shows deployed nodes and links in a table (like `clab inspect`),
 * with state badges, IPs, and quick actions.
 */
import { useState } from 'react';
import { Table, Tag, Tabs, Typography, Button, Space, Badge } from 'antd';
import {
  FileTextOutlined, ReloadOutlined, StopOutlined,
} from '@ant-design/icons';
import type { TopologyNode, TopologyLink } from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

interface InspectPanelProps {
  nodes: TopologyNode[];
  links: TopologyLink[];
  statuses: Record<string, string>;
  kindImages?: Record<string, string>;
  onFocusNode: (nodeId: string) => void;
  onLogs: (nodeId: string) => void;
  onRestart: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
}

function stateBadge(state?: string) {
  if (!state || state === 'not_found') return <Badge status="default" text={<Text style={{ fontSize: 13, color: '#64748b' }}>idle</Text>} />;
  if (state === 'running') return <Badge status="success" text={<Text style={{ fontSize: 13, color: '#52c41a' }}>running</Text>} />;
  return <Badge status="error" text={<Text style={{ fontSize: 13, color: '#ff4d4f' }}>{state}</Text>} />;
}

export default function InspectPanel({
  nodes, links, statuses, kindImages, onFocusNode, onLogs, onRestart, onStop,
}: InspectPanelProps) {
  const [tab, setTab] = useState('nodes');

  const nodeColumns = [
    { title: '#', dataIndex: 'idx', key: 'idx', width: 36, render: (_: any, __: any, i: number) => i + 1 },
    {
      title: 'Name', dataIndex: 'id', key: 'id', width: 120,
      render: (v: string) => (
        <Text style={{ color: '#e0e7ff', fontSize: 13, fontFamily: mono, cursor: 'pointer' }} onClick={() => onFocusNode(v)}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Kind', dataIndex: 'kind', key: 'kind', width: 80,
      render: (v: string) => <Tag style={{ fontSize: 12, borderRadius: 4 }}>{v?.toUpperCase()}</Tag>,
    },
    {
      title: 'Image', key: 'image', width: 180,
      render: (_: any, r: TopologyNode) => {
        const img = r.config?.image || r.image || kindImages?.[r.kind] || '';
        return (
          <Text style={{ fontSize: 12, fontFamily: mono, color: img ? '#7dd3fc' : '#475569' }} ellipsis={{ tooltip: img }}>
            {img || '—'}
          </Text>
        );
      },
    },
    {
      title: 'State', key: 'state', width: 90,
      render: (_: any, r: TopologyNode) => stateBadge(statuses[r.id] || r.status),
    },
    {
      title: 'IP Address', key: 'ip', width: 130,
      render: (_: any, r: TopologyNode) => {
        const ifaces = r.interfaces || {};
        const first = Object.values<any>(ifaces)[0];
        return <Text style={{ fontSize: 13, fontFamily: mono, color: '#8a9bb8' }}>{first?.ip || '—'}</Text>;
      },
    },
    {
      title: 'Actions', key: 'actions', width: 130,
      render: (_: any, r: TopologyNode) => (
        <Space size={2}>
          <Button type="text" size="small" icon={<FileTextOutlined />} onClick={() => onLogs(r.id)} className="topo-tbtn" title="Logs" />
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => onRestart(r.id)} className="topo-tbtn" title="Restart" />
          <Button type="text" size="small" icon={<StopOutlined />} onClick={() => onStop(r.id)} className="topo-tbtn topo-tbtn-stop" title="Stop" />
        </Space>
      ),
    },
  ];

  const linkColumns = [
    { title: '#', key: 'idx', width: 36, render: (_: any, __: any, i: number) => i + 1 },
    {
      title: 'Node A', key: 'nodeA', width: 100,
      render: (_: any, r: TopologyLink) => <Text style={{ fontSize: 13, fontFamily: mono, color: '#e0e7ff' }}>{r.endpoints?.[0]?.node}</Text>,
    },
    {
      title: 'Iface A', key: 'ifaceA', width: 80,
      render: (_: any, r: TopologyLink) => <Tag style={{ fontSize: 12 }}>{r.endpoints?.[0]?.iface}</Tag>,
    },
    {
      title: 'Node B', key: 'nodeB', width: 100,
      render: (_: any, r: TopologyLink) => <Text style={{ fontSize: 13, fontFamily: mono, color: '#e0e7ff' }}>{r.endpoints?.[1]?.node}</Text>,
    },
    {
      title: 'Iface B', key: 'ifaceB', width: 80,
      render: (_: any, r: TopologyLink) => <Tag style={{ fontSize: 12 }}>{r.endpoints?.[1]?.iface}</Tag>,
    },
  ];

  return (
    <div className="inspect-panel">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        size="small"
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'nodes',
            label: <span style={{ fontSize: 13 }}>Nodes ({nodes.length})</span>,
            children: (
              <Table
                dataSource={nodes.filter((n) => n.kind !== 'bridge')}
                columns={nodeColumns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ y: 140 }}
                style={{ fontSize: 13 }}
              />
            ),
          },
          {
            key: 'links',
            label: <span style={{ fontSize: 13 }}>Links ({links.length})</span>,
            children: (
              <Table
                dataSource={links}
                columns={linkColumns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ y: 140 }}
                style={{ fontSize: 13 }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
