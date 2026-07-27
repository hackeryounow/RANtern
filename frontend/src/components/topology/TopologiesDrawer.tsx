/**
 * TopologiesDrawer — saved-topology gallery + rendered-config file browser.
 *
 * Opened from the topology-editor toolbar. Lists every saved topology
 * (name, core, node/link counts); click a name to reopen it in the editor.
 * Each row expands to browse the rendered config files generated for that
 * topology (view content in a modal, or download).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Drawer, List, Typography, Tag, Button, Space, Empty, Modal, message, Spin, Tooltip,
} from 'antd';
import {
  ApartmentOutlined, ReloadOutlined, FolderOutlined, FileTextOutlined,
  DownloadOutlined, EyeOutlined,
} from '@ant-design/icons';
import {
  listTopologies, listTopologyFiles, getTopologyFileContent, downloadTopologyFile,
} from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

interface TopoSummary {
  name: string;
  core_type: string;
  node_count: number;
  link_count: number;
  updated_at?: number;
}

interface TopoFile {
  path: string;
  name: string;
  size: number;
}

interface TopologiesDrawerProps {
  open: boolean;
  onClose: () => void;
  onLoad: (name: string) => void;
}

export default function TopologiesDrawer({ open, onClose, onLoad }: TopologiesDrawerProps) {
  const [topos, setTopos] = useState<TopoSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<TopoFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // File viewer modal
  const [viewer, setViewer] = useState<{ name: string; path: string; content: string } | null>(null);
  const [viewing, setViewing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listTopologies();
      setTopos(r.data?.topologies || []);
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Failed to list topologies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const toggleExpand = useCallback(async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    setFilesLoading(true);
    setFiles([]);
    try {
      const r = await listTopologyFiles(name);
      setFiles(r.data?.files || []);
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Failed to list files');
    } finally {
      setFilesLoading(false);
    }
  }, [expanded]);

  const viewFile = useCallback(async (name: string, path: string) => {
    setViewing(true);
    try {
      const r = await getTopologyFileContent(name, path);
      setViewer({ name, path, content: r.data?.content ?? '' });
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Failed to read file');
    } finally {
      setViewing(false);
    }
  }, []);

  return (
    <Drawer
      title={
        <Space>
          <ApartmentOutlined style={{ color: '#00d4ff' }} />
          <span>Saved Topologies</span>
        </Space>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}
          style={{ borderColor: '#1e3a5f', color: '#8a9bb8' }} />
      }
      styles={{ body: { background: '#0d1117', padding: 12 }, header: { background: '#111827', borderBottom: '1px solid #1e3a5f' } }}
    >
      {topos.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="secondary">No saved topologies yet</Text>} style={{ marginTop: 40 }} />
      ) : (
        <List
          loading={loading}
          dataSource={topos}
          renderItem={(t) => {
            const isExpanded = expanded === t.name;
            return (
              <div
                key={t.name}
                style={{
                  marginBottom: 8, background: '#111827', border: '1px solid #1e3a5f',
                  borderRadius: 8, overflow: 'hidden',
                }}
              >
                {/* Row header */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer' }}
                  onClick={() => { onLoad(t.name); onClose(); }}
                >
                  <ApartmentOutlined style={{ color: '#00d4ff' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: '#f0f4ff', fontFamily: mono, fontSize: 13 }}>{t.name}</Text>
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      <Tag color={t.core_type === 'free5gc' ? 'purple' : 'blue'} style={{ fontSize: 12, margin: 0 }}>
                        {t.core_type}
                      </Tag>
                      <Tag style={{ fontSize: 12, margin: 0 }}>{t.node_count} nodes</Tag>
                      <Tag style={{ fontSize: 12, margin: 0 }}>{t.link_count} links</Tag>
                    </div>
                  </div>
                  <Tooltip title="Browse rendered configs">
                    <Button
                      size="small"
                      type="text"
                      icon={<FolderOutlined />}
                      onClick={(e) => { e.stopPropagation(); toggleExpand(t.name); }}
                      style={{ color: isExpanded ? '#00d4ff' : '#8a9bb8' }}
                    />
                  </Tooltip>
                </div>

                {/* Expanded config-file browser */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #1e3a5f', padding: 8, background: '#0a0e17' }}>
                    {filesLoading ? (
                      <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
                    ) : files.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 13, padding: 4 }}>
                        No rendered configs yet — deploy the topology to generate them.
                      </Text>
                    ) : (
                      files.map((f) => (
                        <div
                          key={f.path}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                            borderRadius: 4, fontSize: 13,
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = '#1e293b')}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
                        >
                          <FileTextOutlined style={{ color: '#64748b', fontSize: 13 }} />
                          <Text style={{ flex: 1, color: '#b8c4e0', fontFamily: mono, fontSize: 13 }} ellipsis={{ tooltip: f.path }}>
                            {f.path}
                          </Text>
                          <Tooltip title="View">
                            <Button size="small" type="text" icon={<EyeOutlined />}
                              onClick={() => viewFile(t.name, f.path)}
                              style={{ color: '#00d4ff', fontSize: 13 }} />
                          </Tooltip>
                          <Tooltip title="Download">
                            <Button size="small" type="text" icon={<DownloadOutlined />}
                              onClick={() => downloadTopologyFile(t.name, f.path)}
                              style={{ color: '#8a9bb8', fontSize: 13 }} />
                          </Tooltip>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          }}
        />
      )}

      {/* File content viewer */}
      <Modal
        open={!!viewer}
        title={
          <Space>
            <FileTextOutlined style={{ color: '#00d4ff' }} />
            <span style={{ fontFamily: mono, fontSize: 12 }}>{viewer?.path}</span>
          </Space>
        }
        width="85vw"
        centered
        onCancel={() => setViewer(null)}
        footer={
          viewer ? (
            <Space>
              <Button icon={<DownloadOutlined />} onClick={() => downloadTopologyFile(viewer.name, viewer.path)}>
                Download
              </Button>
              <Button type="primary" onClick={() => setViewer(null)}>Close</Button>
            </Space>
          ) : null
        }
      >
        {viewing ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <pre
            style={{
              height: '70vh', overflow: 'auto', background: '#0a0e17', border: '1px solid #1e3a5f',
              borderRadius: 6, padding: 16, fontFamily: mono, fontSize: 12, color: '#b8c4e0',
              whiteSpace: 'pre', margin: 0,
            }}
          >
            {viewer?.content}
          </pre>
        )}
      </Modal>
    </Drawer>
  );
}
