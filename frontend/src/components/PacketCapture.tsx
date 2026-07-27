import { useState, useEffect } from 'react';
import { Select, Button, Table, Card, Space, Typography, Tag, message, Empty } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, DownloadOutlined,
  ThunderboltOutlined, EyeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import {
  getTopology, startCapture, stopCapture, getCaptureSummary, downloadCapture,
} from '../services/api';

const { Text } = Typography;

interface PacketCaptureProps {
  coreType?: string;
}

interface PacketRow {
  no: string;
  time: string;
  source: string;
  dest: string;
  protocol: string;
  length: string;
  info: string;
}

export default function PacketCapture({ coreType }: PacketCaptureProps) {
  const [nfOptions, setNfOptions] = useState<{ value: string; label: string }[]>([]);
  const [srcNf, setSrcNf] = useState<string>('');
  const [dstNf, setDstNf] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  const [capturing, setCapturing] = useState(false);
  const [packets, setPackets] = useState<PacketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [captureInfo, setCaptureInfo] = useState<{ src_ip: string; dst_ip: string } | null>(null);

  // Load NF options from topology
  useEffect(() => {
    getTopology(coreType).then(r => {
      const nodes = r.data?.nodes || [];
      const opts = nodes
        .filter((n: any) => n.nf_type !== 'database')
        .map((n: any) => ({ value: n.id, label: n.label }));
      setNfOptions(opts);
      if (opts.length >= 2) {
        setSrcNf(opts[0].value);
        setDstNf(opts[1].value);
      }
    }).catch(() => {});
  }, [coreType]);

  // Poll for packet summary while capturing
  useEffect(() => {
    if (!capturing || !sessionId) return;
    const iv = setInterval(async () => {
      try {
        const r = await getCaptureSummary(sessionId, 200);
        setPackets((r.data?.packets || []).map((p: any) => ({ ...p, key: p.no })));
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [capturing, sessionId]);

  const handleStart = async () => {
    if (!srcNf || !dstNf) { message.warning('Select source and destination NFs'); return; }
    setLoading(true);
    try {
      const r = await startCapture(srcNf, dstNf);
      setSessionId(r.data.session_id);
      setCapturing(true);
      setCaptureInfo({ src_ip: r.data.src_ip, dst_ip: r.data.dst_ip });
      message.success('Capture started');
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const r = await stopCapture(sessionId);
      setCapturing(false);
      message.success(`Capture stopped (${(r.data.file_size / 1024).toFixed(1)} KB)`);
      // Fetch final summary
      const sum = await getCaptureSummary(sessionId, 500);
      setPackets((sum.data?.packets || []).map((p: any) => ({ ...p, key: p.no })));
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (sessionId) downloadCapture(sessionId);
  };

  const handleRefresh = async () => {
    if (!sessionId) return;
    try {
      const r = await getCaptureSummary(sessionId, 200);
      setPackets((r.data?.packets || []).map((p: any) => ({ ...p, key: p.no })));
    } catch {}
  };

  const columns: TableColumnsType<PacketRow> = [
    { title: 'No', dataIndex: 'no', key: 'no', width: 50 },
    { title: 'Time', dataIndex: 'time', key: 'time', width: 80,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>{parseFloat(v).toFixed(4)}</Text>
    },
    { title: 'Source', dataIndex: 'source', key: 'src', width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#38bdf8' }}>{v}</Text>
    },
    { title: 'Dest', dataIndex: 'dest', key: 'dst', width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#faad14' }}>{v}</Text>
    },
    { title: 'Protocol', dataIndex: 'protocol', key: 'proto', width: 80,
      render: (v: string) => <Tag style={{ borderRadius: 4, fontSize: 10 }}>{v}</Tag>
    },
    { title: 'Len', dataIndex: 'length', key: 'len', width: 60 },
    { title: 'Info', dataIndex: 'info', key: 'info', ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#b8c4e0' }}>{v}</Text>
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Capture controls */}
      <Card size="small" style={{ flexShrink: 0, borderColor: '#1e3a5f', background: '#111827' }}>
        <Space wrap size="middle" align="end">
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>SOURCE NF:</Text>
            <Select
              value={srcNf}
              onChange={setSrcNf}
              size="small"
              style={{ width: 120 }}
              options={nfOptions}
              placeholder="Select NF"
            />
          </div>
          <ThunderboltOutlined style={{ color: '#00d4ff', fontSize: 18 }} />
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>DEST NF:</Text>
            <Select
              value={dstNf}
              onChange={setDstNf}
              size="small"
              style={{ width: 120 }}
              options={nfOptions}
              placeholder="Select NF"
            />
          </div>
          {!capturing ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStart} loading={loading}>
              Start Capture
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={handleStop} loading={loading}>
              Stop
            </Button>
          )}
          {sessionId && !capturing && (
            <Button icon={<DownloadOutlined />} onClick={handleDownload} style={{ borderColor: '#52c41a', color: '#52c41a' }}>
              Download PCAP
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} disabled={!sessionId} size="small" />
        </Space>
        {captureInfo && (
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#8a9bb8' }}>
            Filter: {captureInfo.src_ip} &lt;-&gt; {captureInfo.dst_ip}
            {capturing && <Tag color="processing" style={{ marginLeft: 8, fontSize: 10 }}>LIVE</Tag>}
          </div>
        )}
      </Card>

      {/* Packet table */}
      <Card
        size="small"
        title={
          <Space>
            <EyeOutlined style={{ color: '#00d4ff' }} />
            <span style={{ color: '#f0f4ff', fontSize: 13 }}>Captured Packets</span>
            {packets.length > 0 && <Tag style={{ borderRadius: 20, fontSize: 10 }}>{packets.length}</Tag>}
          </Space>
        }
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderColor: '#1e3a5f', background: '#111827' }}
      >
        {packets.length === 0 && !capturing ? (
          <Empty
            description="No packets captured yet. Select two NFs and start capturing."
            style={{ padding: '40px 0' }}
          />
        ) : (
          <Table<PacketRow>
            dataSource={packets}
            columns={columns}
            size="small"
            pagination={false}
            scroll={{ x: 700, y: 400 }}
            locale={{ emptyText: 'Waiting for packets...' }}
          />
        )}
      </Card>
    </div>
  );
}
