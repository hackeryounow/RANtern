import React, { useState, useEffect, useCallback } from 'react';
import { startProvision, getProvisionStatus, listProfiles } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Provision() {
  const [count, setCount] = useState(10);
  const [coreNetwork, setCoreNetwork] = useState('free5gc');
  const [action, setAction] = useState('provision');
  const [profile, setProfile] = useState('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [status, setStatus] = useState<any>({ status: 'idle' });
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    listProfiles().then(r => {
      setProfiles(r.data.profiles || []);
      setProfile(r.data.active || '');
    }).catch(() => {});
    const interval = setInterval(() => {
      getProvisionStatus().then(r => setStatus(r.data)).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const onWS = useCallback((type: string, data: any) => {
    if (type.startsWith('provision_')) {
      setLog(prev => [...prev, `[${type}] ${JSON.stringify(data)}`]);
    }
  }, []);
  useWebSocket(onWS);

  const handleStart = async () => {
    setLog([]);
    try {
      const res = await startProvision({ count, core_network: coreNetwork, action, profile });
      setLog([`Task ${res.data.task_id} started`]);
    } catch (e: any) {
      setLog([`Error: ${e.message}`]);
    }
  };

  const progressPct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;

  return (
    <div>
      <h1 style={{ color: 'var(--accent)', fontSize: '24px', marginBottom: '24px', fontFamily: 'var(--font-mono)' }}>
        ⬡ Provision
      </h1>

      <div className="panel" style={{ maxWidth: '600px', marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
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
            <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>ACTION</label>
            <select className="input" value={action} onChange={e => setAction(e.target.value)} style={{ width: '100%' }}>
              <option value="provision">Provision</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          <div>
            <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>PROFILE</label>
            <select className="input" value={profile} onChange={e => setProfile(e.target.value)} style={{ width: '100%' }}>
              {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleStart} disabled={status.status === 'running'}>
          {status.status === 'running' ? '⏳ Running...' : '▶ Start'}
        </button>
      </div>

      {/* Progress */}
      {status.status !== 'idle' && (
        <div className="panel" style={{ maxWidth: '600px', marginBottom: '20px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '8px' }}>PROGRESS</div>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '4px', height: '8px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              width: `${progressPct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent), var(--success))',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {status.progress}/{status.total} — {status.status}
          </div>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="panel" style={{ maxWidth: '600px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '8px' }}>LOG</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', maxHeight: '200px', overflowY: 'auto' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
