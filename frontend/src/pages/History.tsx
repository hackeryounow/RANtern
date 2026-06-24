import { useState, useEffect } from 'react';
import { Card, Button, Tag, Space, Typography, Empty, Modal, Tooltip } from 'antd';
import {
  DeleteOutlined, ClearOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { listHistory, getHistoryRecord, deleteHistoryRecord, clearHistory } from '../services/api';
import Plot from '../components/Plot';

const { Text } = Typography;

export default function History() {
  const [records, setRecords] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    try {
      const r = await listHistory();
      setRecords(r.data);
    } catch {}
  };

  useEffect(() => { refresh(); }, []);

  const handleSelect = async (id: string) => {
    try {
      const res = await getHistoryRecord(id);
      setSelected(res.data);
    } catch {}
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: 'Delete this record?',
      icon: <ExclamationCircleOutlined />,
      content: `Record: ${id}`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await deleteHistoryRecord(id);
          if (selected?.test_id === id) setSelected(null);
          await refresh();
        } catch {}
      },
    });
  };

  const handleClearAll = () => {
    if (records.length === 0) return;
    Modal.confirm({
      title: `Clear all ${records.length} records?`,
      icon: <ExclamationCircleOutlined />,
      content: 'This cannot be undone.',
      okText: 'Clear All',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await clearHistory();
          setSelected(null);
          await refresh();
        } catch {}
      },
    });
  };

  const boxPlotData: any[] = [];
  if (selected?.latency_stats) {
    const ls = selected.latency_stats;
    if (ls.registration) boxPlotData.push({ type: 'box', name: 'Registration', y: _vals(ls.registration), markerColor: '#00d4ff', boxpoints: 'outliers' });
    if (ls.session) boxPlotData.push({ type: 'box', name: 'Session', y: _vals(ls.session), markerColor: '#00ff88', boxpoints: 'outliers' });
    if (ls.total) boxPlotData.push({ type: 'box', name: 'Total', y: _vals(ls.total), markerColor: '#ffaa00', boxpoints: 'outliers' });
  }

  const plotlyLayout: any = {
    paper_bgcolor: '#111827', plot_bgcolor: '#0a0e17',
    font: { color: '#e0e7ff', family: 'JetBrains Mono, monospace', size: 11 },
    margin: { t: 30, r: 20, b: 40, l: 60 },
    yaxis: { title: 'Latency (ms)', gridcolor: '#1e3a5f' },
    xaxis: { gridcolor: '#1e3a5f' },
    showlegend: false, height: 300,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, color: '#00d4ff', fontFamily: 'JetBrains Mono, monospace' }}>
          ◎ Test History
        </Typography.Title>
        <Button
          danger
          icon={<ClearOutlined />}
          size="small"
          onClick={handleClearAll}
          disabled={records.length === 0}
        >
          Clear All
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Record list */}
        <Card
          size="small"
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          styles={{ body: { flex: 1, overflowY: 'auto', padding: 0 } }}
        >
          {records.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty description="No test records" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : records.map((r) => (
            <div
              key={r.id}
              onClick={() => handleSelect(r.id)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid #1e293b',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                background: selected?.test_id === r.id ? 'rgba(0,212,255,0.06)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (selected?.test_id !== r.id) e.currentTarget.style.background = '#1a1f2e'; }}
              onMouseLeave={e => { if (selected?.test_id !== r.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#00d4ff', marginBottom: 3 }}>
                  {r.timestamp}
                </div>
                <Space size={4} wrap>
                  <Tag color="success" style={{ fontSize: 11, margin: 0 }}>{r.mode?.toUpperCase()}</Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.core_network}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>— {r.ue_count} UEs</Text>
                </Space>
              </div>
              <Tooltip title="Delete">
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined style={{ fontSize: 14 }} />}
                  onClick={e => handleDelete(r.id, e)}
                  style={{ flexShrink: 0, marginLeft: 6, opacity: 0.5 }}
                />
              </Tooltip>
            </div>
          ))}
        </Card>

        {/* Detail panel */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!selected ? (
            <Card size="small">
              <Empty description="Select a record to view details" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Card>
          ) : (
            <>
              {/* Parameters */}
              <Card size="small" title={<Text type="secondary" style={{ fontSize: 11 }}>PARAMETERS</Text>}>
                <pre style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(selected.parameters, null, 1)}
                </pre>
              </Card>

              {/* UE Table */}
              <Card size="small" title={<Text type="secondary" style={{ fontSize: 11 }}>UE DETAILS ({selected.ue_details?.length ?? 0})</Text>}>
                {selected.ue_details?.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                          {['IMSI','IPv4','State','Reg (ms)','Session (ms)','Total (ms)'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontSize: 10, fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selected.ue_details.map((ue: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                            <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{ue.imsi}</td>
                            <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{ue.ipv4}</td>
                            <td style={{ padding: '5px 8px' }}>
                              <Tag color={ue.state?.includes('established') ? 'success' : 'default'} style={{ margin: 0, fontSize: 10 }}>{ue.state}</Tag>
                            </td>
                            <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{ue.latency_ms?.registration ?? '-'}</td>
                            <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{ue.latency_ms?.pdu_session_1 ?? '-'}</td>
                            <td style={{ padding: '5px 8px', color: '#00d4ff', fontWeight: 700 }}>{ue.latency_ms?.total ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty description="No UE data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>

              {/* Box Plot */}
              {boxPlotData.length > 0 && (
                <Card size="small" title={<Text type="secondary" style={{ fontSize: 11 }}>LATENCY DISTRIBUTION</Text>}>
                  <Plot data={boxPlotData} layout={plotlyLayout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%' }} />
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function _vals(s: any): number[] {
  const v: number[] = [];
  if (s.min !== undefined) v.push(s.min);
  if (s.q1 !== undefined) v.push(s.q1);
  if (s.median !== undefined) v.push(s.median);
  if (s.q3 !== undefined) v.push(s.q3);
  if (s.max !== undefined) v.push(s.max);
  if (s.outliers) v.push(...s.outliers);
  return v;
}
