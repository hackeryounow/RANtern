import React, { useState, useEffect } from 'react';
import { getNGAPStats } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useCallback } from 'react';

export default function NGAPStats() {
  const [stats, setStats] = useState<any>({});

  useEffect(() => {
    getNGAPStats().then(r => setStats(r.data)).catch(() => {});
    const interval = setInterval(() => {
      getNGAPStats().then(r => setStats(r.data)).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const onWS = useCallback((type: string, data: any) => {
    if (type === 'ngap_stats') setStats(data);
  }, []);
  useWebSocket(onWS);

  const entries = Object.entries(stats);

  return (
    <div>
      <h1 style={{ color: 'var(--accent)', fontSize: '24px', marginBottom: '24px', fontFamily: 'var(--font-mono)' }}>
        ⬢ NGAP Statistics
      </h1>

      <div className="panel" style={{ overflowX: 'auto' }}>
        {entries.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            No NGAP data yet. Start a test to see live message counters.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Message Type</th><th>Sent</th><th>Received</th></tr>
            </thead>
            <tbody>
              {entries.map(([name, counts]: [string, any]) => (
                <tr key={name}>
                  <td style={{ color: 'var(--accent)' }}>{name}</td>
                  <td>{counts.sent ?? 0}</td>
                  <td>{counts.received ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
