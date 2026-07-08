import { useState, useEffect, useCallback } from 'react';
import {
  Select, InputNumber, Button, Table, Card, Tag, Progress, Space, Row, Col, Typography, Divider, Alert, Statistic, Steps, Badge, Modal, Input,
} from 'antd';
import {
  PlayCircleOutlined, StopOutlined, ThunderboltOutlined,
  DownloadOutlined, CloudServerOutlined, TableOutlined, BarChartOutlined,
  WarningOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, ApiOutlined, RiseOutlined, FallOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  startProvision, getProvisionStatus,
  start5GTest, start4GTest, stopTest, getTestStatus,
  getTestUEs, getLatencyStats, listProfiles,
  exportUEsCSV, exportLatencyJSON, exportFullJSON,
  releasePduSession, establishPduSession, triggerUserInactivity, deregisterUE, reregisterUE,
  releaseAllPduSessions, deregisterAllUEs, serviceRequestAllUEs, oneClickTest, restartService, clearRedis, getUEEvents,
} from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import Profile from './Profile';

import Plot from '../components/Plot';

const { Text } = Typography;

type TaskMode = 'provision' | 'ue-test';

export default function Dashboard() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<'5g' | '4g'>('5g');
  const [count, setCount] = useState(10);
  const [ueInitDelay, setUeInitDelay] = useState(0.3);
  const [oneClickRounds, setOneClickRounds] = useState(1);
  const [coreNetwork, setCoreNetwork] = useState('free5gc');
  const [action, setAction] = useState('provision');
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [taskMode, setTaskMode] = useState<TaskMode>('ue-test');

  // UE action state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<'release-pdu' | 'establish-pdu' | 'user-inactivity' | 'deregister' | 're-register' | null>(null);
  const [selectedPduId, setSelectedPduId] = useState<number>(1);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string>('');

  // Event log state
  const [eventLog, setEventLog] = useState<any[]>([]);
  const [showEvents, setShowEvents] = useState(false);

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

  // Global real-time log stream — reference: Cymas terminal-style logs
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [showGlobalLogs, setShowGlobalLogs] = useState(false);

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
    const fmtTime = (ts?: string) => {
      if (!ts) return new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
      const d = new Date(ts);
      return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    };
    if (type === 'test_ues_update' && data.ues) setUes(data.ues);
    if (type === 'test_complete') {
      setTestRunning(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      getLatencyStats().then(r => { setLatencyStats(r.data); setShowBoxPlot(true); }).catch(() => {});
      setGlobalLogs(prev => [...prev.slice(-200), `[${fmtTime(data.ts)}] [TEST] Test completed`]);
    }
    if (type === 'latency_stats_update') {
      setLatencyStats(data);
      setShowBoxPlot(true);
    }
    if (type === 'ue_action_progress') {
      setActionMsg(data.message || '');
      if (data.message) {
        setGlobalLogs(prev => [...prev.slice(-200), `[${fmtTime(data.ts)}] [${data.action?.toUpperCase() || 'ACTION'}] ${data.message}`]);
        setShowGlobalLogs(true);
      }
    }
    if (type === 'ue_action_complete') {
      setActionLoading(false);
      setActionMsg(data.message || '');
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      if (data.message) {
        setGlobalLogs(prev => [...prev.slice(-200), `[${fmtTime(data.ts)}] [${data.action?.toUpperCase() || 'ACTION'}] ${data.status?.toUpperCase()}: ${data.message}`]);
      }
    }
    if (type === 'ue_removed') {
      setSelectedIdx(null);
      setSelectedAction(null);
      setEventLog([]);
      setShowEvents(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
    }
    if (type === 'redis_cleared') {
      setUes([]); setLatencyStats({}); setShowBoxPlot(false);
      setSelectedIdx(null); setSelectedAction(null);
      setEventLog([]); setShowEvents(false);
      setGlobalLogs([]);
    }
    if (type === 'service_restarted') {
      setGlobalLogs(prev => [...prev.slice(-200), `[${fmtTime(data.ts)}] [SYSTEM] Service restarted`]);
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
      setSelectedIdx(null); setSelectedAction(null);
      setEventLog([]); setShowEvents(false);
      setTestRunning(true);
      try {
        const payload = { count, core_network: coreNetwork, profile, ue_init_delay: ueInitDelay };
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
      } else if (selectedAction === 'establish-pdu') {
        await establishPduSession(selectedIdx, selectedPduId);
      } else if (selectedAction === 'user-inactivity') {
        await triggerUserInactivity(selectedIdx);
      } else if (selectedAction === 'deregister') {
        await deregisterUE(selectedIdx);
      } else if (selectedAction === 're-register') {
        await reregisterUE(selectedIdx);
      }
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const handleReleaseAll = async () => {
    setActionLoading(true);
    setActionMsg('Releasing all PDU sessions...');
    try {
      await releaseAllPduSessions();
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const handleDeregisterAll = async () => {
    setActionLoading(true);
    setActionMsg('Deregistering all UEs...');
    try {
      await deregisterAllUEs();
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const handleServiceRequestAll = async () => {
    setActionLoading(true);
    setActionMsg('Triggering service request for all UEs...');
    try {
      await serviceRequestAllUEs();
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const handleOneClickTest = async () => {
    setActionLoading(true);
    setActionMsg(`One-click test: ${oneClickRounds} round${oneClickRounds > 1 ? 's' : ''}, interval ${ueInitDelay}s...`);
    try {
      await oneClickTest(oneClickRounds, ueInitDelay);
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    if (!window.confirm('Restart service? This will stop any running test and clear all UE data.')) return;
    try {
      await restartService();
      setUes([]); setLatencyStats({}); setShowBoxPlot(false);
      setSelectedIdx(null); setSelectedAction(null);
      setEventLog([]); setShowEvents(false);
      setActionMsg('Service restarted');
      // Refresh page after a short delay to reconnect
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setActionMsg(e.response?.data?.error || e.message);
    }
  };

  const handleViewEvents = async (idx: number) => {
    try {
      const r = await getUEEvents(idx);
      const events = r.data.events || [];
      setEventLog(events);
      setShowEvents(true);
      // Append UE events to global log stream
      if (events.length > 0) {
        const ue = ues[idx];
        const ueId = ue?.imsi || `UE#${idx}`;
        const newLogs = events.map((evt: any) => {
          const ts = evt.ts ? new Date(evt.ts).toLocaleTimeString('en-GB', { hour12: false }) : new Date().toLocaleTimeString('en-GB', { hour12: false });
          return `[${ts}] [UE-${ueId}] [${evt.type?.toUpperCase()}] ${evt.detail}`;
        });
        setGlobalLogs(prev => [...prev.slice(-200), ...newLogs]);
        setShowGlobalLogs(true);
      }
    } catch {
      setEventLog([]);
    }
  };

  const provPct = provStatus.total > 0 ? Math.round((provStatus.progress / provStatus.total) * 100) : 0;

  // UE table columns
  const columns: TableColumnsType<any> = [
    { title: 'IMSI', dataIndex: 'imsi', key: 'imsi', width: 130 },
    { title: 'DNN', dataIndex: 'dnn', key: 'dnn', width: 80 },
    { title: 'IPv4', dataIndex: 'ipv4', key: 'ipv4', width: 130 },
    { title: 'TEID', dataIndex: 'gtp_teid', key: 'teid', width: 90,
      render: (_: any, r: any) => {
        const v = r.gtp_teid;
        if (v === 'N/A' || v === undefined || v === null || v === '') return '-';
        const n = parseInt(v, 10);
        if (isNaN(n)) return v;
        return n.toString(16).padStart(8, '0').toUpperCase();
      },
    },
    { title: 'RANUENGAPID', dataIndex: 'ran_ue_ngap_id', key: 'ran', width: 100 },
    { title: 'AMFUENGAPID', dataIndex: 'amf_ue_ngap_id', key: 'amf', width: 100 },
    {
      title: 'State', key: 'state', width: 130,
      render: (_: any, r: any) => {
        const s = r.state;
        const config: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
          pdu_established: { color: 'success', icon: <CheckCircleOutlined />, label: 'PDU Established' },
          service_accepted: { color: 'success', icon: <CheckCircleOutlined />, label: 'Service Accepted' },
          registered: { color: 'processing', icon: <ApiOutlined />, label: 'Registered' },
          pdu_released: { color: 'warning', icon: <FallOutlined />, label: 'PDU Released' },
          context_released: { color: 'warning', icon: <FallOutlined />, label: 'Context Released' },
          deregistered: { color: 'error', icon: <CloseCircleOutlined />, label: 'Deregistered' },
          idle: { color: 'default', icon: <ClockCircleOutlined />, label: 'Idle' },
        };
        const cfg = config[s] || { color: 'default', icon: <ClockCircleOutlined />, label: s };
        return <Tag color={cfg.color} icon={cfg.icon} style={{ fontSize: 11 }}>{cfg.label}</Tag>;
      },
    },
    { title: 'Reg (ms)', key: 'reg', width: 80, render: (_: any, r: any) => r.latency_ms?.registration ?? '-' },
    { title: 'Session (ms)', key: 'sess', width: 100, render: (_: any, r: any) => r.latency_ms?.pdu_session_1 ?? '-' },
    {
      title: 'Total (ms)', key: 'total', width: 90,
      render: (_: any, r: any) => <Text strong style={{ color: '#00d4ff' }}>{r.latency_ms?.total ?? '-'}</Text>,
    },
    { title: 'Release (ms)', key: 'release', width: 100, render: (_: any, r: any) => r.latency_ms?.release ?? '-' },
    { title: 'Dereg (ms)', key: 'dereg', width: 90, render: (_: any, r: any) => r.latency_ms?.deregister ?? '-' },
    { title: 'SR (ms)', key: 'sr', width: 80, render: (_: any, r: any) => r.latency_ms?.service_request ?? '-' },
  ];

  // Box plot data
  const plotData: any[] = [];
  const plotlyLayout: any = {
    paper_bgcolor: '#111827', plot_bgcolor: '#0a0e17',
    font: { color: '#e0e7ff', family: 'Consolas, Liberation Mono, Menlo, monospace', size: 11 },
    margin: { t: 30, r: 20, b: 40, l: 60 },
    xaxis: { gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    yaxis: { title: 'Latency (ms)', gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    showlegend: false, height: 400,
  };
  if (latencyStats.registration) plotData.push({ type: 'box', name: 'Registration', y: _vals(latencyStats.registration), markerColor: '#00d4ff', boxpoints: 'outliers' });
  if (latencyStats.session) plotData.push({ type: 'box', name: 'Session', y: _vals(latencyStats.session), markerColor: '#00ff88', boxpoints: 'outliers' });
  if (latencyStats.total) plotData.push({ type: 'box', name: 'Total', y: _vals(latencyStats.total), markerColor: '#ffaa00', boxpoints: 'outliers' });
  if (latencyStats.release) plotData.push({ type: 'box', name: 'Release', y: _vals(latencyStats.release), markerColor: '#ff6b6b', boxpoints: 'outliers' });
  if (latencyStats.deregister) plotData.push({ type: 'box', name: 'Deregister', y: _vals(latencyStats.deregister), markerColor: '#c084fc', boxpoints: 'outliers' });
  if (latencyStats.service_request) plotData.push({ type: 'box', name: 'ServiceReq', y: _vals(latencyStats.service_request), markerColor: '#38bdf8', boxpoints: 'outliers' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
      {/* Header row with status */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0, color: '#00d4ff', fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
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
          {!testRunning && (
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRestart} style={{ marginLeft: 8, fontSize: 12, color: '#1890ff', borderColor: '#1890ff' }}>
              Reboot
            </Button>
          )}
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
            style={{ marginLeft: 8, fontSize: 12, color: '#8a9bb8', borderColor: '#8a9bb8' }}
          />
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
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>RATE (s):</Text>
            <InputNumber value={ueInitDelay} onChange={v => setUeInitDelay(v ?? 0.3)} size="small" min={0} max={10} step={0.1} style={{ width: 70 }} />
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
          <div>
            <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>ROUNDS:</Text>
            <InputNumber value={oneClickRounds} onChange={v => setOneClickRounds(v ?? 1)} size="small" min={1} max={100} style={{ width: 60 }} />
          </div>
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

      {/* Summary Statistics Cards — always visible */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Total UEs</Text>}
                value={ues.length}
                styles={{ content: { color: '#00d4ff', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<ApiOutlined style={{ fontSize: 14, color: '#00d4ff' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Registered</Text>}
                value={ues.filter((u: any) => u.state === 'registered' || u.state === 'pdu_established' || u.state === 'service_accepted').length}
                styles={{ content: { color: '#52c41a', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<CheckCircleOutlined style={{ fontSize: 14, color: '#52c41a' }} />}
                suffix={<span style={{ fontSize: 11, color: '#8a9bb8' }}>/{ues.length}</span>}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Avg Reg Latency</Text>}
                value={(() => {
                  const vals = ues.map((u: any) => u.latency_ms?.registration).filter((v: any) => typeof v === 'number');
                  return vals.length > 0 ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0;
                })()}
                styles={{ content: { color: '#faad14', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<ClockCircleOutlined style={{ fontSize: 14, color: '#faad14' }} />}
                suffix="ms"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Avg Session Latency</Text>}
                value={(() => {
                  const vals = ues.map((u: any) => u.latency_ms?.pdu_session_1).filter((v: any) => typeof v === 'number');
                  return vals.length > 0 ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0;
                })()}
                styles={{ content: { color: '#eb2f96', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<RiseOutlined style={{ fontSize: 14, color: '#eb2f96' }} />}
                suffix="ms"
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Active PDU Sessions</Text>}
                value={ues.filter((u: any) => u.state === 'pdu_established' || u.state === 'service_accepted').length}
                styles={{ content: { color: '#13c2c2', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<ThunderboltOutlined style={{ fontSize: 14, color: '#13c2c2' }} />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small" style={{ background: '#141b2d', borderColor: '#1e3a5f' }}>
              <Statistic
                title={<Text type="secondary" style={{ fontSize: 11 }}>Success Rate</Text>}
                value={(() => {
                  const established = ues.filter((u: any) => u.state === 'pdu_established' || u.state === 'service_accepted').length;
                  return ues.length > 0 ? Math.round((established / ues.length) * 100) : 0;
                })()}
                styles={{ content: { color: '#52c41a', fontSize: 20, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' } }}
                prefix={<CheckCircleOutlined style={{ fontSize: 14, color: '#52c41a' }} />}
                suffix="%"
              />
            </Card>
          </Col>
        </Row>

      {/* One-click test phase progress */}
      {actionLoading && actionMsg && actionMsg.includes('Phase') && (
        <Card size="small" style={{ marginBottom: 12, background: '#141b2d', borderColor: '#1e3a5f' }}>
          <Steps
            size="small"
            current={(() => {
              if (actionMsg.includes('Phase 1')) return 0;
              if (actionMsg.includes('Phase 2')) return 1;
              if (actionMsg.includes('Phase 3')) return 2;
              if (actionMsg.includes('Phase 4')) return 3;
              if (actionMsg.includes('Phase 5')) return 4;
              if (actionMsg.includes('Phase 6')) return 5;
              return 0;
            })()}
            items={[
              { title: 'Register', icon: <CheckCircleOutlined /> },
              { title: 'Deregister', icon: <CloseCircleOutlined /> },
              { title: 'Re-register', icon: <ReloadOutlined /> },
              { title: 'Release PDU', icon: <FallOutlined /> },
              { title: 'Re-register', icon: <ReloadOutlined /> },
              { title: 'Service Req', icon: <ThunderboltOutlined /> },
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#b8c4e0', fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
            {actionMsg}
          </div>
        </Card>
      )}

      {/* Batch action toolbar — always visible regardless of view tab */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8, marginBottom: 12, flexWrap: 'wrap', minHeight: 32 }}>
        <Button size="small" danger onClick={handleReleaseAll} disabled={ues.length === 0} style={{ minWidth: 120 }}>Release All PDU</Button>
        <Button size="small" danger onClick={handleDeregisterAll} disabled={ues.length === 0} style={{ minWidth: 120 }}>Deregister All</Button>
        <Button size="small" type="primary" onClick={handleServiceRequestAll} disabled={ues.length === 0} style={{ minWidth: 120 }}>Service Request All</Button>
        <Button size="small" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', border: 'none', minWidth: 120 }} onClick={handleOneClickTest} disabled={ues.length === 0}>One-Click Test</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={exportUEsCSV} disabled={ues.length === 0} style={{ minWidth: 80 }}>CSV</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={exportLatencyJSON} disabled={ues.length === 0} style={{ minWidth: 80 }}>Stats</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={exportFullJSON} disabled={ues.length === 0} style={{ minWidth: 80 }}>Full</Button>
      </div>

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
              scroll={{ x: 1200, y: 'calc(100% - 40px)' }}
              onRow={(record) => ({
                onClick: () => {
                  const idx = record.key as number;
                  if (selectedIdx === idx) {
                    setSelectedIdx(null);
                    setSelectedAction(null);
                    setActionMsg('');
                    setEventLog([]);
                    setShowEvents(false);
                  } else {
                    setSelectedIdx(idx);
                    setSelectedAction(null);
                    setActionMsg('');
                    setEventLog([]);
                    setShowEvents(false);
                    handleViewEvents(idx);
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
            <Button size="small" type="text" style={{ color: '#8a9bb8' }} onClick={() => { setSelectedIdx(null); setSelectedAction(null); setActionMsg(''); setEventLog([]); setShowEvents(false); }}>
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
                <Text style={{ color: '#e0e7ff', fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 13, fontWeight: 600 }}>
                  {ues[selectedIdx]?.imsi}
                </Text>
                <Tag color={
                  (ues[selectedIdx]?.state === 'pdu_established' || ues[selectedIdx]?.state === 'service_accepted') ? 'success'
                    : ues[selectedIdx]?.state === 'registered' ? 'processing'
                    : ues[selectedIdx]?.state === 'pdu_released' || ues[selectedIdx]?.state === 'context_released' ? 'warning'
                    : 'default'
                } style={{ fontSize: 11 }}>{ues[selectedIdx]?.state}</Tag>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#8a9bb8' }}>
                <span>IPv4 <span style={{ color: '#b8c4e0' }}>{ues[selectedIdx]?.ipv4}</span></span>
                <span>RANUENGAPID <span style={{ color: '#b8c4e0' }}>{ues[selectedIdx]?.ran_ue_ngap_id}</span></span>
                <span>AMFUENGAPID <span style={{ color: '#b8c4e0' }}>{ues[selectedIdx]?.amf_ue_ngap_id}</span></span>
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
                    color: selectedAction === a ? '#00d4ff' : '#b8c4e0',
                    fontWeight: selectedAction === a ? 500 : 400,
                    width: 130, textAlign: 'center', flexShrink: 0,
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
                  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
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

          {/* Event log */}
          {showEvents && eventLog.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid #1e3a5f', paddingTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>EVENT LOG</Text>
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 4, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 11 }}>
                {eventLog.map((evt: any, ei: number) => (
                  <div key={ei} style={{ padding: '2px 0', color: '#b8c4e0', borderBottom: '1px solid #1e293b' }}>
                    <span style={{ color: '#8a9bb8', marginRight: 8 }}>{new Date(evt.ts).toLocaleTimeString()}</span>
                    <span style={{ color: '#00d4ff', marginRight: 6 }}>[{evt.type}]</span>
                    <span>{evt.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Global Real-time Event Log Stream — reference: Cymas terminal-style logs */}
      {showGlobalLogs && globalLogs.length > 0 && (
        <Card
          size="small"
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ThunderboltOutlined style={{ marginRight: 6, color: '#00d4ff' }} />
                REAL-TIME EVENT LOG
              </Text>
              <Button size="small" type="text" style={{ fontSize: 11, color: '#8a9bb8' }} onClick={() => setGlobalLogs([])}>
                Clear
              </Button>
            </div>
          }
          style={{ marginBottom: 16, flexShrink: 0, background: '#0a0e17', borderColor: '#1e3a5f' }}
        >
          <div
            ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
            style={{
              fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
              fontSize: 11,
              color: '#b8c4e0',
              maxHeight: 200,
              overflowY: 'auto',
              background: '#0d1117',
              borderRadius: 4,
              padding: '8px 12px',
            }}
          >
            {globalLogs.map((log, i) => (
              <div key={i} style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>
                {log.includes('[ERROR]') || log.includes('failed') ? (
                  <span style={{ color: '#ff4d4f' }}>{log}</span>
                ) : log.includes('success') || log.includes('completed') || log.includes('accepted') ? (
                  <span style={{ color: '#52c41a' }}>{log}</span>
                ) : log.includes('Phase') ? (
                  <span style={{ color: '#faad14' }}>{log}</span>
                ) : (
                  <span style={{ color: '#b8c4e0' }}>{log}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Provision log */}
      {provLog.length > 0 && (
        <Card size="small" title={<Text type="secondary" style={{ fontSize: 12 }}>PROVISION LOG</Text>} style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 11, color: '#b8c4e0', maxHeight: 160, overflowY: 'auto' }}>
            {provLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </Card>
      )}

      {/* Settings Modal with Profile content */}
      <Modal
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={960}
        styles={{
          content: {
            padding: 0,
          },
          body: {
            padding: '28px 32px',
            maxHeight: '82vh',
            overflowY: 'auto',
          },
        }}
      >
        <Profile />
      </Modal>

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
