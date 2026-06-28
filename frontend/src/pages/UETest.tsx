import React, { useState, useEffect, useCallback } from 'react';
import Plot from '../components/Plot';
import {
  start5GTest, start4GTest, stopTest, getTestStatus,
  getTestUEs, getLatencyStats, listProfiles,
  exportUEsCSV, exportLatencyJSON, exportFullJSON,
  releasePduSession, triggerUserInactivity, deregisterUE,
  releaseAllPduSessions, getUEEvents,
} from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';

type ActionType = 'release-pdu' | 'user-inactivity' | 'deregister' | null;

export default function UETest() {
  const [mode, setMode] = useState<'5g' | '4g'>('5g');
  const [count, setCount] = useState(10);
  const [coreNetwork, setCoreNetwork] = useState('free5gc');
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [ues, setUes] = useState<any[]>([]);
  const [latencyStats, setLatencyStats] = useState<any>({});
  const [showBoxPlot, setShowBoxPlot] = useState(false);

  // UE action state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionType>(null);
  const [selectedPduId, setSelectedPduId] = useState<number>(1);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string>('');

  // Event log state
  const [eventLog, setEventLog] = useState<any[]>([]);
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    listProfiles().then(r => {
      setProfiles(r.data.profiles || []);
      setProfile(r.data.active || '');
    }).catch(() => {});
    getTestStatus().then(r => setRunning(r.data.running)).catch(() => {});
    getTestUEs().then(r => setUes(r.data)).catch(() => {});
    getLatencyStats().then(r => {
      if (Object.keys(r.data).length > 0) {
        setLatencyStats(r.data);
        setShowBoxPlot(true);
      }
    }).catch(() => {});
  }, []);

  const onWS = useCallback((type: string, data: any) => {
    if (type === 'test_ues_update' && data.ues) setUes(data.ues);
    if (type === 'test_complete') {
      setRunning(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      getLatencyStats().then(r => {
        setLatencyStats(r.data);
        setShowBoxPlot(true);
      }).catch(() => {});
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
      setEventLog([]);
      setShowEvents(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
    }
  }, []);
  useWebSocket(onWS);

  const handleStart = async () => {
    setShowBoxPlot(false);
    setUes([]);
    setLatencyStats({});
    setSelectedIdx(null);
    setSelectedAction(null);
    setEventLog([]);
    setShowEvents(false);
    const payload = { count, core_network: coreNetwork, profile };
    setRunning(true);
    try {
      if (mode === '5g') await start5GTest(payload);
      else await start4GTest(payload);
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
      setRunning(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopTest();
      setRunning(false);
      getTestUEs().then(r => setUes(r.data)).catch(() => {});
      getLatencyStats().then(r => {
        setLatencyStats(r.data);
        setShowBoxPlot(true);
      }).catch(() => {});
    } catch {}
  };

  const handleExecute = async () => {
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

  const handleViewEvents = async (idx: number) => {
    try {
      const r = await getUEEvents(idx);
      setEventLog(r.data.events || []);
      setShowEvents(true);
    } catch (e: any) {
      setEventLog([]);
    }
  };

  // Build Plotly box plot data
  const plotData: any[] = [];
  const plotlyLayout: any = {
    paper_bgcolor: '#111827',
    plot_bgcolor: '#0a0e17',
    font: { color: '#e0e7ff', family: 'JetBrains Mono, monospace', size: 11 },
    margin: { t: 30, r: 20, b: 40, l: 60 },
    xaxis: { gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    yaxis: { title: 'Latency (ms)', gridcolor: '#1e3a5f', zerolinecolor: '#1e3a5f' },
    showlegend: false,
    height: 350,
  };

  if (latencyStats.registration) {
    plotData.push({ type: 'box', name: 'Registration', y: _valuesFromStats(latencyStats.registration), markerColor: '#00d4ff', boxpoints: 'outliers' });
  }
  if (latencyStats.session) {
    plotData.push({ type: 'box', name: 'Session', y: _valuesFromStats(latencyStats.session), markerColor: '#00ff88', boxpoints: 'outliers' });
  }
  if (latencyStats.total) {
    plotData.push({ type: 'box', name: 'Total', y: _valuesFromStats(latencyStats.total), markerColor: '#ffaa00', boxpoints: 'outliers' });
  }
  if (latencyStats.release) {
    plotData.push({ type: 'box', name: 'Release', y: _valuesFromStats(latencyStats.release), markerColor: '#ff6b6b', boxpoints: 'outliers' });
  }
  if (latencyStats.deregister) {
    plotData.push({ type: 'box', name: 'Deregister', y: _valuesFromStats(latencyStats.deregister), markerColor: '#c084fc', boxpoints: 'outliers' });
  }
  if (latencyStats.service_request) {
    plotData.push({ type: 'box', name: 'ServiceReq', y: _valuesFromStats(latencyStats.service_request), markerColor: '#38bdf8', boxpoints: 'outliers' });
  }

  const selectedUE = selectedIdx !== null ? ues[selectedIdx] : null;
  const pduSessions: any[] = selectedUE?.pdu_sessions || [];

  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ color: 'var(--accent)', fontSize: '24px', marginBottom: '24px', fontFamily: 'var(--font-mono)' }}>
          ◉ UE Test
        </h1>

        {/* Control Panel */}
        <div className="panel" style={{ maxWidth: '700px', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>MODE</label>
              <select className="input" value={mode} onChange={e => setMode(e.target.value as any)} style={{ width: '100%' }}>
                <option value="5g">5G</option>
                <option value="4g">4G</option>
              </select>
            </div>
            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>COUNT</label>
              <input className="input" type="number" value={count} onChange={e => setCount(+e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>CORE NETWORK</label>
              <select className="input" value={coreNetwork} onChange={e => setCoreNetwork(e.target.value)} style={{ width: '100%' }}>
                <option value="free5gc">Free5GC</option>
                <option value="open5gs">Open5GS</option>
              </select>
            </div>
            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>PROFILE</label>
              <select className="input" value={profile} onChange={e => setProfile(e.target.value)} style={{ width: '100%' }}>
                {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!running ? (
              <button className="btn btn-primary" onClick={handleStart}>▶ Start {mode.toUpperCase()} Test</button>
            ) : (
              <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
            )}
          </div>
        </div>

        {/* UE Detail Table */}
        {ues.length > 0 && (
          <div className="panel" style={{ marginBottom: '20px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>UE DETAIL TABLE ({ues.length} UEs)</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button className="btn btn-danger" onClick={handleReleaseAll} style={{ fontSize: '11px', padding: '4px 10px' }}>
                  Release All PDU
                </button>
                <button className="btn btn-export" onClick={exportUEsCSV}>↓ Export CSV</button>
                <button className="btn btn-export" onClick={exportLatencyJSON}>↓ Export JSON (Stats)</button>
                <button className="btn btn-export" onClick={exportFullJSON}>↓ Export JSON (Full)</button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>IMSI</th><th>DNN</th><th>IPv4</th><th>TEID</th>
                  <th>RANUENGAPID</th><th>AMFUENGAPID</th><th>State</th>
                  <th>Reg (ms)</th><th>Session (ms)</th><th>Total (ms)</th>
                  <th>Release (ms)</th><th>Dereg (ms)</th><th>SR (ms)</th>
                </tr>
              </thead>
              <tbody>
                {ues.map((ue, i) => (
                  <tr
                    key={i}
                    className={`ue-row-clickable ${selectedIdx === i ? 'ue-row-selected' : ''}`}
                    onClick={() => {
                      if (selectedIdx === i) {
                        setSelectedIdx(null);
                        setSelectedAction(null);
                        setActionMsg('');
                        setEventLog([]);
                        setShowEvents(false);
                      } else {
                        setSelectedIdx(i);
                        setSelectedAction(null);
                        setActionMsg('');
                        setEventLog([]);
                        setShowEvents(false);
                        handleViewEvents(i);
                      }
                    }}
                  >
                    <td>{ue.imsi}</td>
                    <td>{ue.dnn}</td>
                    <td>{ue.ipv4}</td>
                    <td>{ue.gtp_teid}</td>
                    <td>{ue.ran_ue_ngap_id}</td>
                    <td>{ue.amf_ue_ngap_id}</td>
                    <td><span className={`badge ${_stateBadgeClass(ue.state)}`}>{ue.state}</span></td>
                    <td>{ue.latency_ms?.registration ?? '-'}</td>
                    <td>{ue.latency_ms?.pdu_session_1 ?? '-'}</td>
                    <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{ue.latency_ms?.total ?? '-'}</td>
                    <td>{ue.latency_ms?.release ?? '-'}</td>
                    <td>{ue.latency_ms?.deregister ?? '-'}</td>
                    <td>{ue.latency_ms?.service_request ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Event log below table */}
            {showEvents && eventLog.length > 0 && (
              <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '8px' }}>
                  EVENT LOG — UE#{selectedIdx}
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  {eventLog.map((evt: any, ei: number) => (
                    <div key={ei} style={{ padding: '3px 0', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(30,58,95,0.3)' }}>
                      <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>{new Date(evt.ts).toLocaleTimeString()}</span>
                      <span style={{ color: 'var(--accent)', marginRight: '6px' }}>[{evt.type}]</span>
                      <span>{evt.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Box Plot */}
        {showBoxPlot && plotData.length > 0 && (
          <div className="panel panel-glow">
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '12px' }}>LATENCY DISTRIBUTION (BOX PLOT)</div>
            <Plot
              data={plotData}
              layout={plotlyLayout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>

      {/* Action Panel (right side) */}
      {selectedUE && (
        <div className="ue-action-panel">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', letterSpacing: '0.5px' }}>
            UE ACTIONS
          </div>

          {/* UE Info */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
              {selectedUE.imsi}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              IPv4: {selectedUE.ipv4}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              State: <span className={`badge ${_stateBadgeClass(selectedUE.state)}`} style={{ fontSize: '10px' }}>{selectedUE.state}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              RANUENGAPID: {selectedUE.ran_ue_ngap_id} / AMFUENGAPID: {selectedUE.amf_ue_ngap_id}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>SELECT ACTION</div>

            {/* Release PDU Session */}
            <div
              className={`ue-action-option ${selectedAction === 'release-pdu' ? 'selected' : ''}`}
              onClick={() => setSelectedAction('release-pdu')}
            >
              <span className="action-radio">{selectedAction === 'release-pdu' ? '◉' : '○'}</span>
              <span>Release PDU Session</span>
            </div>
            {selectedAction === 'release-pdu' && pduSessions.length > 0 && (
              <div style={{ marginLeft: '24px', marginTop: '6px' }}>
                <select
                  className="input"
                  value={selectedPduId}
                  onChange={e => setSelectedPduId(+e.target.value)}
                  style={{ width: '100%', fontSize: '12px' }}
                >
                  {pduSessions.map((s: any) => (
                    <option key={s.pdu_session_id} value={s.pdu_session_id}>
                      {s.dnn} (ID:{s.pdu_session_id}) — {s.state}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedAction === 'release-pdu' && pduSessions.length === 0 && (
              <div style={{ marginLeft: '24px', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                No PDU sessions available
              </div>
            )}

            {/* User Inactivity */}
            <div
              className={`ue-action-option ${selectedAction === 'user-inactivity' ? 'selected' : ''}`}
              onClick={() => setSelectedAction('user-inactivity')}
            >
              <span className="action-radio">{selectedAction === 'user-inactivity' ? '◉' : '○'}</span>
              <span>User Inactivity</span>
            </div>

            {/* Deregister */}
            <div
              className={`ue-action-option ${selectedAction === 'deregister' ? 'selected' : ''}`}
              onClick={() => setSelectedAction('deregister')}
            >
              <span className="action-radio">{selectedAction === 'deregister' ? '◉' : '○'}</span>
              <span>Deregister UE</span>
            </div>
          </div>

          {/* Execute Button */}
          <button
            className="btn btn-primary ue-action-btn"
            disabled={!selectedAction || actionLoading}
            onClick={handleExecute}
            style={{ width: '100%' }}
          >
            {actionLoading ? '⏳ Executing...' : '▶ Execute'}
          </button>

          {/* Action message */}
          {actionMsg && (
            <div style={{
              marginTop: '10px',
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              background: actionLoading ? 'rgba(0,212,255,0.08)' : 'rgba(0,255,136,0.08)',
              color: actionLoading ? 'var(--accent)' : 'var(--success)',
              border: `1px solid ${actionLoading ? 'var(--accent-border)' : 'rgba(0,255,136,0.3)'}`,
            }}>
              {actionMsg}
            </div>
          )}

          {/* Event log in action panel */}
          {showEvents && eventLog.length > 0 && (
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>EVENTS</div>
              <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                {eventLog.map((evt: any, ei: number) => (
                  <div key={ei} style={{ padding: '2px 0', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(30,58,95,0.2)' }}>
                    <span style={{ color: 'var(--accent)' }}>[{evt.type}]</span> {evt.detail}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function _stateBadgeClass(state: string): string {
  if (state === 'pdu_established' || state === 'service_accepted') return 'badge-success';
  if (state === 'registered') return 'badge-running';
  if (state === 'pdu_released' || state === 'context_released') return 'badge-warning';
  if (state === 'idle' || state === 'deregistered') return 'badge-error';
  return '';
}

function _valuesFromStats(s: any): number[] {
  const vals: number[] = [];
  if (s.min !== undefined) vals.push(s.min);
  if (s.q1 !== undefined) vals.push(s.q1);
  if (s.median !== undefined) vals.push(s.median);
  if (s.q3 !== undefined) vals.push(s.q3);
  if (s.max !== undefined) vals.push(s.max);
  if (s.outliers) vals.push(...s.outliers);
  return vals;
}
