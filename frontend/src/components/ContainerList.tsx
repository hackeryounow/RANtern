import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, Tooltip, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ReloadOutlined, FileTextOutlined, CodeOutlined,
  SettingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import { getCoreStatus, restartNF } from '../services/api';
import NFLogDrawer from './NFLogDrawer';
import NFConfigModal from './NFConfigModal';

const { Text } = Typography;

interface ContainerInfo {
  name: string;
  id: string;
  image: string;
  status: string;
  state: string;
  nf_type: string;
  core_network: string;
  cpu_pct: number;
  mem_usage: string;
  ports: string[];
  uptime: string;
}

interface ContainerListProps {
  coreType?: string;
  onRefresh?: () => void;
}

export default function ContainerList({ coreType, onRefresh }: ContainerListProps) {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configContainer, setConfigContainer] = useState<ContainerInfo | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const r = await getCoreStatus(coreType);
      setContainers(r.data.containers || []);
    } catch (e: any) {
      // Silently handle
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 3000);
    return () => clearInterval(iv);
  }, [coreType]);

  const handleRestart = async (name: string) => {
    try {
      await restartNF(name);
      message.success(`${name} restarting...`);
      setTimeout(fetchStatus, 2000);
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message);
    }
  };

  const handleViewLogs = (container: ContainerInfo) => {
    setSelectedContainer(container);
    setDrawerOpen(true);
  };

  const handleConfigure = (container: ContainerInfo) => {
    setConfigContainer(container);
    setConfigOpen(true);
  };

  const columns: TableColumnsType<ContainerInfo> = [
    {
      title: 'NF',
      dataIndex: 'nf_type',
      key: 'nf_type',
      width: 80,
      render: (v: string) => (
        <Tag color="blue" style={{ borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
          {v?.toUpperCase() || '-'}
        </Tag>
      ),
    },
    {
      title: 'Container',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (v: string) => (
        <Text style={{ fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 12, color: '#e0e7ff' }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Image',
      dataIndex: 'image',
      key: 'image',
      width: 180,
      ellipsis: true,
      render: (v: string) => (
        <Text type="secondary" style={{ fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 11 }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: string) => {
        const cfg: Record<string, { color: string; icon: React.ReactNode }> = {
          running: { color: 'success', icon: <CheckCircleOutlined /> },
          exited: { color: 'error', icon: <CloseCircleOutlined /> },
          restarting: { color: 'warning', icon: <SyncOutlined spin /> },
          created: { color: 'default', icon: <CloudServerOutlined /> },
        };
        const c = cfg[v] || cfg.created;
        return <Tag color={c.color} icon={c.icon} style={{ fontSize: 11 }}>{v}</Tag>;
      },
    },
    {
      title: 'CPU',
      dataIndex: 'cpu_pct',
      key: 'cpu',
      width: 65,
      render: (v: number) => (
        <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: v > 80 ? '#ff4d4f' : v > 50 ? '#faad14' : '#52c41a' }}>
          {v}%
        </Text>
      ),
    },
    {
      title: 'Memory',
      dataIndex: 'mem_usage',
      key: 'mem',
      width: 80,
      render: (v: string) => (
        <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#b8c4e0' }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Uptime',
      dataIndex: 'uptime',
      key: 'uptime',
      width: 80,
      render: (v: string) => (
        <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#8a9bb8' }}>
          {v || '-'}
        </Text>
      ),
    },
    {
      title: 'Ports',
      dataIndex: 'ports',
      key: 'ports',
      width: 150,
      ellipsis: true,
      render: (v: string[]) => (
        <div style={{ fontSize: 10, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#8a9bb8' }}>
          {v?.length ? v.join(', ') : '-'}
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      render: (_: any, record: ContainerInfo) => (
        <Space size={4}>
          <Tooltip title="Restart">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={(e) => { e.stopPropagation(); handleRestart(record.name); }}
              style={{ borderRadius: 6, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}
            />
          </Tooltip>
          <Tooltip title="Logs">
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={(e) => { e.stopPropagation(); handleViewLogs(record); }}
              style={{ borderRadius: 6, background: 'rgba(0,212,255,0.1)', borderColor: '#00d4ff33', color: '#00d4ff' }}
            />
          </Tooltip>
          <Tooltip title="Shell">
            <Button
              size="small"
              icon={<CodeOutlined />}
              onClick={(e) => { e.stopPropagation(); handleViewLogs(record); }}
              style={{ borderRadius: 6, background: 'rgba(82,196,26,0.1)', borderColor: '#52c41a33', color: '#52c41a' }}
            />
          </Tooltip>
          <Tooltip title="Configure">
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={(e) => { e.stopPropagation(); handleConfigure(record); }}
              style={{ borderRadius: 6, background: 'rgba(167,139,250,0.1)', borderColor: '#a78bfa33', color: '#a78bfa' }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table<ContainerInfo>
        dataSource={containers.map(c => ({ ...c, key: c.name }))}
        columns={columns}
        size="small"
        loading={loading}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: 'No containers found. Deploy a core network first.' }}
        onRow={(record) => ({
          onClick: () => handleViewLogs(record),
          style: { cursor: 'pointer' },
        })}
      />

      <NFLogDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        container={selectedContainer ? { name: selectedContainer.name, nf_type: selectedContainer.nf_type } : null}
      />

      <NFConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        container={configContainer ? { name: configContainer.name, image: configContainer.image, nf_type: configContainer.nf_type, status: configContainer.status } : null}
        onUpdated={() => { setTimeout(fetchStatus, 3000); onRefresh?.(); }}
      />
    </div>
  );
}
