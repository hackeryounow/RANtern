import { useState, useEffect, useCallback } from 'react';
import {
  Select, InputNumber, Button, Table, Card, Tag, Progress, Space, Row, Col, Typography, Divider, Alert,
} from 'antd';
import {
  PlayCircleOutlined, StopOutlined, ThunderboltOutlined,
  DownloadOutlined, CloudServerOutlined, TableOutlined, BarChartOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  startProvision, getProvisionStatus,
  start5GTest, start4GTest, stopTest, getTestStatus,
  getTestUEs, getLatencyStats, listProfiles,
  exportUEsCSV, exportLatencyJSON, exportFullJSON,
  releasePduSession, triggerUserInactivity, deregisterUE,
} from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import Plot from '../components/Plot';

const { Text } = Typography;

type TaskMode = 'provision' | 'ue-test';

export default function Dashboard() {
  const [mode, setMode] = useState<'5g' | '4g'>('5g');
  const [count, setCount] = useState(10);
  const [coreNetwork, setCoreNetwork] = useState('free5gc');
  const [action, setAction] = useState('provision');
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [taskMode, setTaskMode] = useState<TaskMode>('ue-test');

  // UE action state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<'release-pdu' | 'user-inactivity' | 'deregister' | null>(null);
  const [selectedPduId, setSelectedPduId] = useState<number>(1);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string>('');

  // Test state
  const [testRunning, setTestRunning] = useState(false);
  const [ues, setUes] = useState<any[]>([]);
  const [latencyStats, setLatencyStats] = useState<any>({});
  const [showBoxPlot, setShowBoxPlot] = useState(false);
  const [viewTab, setViewTab] = useState<'table' | 'boxplot'>('table');

  // Provision state
  const [provStatus, setProvStatus] = useState<any>({ status: 'idle' });
  const [provLog, setProvLog] = useState<string[]>([]);
  const [provRunning, setProvRunning] = useState(false);

  useEffect(() => {
    listProfiles().then(r => {
      setProfiles(r.data.profiles || []);
      setProfile(r.data.active || '');
    }).catch(() => {});
    getTestStatus().then(r => setTestRunning(r.data.running)).catch(() => {});
    getTestUEs().then(r => setUes(r.data)).catch(() => {});
    getLatencyStats().then(r => {
      if (Object.keys(r.data).length > 0) { setLatencyStats(r.data); setShowBoxPlot(true); }
    }).catch(() => {});
    const iv = setInterval(() => {
      getProvisionStatus().then(r => {
        setProvStatus(r.data);
        setProvRunning(r.data.status === 'running');
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  const isRunning = taskMode === 'ue-test' ? testRunning : provRunning;

  const onWS = useCallback((type: string, data: any) => {
    if (type === 'test_ues_update' && data.ues) setUes(data.ues);
    if (type === 'test_complete') {
      setTestRunning(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      getLatencyStats().then(r => { setLatencyStats(r.data); setShowBoxPlot(true); }).catch(() => {});
    }
    if (type === 'ue_action_progress') {
      setActionMsg(data.message || '');
    }
    if (type === 'ue_action_complete') {
      setActionLoading(false);
      setActionMsg(data.message || '');
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
    }
    if (type === 'ue_removed') {
      setSelectedIdx(null);
      setSelectedAction(null);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
    }
    if (type.startsWith('provision_')) {
      setProvLog(prev => [...prev, `[${type}] ${JSON.stringify(data)}`]);
      if (type === 'provision_complete') setProvRunning(false);
    }
  }, []);
  useWebSocket(onWS);

  const handleRun = async () => {
    if (taskMode === 'ue-test') {
      setShowBoxPlot(false); setUes([]); setLatencyStats({});
      setTestRunning(true);
      try {
        const payload = { count, core_network: coreNetwork, profile };
        if (mode === '5g') await start5GTest(payload); else await start4GTest(payload);
      } catch (e: any) { alert(e.response?.data?.error || e.message); setTestRunning(false); }
    } else {
      setProvLog([]); setProvRunning(true);
      try {
        const res = await startProvision({ count, core_network: coreNetwork, action, profile });
        setProvLog([`Task ${res.data.task_id} started`]);
      } catch (e: any) { setProvLog([`Error: ${e.message}`]); setProvRunning(false); }
    }
  };

  const handleStop = async () => {
    if (taskMode === 'ue-test') {
      try { await stopTest(); } catch {}
      setTestRunning(false);
      setSelectedIdx(null);
      setSelectedAction(null);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      getLatencyStats().then(r => { setLatencyStats(r.data); setShowBoxPlot(true); }).catch(() => {});
    } else {
      setProvRunning(false);
    }
  };

  const handleExecuteAction = async () => {
    if (selectedIdx === null || !selectedAction) return;
    setActionLoading(true);
    setActionMsg('Executing...');
    try {
      if (selectedAction === 'release-pdu') {
        await releasePduSession(selectedIdx, selectedPduId);
      } else if (selectedAction === 'user-inactivity') {
        await triggerUserInactivity(selectedIdx);
      } else if (selectedAction === 'deregister') {
        await deregisterUE(selectedIdx);
      }
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const provPct = provStatus.total > 0 ? Math.round((provStatus.progress / provStatus.total) * 100) : 0;

  // UE table columns
  const columns: TableColumnsType<any> = [
    { title: 'IMSI', dataIndex: 'imsi', key: 'imsi', width: 130 },
    { title: 'DNN', dataIndex: 'dnn', key: 'dnn', width: 80 },
    { title: 'IPv4', dataIndex: 'ipv4', key: 'ipv4', width: 130 },
    { title: 'TEID', dataIndex: 'gtp_teid', key: 'teid', width: 90 },
    { title: 'RAN-ID', dataIndex: 'ran_ue_ngap_id', key: 'ran', width: 80 },
    { title: 'AMF-ID', dataIndex: 'amf_ue_ngap_id', key: 'amf', width: 80 },
    {
      title: 'State', key: 'state', width: 110,
      render: (_: any, r: any) => {
        const s = r.state;
        const color = s === 'pdu_established' || s === 'service_accepted' ? 'success'
          : s === 'registered' ? 'processing'
          : s === 'pdu_released' || s === 'context_released' ? 'warning'
          : 'error';
        return <Tag color={color}>{s}</Tag>;
      },
    },
    { title: 'Reg (ms)', key: 'reg', width: 80, render: (_: any, r: any) => r.latency_ms?.registration ?? '-' },
    { title: 'Session (ms)', key: 'sess', width: 100, render: (_: any, r: any) => r.latency_ms?.pdu_session_1 ?? '-' },
    {
      title: 'Total (ms)', key: 'total', width: 90,
      render: (_: any, r: any) => <Text strong style={{ color: '#00d4ff' }}>{r.latency_ms?.total ?? '-'}</Text>,
    },
  ];

  // Box plot data
  const plotData: any[] = [];
  const plotlyLayout: any = {
    paper_bgcolor: '#111827', plot_bgcolor: '#0a0e17',
    font: { color: '#e0e7ff', family: 'JetBrains Mono, monospace', size: 11 },
    margin: { t: 30, r: 20, b: 40, l: 60 },
    xaxis: { gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    yaxis: { title: 'Latency (ms)', gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    showlegend: false, height: 400,
  };
  if (latencyStats.registration) plotData.push({ type: 'box', name: 'Registration', y: _vals(latencyStats.registration), markerColor: '#00d4ff', boxpoints: 'outliers' });
  if (latencyStats.session) plotData.push({ type: 'box', name: 'Session', y: _vals(latencyStats.session), markerColor: '#00ff88', boxpoints: 'outliers' });
  if (latencyStats.total) plotData.push({ type: 'box', name: 'Total', y: _vals(latencyStats.total), markerColor: '#ffaa00', boxpoints: 'outliers' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
      {/* Header row with status */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0, color: '#00d4ff', fontFamily: 'JetBrains Mono, monospace' }}>
            ◈ Dashboard
          </Typography.Title>
        </Col>
        <Col>
          <Tag color={testRunning ? 'processing' : 'default'} style={{ fontSize: 12, padding: '2px 12px' }}>
            {testRunning ? '● TEST RUNNING' : '● IDLE'}
          </Tag>
          {provRunning && (
            <Tag color="processing" style={{ fontSize: 12, padding: '2px 12px' }}>
              ● PROVISIONING
            </Tag>
          )}
        </Col>
      </Row>

      {/* Config bar + Run button */}
      <Card size="small" style={{ marginBottom: 16, flexShrink: 0 }}>
        <Space wrap size="middle" align="end">
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>TASK:</Text>
            <Select value={taskMode} onChange={setTaskMode} size="small" style={{ width: 120 }}
              options={[
                { value: 'ue-test', label: 'UE Test' },
                { value: 'provision', label: 'Provision' },
              ]}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>MODE:</Text>
            <Select value={mode} onChange={v => setMode(v as any)} size="small" style={{ width: 70 }}
              options={[{ value: '5g', label: '5G' }, { value: '4g', label: '4G' }]}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>COUNT:</Text>
            <InputNumber value={count} onChange={v => setCount(v ?? 10)} size="small" min={1} max={1000} style={{ width: 70 }} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>CORE:</Text>
            <Select value={coreNetwork} onChange={setCoreNetwork} size="small" style={{ width: 110 }}
              options={[{ value: 'free5gc', label: 'Free5GC' }, { value: 'open5gs', label: 'Open5GS' }]}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>PROFILE:</Text>
            <Select value={profile} onChange={setProfile} size="small" style={{ width: 110 }}
              options={profiles.map(p => ({ value: p.name, label: p.name }))}
            />
          </div>
          {taskMode === 'provision' && (
            <div>
              <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>ACTION:</Text>
              <Select value={action} onChange={setAction} size="small" style={{ width: 130 }}
                options={[{ value: 'provision', label: 'Provision' }, { value: 'delete', label: 'Delete' }]}
              />
            </div>
          )}
          {!isRunning ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun}>Run</Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={handleStop}>Stop</Button>
          )}
        </Space>
      </Card>

      {/* Provision progress */}
      {provRunning && provStatus.total > 0 && (
        <Alert
          type="info"
          showIcon
          icon={<CloudServerOutlined />}
          style={{ marginBottom: 16, flexShrink: 0 }}
          message={
            <Space>
              <Progress percent={provPct} size="small" style={{ width: 200 }} />
              <Text type="secondary">{provStatus.progress}/{provStatus.total} — {provStatus.status}</Text>
            </Space>
          }
        />
      )}

      {/* UE Results / Box Plot view toggle + card */}
      {(ues.length > 0 || (showBoxPlot && plotData.length > 0)) && (
        <Card
          className="dashboard-results-card"
          size="small"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          title={
            <Space>
              <Button
                type={viewTab === 'table' ? 'primary' : 'text'}
                size="small"
                icon={<TableOutlined />}
                onClick={() => setViewTab('table')}
                disabled={ues.length === 0}
              >
                Table
              </Button>
              <Button
                type={viewTab === 'boxplot' ? 'primary' : 'text'}
                size="small"
                icon={<BarChartOutlined />}
                onClick={() => setViewTab('boxplot')}
                disabled={plotData.length === 0}
              >
                Box Plot
              </Button>
              {viewTab === 'table' && ues.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>({ues.length} UEs)</Text>
              )}
            </Space>
          }
          extra={
            viewTab === 'table' && (
              <Space size="small">
                <Button size="small" icon={<DownloadOutlined />} onClick={exportUEsCSV}>CSV</Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={exportLatencyJSON}>Stats</Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={exportFullJSON}>Full</Button>
              </Space>
            )
          }
        >
          {viewTab === 'table' && ues.length > 0 && (
            <Table
              dataSource={ues.map((u, i) => ({ ...u, key: i }))}
              columns={columns}
              size="small"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              pagination={{
                defaultPageSize: 20,
                showSizeChanger: true,
                pageSizeOptions: ['20', '50', '100'],
                size: 'small',
              }}
              scroll={{ x: 1000, y: 'calc(100% - 40px)' }}
              onRow={(record) => ({
                onClick: () => {
                  const idx = record.key as number;
                  if (selectedIdx === idx) {
                    setSelectedIdx(null);
                    setSelectedAction(null);
                    setActionMsg('');
                  } else {
                    setSelectedIdx(idx);
                    setSelectedAction(null);
                    setActionMsg('');
                  }
                },
                style: {
                  cursor: 'pointer',
                  background: selectedIdx === record.key ? 'rgba(0,212,255,0.08)' : undefined,
                },
              })}
              rowClassName={(record) => selectedIdx === record.key ? 'ant-table-row-selected' : ''}
            />
          )}
          {viewTab === 'boxplot' && plotData.length > 0 && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Plot data={plotData} layout={plotlyLayout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%' }} />
            </div>
          )}
        </Card>
      )}

      {/* UE Action Panel */}
      {selectedIdx !== null && ues[selectedIdx] && (
        <Card
          size="small"
          style={{ marginBottom: 16, flexShrink: 0, borderColor: '#1e3a5f', background: '#0d1117' }}
          styles={{ body: { padding: '12px 16px' } }}
          extra={
            <Button size="small" type="text" style={{ color: '#64748b' }} onClick={() => { setSelectedIdx(null); setSelectedAction(null); setActionMsg(''); }}>
              ✕
            </Button>
          }
        >
          {/* Top row: UE info + actions inline */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
            {/* UE Identity */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <ThunderboltOutlined style={{ color: '#00d4ff', fontSize: 14 }} />
                <Text style={{ color: '#e0e7ff', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600 }}>
                  {ues[selectedIdx]?.imsi}
                </Text>
                <Tag color={
                  (ues[selectedIdx]?.state === 'pdu_established' || ues[selectedIdx]?.state === 'service_accepted') ? 'success'
                    : ues[selectedIdx]?.state === 'registered' ? 'processing'
                    : ues[selectedIdx]?.state === 'pdu_released' || ues[selectedIdx]?.state === 'context_released' ? 'warning'
                    : 'default'
                } style={{ fontSize: 11 }}>{ues[selectedIdx]?.state}</Tag>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>
                <span>IPv4 <span style={{ color: '#94a3b8' }}>{ues[selectedIdx]?.ipv4}</span></span>
                <span>RAN <span style={{ color: '#94a3b8' }}>{ues[selectedIdx]?.ran_ue_ngap_id}</span></span>
                <span>AMF <span style={{ color: '#94a3b8' }}>{ues[selectedIdx]?.amf_ue_ngap_id}</span></span>
              </div>
            </div>

            {/* Separator */}
            <div style={{ width: 1, alignSelf: 'stretch', background: '#1e3a5f', flexShrink: 0 }} />

            {/* Action options */}
            <div style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['release-pdu', 'user-inactivity', 'deregister'] as const).map(a => (
                <div
                  key={a}
                  style={{
                    padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, transition: 'all 0.15s',
                    border: `1px solid ${selectedAction === a ? '#00d4ff' : '#1e3a5f'}`,
                    background: selectedAction === a ? 'rgba(0,212,255,0.1)' : 'transparent',
                    color: selectedAction === a ? '#00d4ff' : '#94a3b8',
                    fontWeight: selectedAction === a ? 500 : 400,
                  }}
                  onClick={() => setSelectedAction(a)}
                >
                  {selectedAction === a ? '◉' : '○'} {a === 'release-pdu' ? 'Release PDU' : a === 'user-inactivity' ? 'User Inactivity' : 'Deregister'}
                </div>
              ))}
              {selectedAction === 'release-pdu' && (ues[selectedIdx]?.pdu_sessions?.length > 0) && (
                <Select
                  size="small"
                  value={selectedPduId}
                  onChange={setSelectedPduId}
                  style={{ minWidth: 300 }}
                  popupMatchSelectWidth={true}
                  options={(ues[selectedIdx]?.pdu_sessions || []).map((s: any) => ({
                    value: s.pdu_session_id,
                    label: `${s.dnn} (ID:${s.pdu_session_id}) — ${s.state}`,
                  }))}
                />
              )}
            </div>

            {/* Execute button + status — pushed to the right */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, alignSelf: 'center' }}>
              {actionMsg && (
                <div style={{
                  padding: '4px 10px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
                  fontFamily: 'JetBrains Mono, monospace',
                  background: actionLoading ? 'rgba(0,212,255,0.08)' : 'rgba(0,255,136,0.08)',
                  color: actionLoading ? '#00d4ff' : '#00ff88',
                  border: `1px solid ${actionLoading ? '#00d4ff33' : '#00ff8833'}`,
                }}>
                  {actionMsg}
                </div>
              )}
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={actionLoading}
                disabled={!selectedAction || actionLoading}
                onClick={handleExecuteAction}
                style={{ minWidth: 120 }}
              >
                {actionLoading ? 'Running...' : 'Execute'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Provision log */}
      {provLog.length > 0 && (
        <Card size="small" title={<Text type="secondary" style={{ fontSize: 12 }}>PROVISION LOG</Text>} style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', maxHeight: 160, overflowY: 'auto' }}>
            {provLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </Card>
      )}
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
