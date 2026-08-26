/**
 * PhoneDialerPanel — the simulated 5G phone (NGAP/NAS attach, GTP-U,
 * IMS VoNR dialing). Embedded by the unified Dialer page (Phone mode).
 *
 * Left: the device (PhoneFrame) + an icon rail: airplane toggle on top,
 * then a grouped pill of panel-openers (SIM / PDU / Ping / Traffic).
 * Right: the panel opened from the rail.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { message } from 'antd';
import { SendOutlined, IdcardOutlined, LineChartOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { usePhone } from '../../hooks/usePhone';
import type { PhoneTrafficCounters } from '../../hooks/usePhone';
import { getTopologyStatus, listTopologies } from '../../services/api';
import type { PhoneSimConfig } from '../../services/api';
import PhoneFrame from '../phone/PhoneFrame';
import SimPanel from '../phone/SimPanel';

const cardStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: '12px 14px',
};

const kvRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between',
  fontSize: 11.5, padding: '3px 0',
  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Each browser tab owns one simulated phone. The id is generated once and
 * kept in sessionStorage (per-tab storage), so a reload re-attaches to the
 * same phone while a new tab gets a fresh one — two tabs = two phones.
 */
function getTabPhoneId(): string {
  const KEY = 'ranttern.phoneId';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
      id = `p-${rnd}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'p-default';
  }
}

/**
 * Round icon button with a label below. Active buttons get a colored ring,
 * tinted fill and a glowing dot; hover lifts the button slightly.
 */
function RailButton(props: {
  active: boolean; color?: string; label: string; title?: string;
  disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const { active, color = '#00d4ff', label, title, disabled, onClick, children } = props;
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 46, height: 46, borderRadius: '50%',
          cursor: disabled ? 'default' : 'pointer',
          border: `1px solid ${active ? color : hover ? '#475569' : '#334155'}`,
          background: active
            ? `radial-gradient(circle at 32% 28%, ${color}33 0%, ${color}14 70%)`
            : hover ? '#1a2332' : '#111827',
          color: active ? color : hover ? '#cbd5e1' : '#94a3b8',
          fontSize: 17,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: active ? `0 0 14px ${color}40` : hover ? '0 4px 10px rgba(0,0,0,0.3)' : 'none',
          transform: hover && !disabled ? 'translateY(-2px)' : 'none',
          transition: 'all 0.18s ease',
        }}
      >
        {children}
      </button>
      <span style={{ color: active ? color : '#64748b', fontSize: 10, fontWeight: active ? 600 : 400, textAlign: 'center', width: 74, transition: 'color 0.18s ease' }}>
        {label}
      </span>
    </div>
  );
}

export default function PhoneDialerPanel() {
  const phoneId = useMemo(getTabPhoneId, []);
  const { state, defaults, busy, txActive, rxActive, toggleAirplane, dial, hangup, answer, reject, ping, sendTraffic } = usePhone(phoneId);

  const [sim, setSim] = useState<PhoneSimConfig>({});
  // Rail panels are mutually exclusive: only one button can be selected
  // at a time (the airplane toggle stays independent). The SIM panel opens
  // by default so credentials/addresses are visible before the first attach.
  const [openPanel, setOpenPanel] = useState<'sim' | 'pdu' | 'probe' | 'traffic' | null>('sim');
  const togglePanel = (p: 'sim' | 'pdu' | 'probe' | 'traffic') =>
    setOpenPanel(prev => (prev === p ? null : p));
  const [pingResult, setPingResult] = useState<string>('');
  const [pinging, setPinging] = useState(false);
  const [sending, setSending] = useState(false);

  // Live UL/DL rates: diff consecutive traffic snapshots (1 per second)
  const prevSnap = useRef<{ ts: number; traffic: Record<string, PhoneTrafficCounters> }>(
    { ts: 0, traffic: {} },
  );
  const rates: Record<string, { ul: number; dl: number }> = {};
  {
    const nowTs = Date.now();
    const prev = prevSnap.current;
    const dt = (nowTs - prev.ts) / 1000;
    if (dt > 0.2) {
      for (const [name, c] of Object.entries(state.traffic || {})) {
        const p = prev.traffic[name];
        if (p) {
          rates[name] = {
            ul: Math.max(0, (c.tx_packets - p.tx_packets) / dt),
            dl: Math.max(0, (c.rx_packets - p.rx_packets) / dt),
          };
        }
      }
      prevSnap.current = { ts: nowTs, traffic: state.traffic || {} };
    }
  }

  // Core-network (topology) status: the phone can only attach when the core
  // is deployed & running; the banner below points to the Core Network page.
  const [coreName, setCoreName] = useState('');
  const [coreRunning, setCoreRunning] = useState(0);
  const [coreTotal, setCoreTotal] = useState(0);
  const [coreChecked, setCoreChecked] = useState(false);

  // Prefill SIM panel from profile defaults once
  useEffect(() => {
    if (defaults.imsi) setSim(prev => ({ ...defaults, ...prev }));
  }, [defaults]);

  // Poll topology status so the user knows whether the core is up
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const lt = await listTopologies();
        const all: any[] = lt?.data?.topologies || [];
        const pick = all.find(t => /vonr/i.test(t?.name)) || all[0];
        if (!pick?.name) {
          if (!stop) { setCoreName(''); setCoreTotal(0); setCoreRunning(0); setCoreChecked(true); }
          return;
        }
        const st = await getTopologyStatus(pick.name);
        const cs: any[] = st?.data?.containers || [];
        if (!stop) {
          setCoreName(pick.name);
          setCoreTotal(cs.length);
          setCoreRunning(cs.filter(c => c.status === 'running').length);
          setCoreChecked(true);
        }
      } catch {
        if (!stop) setCoreChecked(true);
      }
    };
    check();
    const t = window.setInterval(check, 5000);
    return () => { stop = true; window.clearInterval(t); };
  }, []);

  const attached = state.phase === 'attached' || state.phase === 'ims_registered';
  const coreUp = coreTotal > 0 && coreRunning > 0;

  const handleAirplane = async (enabled: boolean) => {
    try {
      if (enabled) {
        await toggleAirplane(true);
        message.success('Airplane mode ON — deregistering');
      } else {
        await toggleAirplane(false, sim);
        message.info('Airplane mode OFF — attaching…');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || String(e));
    }
  };

  const handlePing = async () => {
    setPinging(true);
    setPingResult('…');
    try {
      const r = await ping('8.8.8.8');
      setPingResult(r.ok ? `OK — ${r.rtt_ms} ms` : `FAIL — ${r.error || 'no reply'}`);
      if (r.ok) message.success(`Ping OK (${r.rtt_ms} ms) via GTP-U tunnel`);
      else message.warning(`Ping failed: ${r.error || 'no reply'}`);
    } catch (e: any) {
      setPingResult('ERROR');
      message.error(String(e));
    } finally {
      setPinging(false);
    }
  };

  const handleSendTraffic = async () => {
    setSending(true);
    try {
      const r = await sendTraffic(20, '8.8.8.8');
      if (r.ok) message.success(`Sent ${r.sent} uplink UDP packets via GTP-U tunnel`);
      else message.warning(`Traffic send failed: ${r.error || 'no data session'}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {/* Core-network status banner: tells the user where to start the core */}
      <div
        style={{
          ...cardStyle,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderColor: !coreChecked ? '#1e293b' : coreUp ? '#14532d' : '#b45309',
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: !coreChecked ? '#475569' : coreUp ? '#4ade80' : '#f59e0b',
          }}
        />
        <div style={{ flex: 1, fontSize: 12, color: !coreChecked ? '#94a3b8' : coreUp ? '#86efac' : '#fbbf24' }}>
          {!coreChecked
            ? 'Checking core network status…'
            : coreUp
              ? `Core network ${coreName} running (${coreRunning}/${coreTotal} containers) — switch airplane mode OFF to attach.`
              : `Core network not running — deploy / start the topology${coreName ? ` ${coreName}` : ''} on the Core Network page, then switch airplane mode OFF.`}
        </div>
        {!coreUp && (
          <Link to="/core-network">
            <button
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: '1px solid #1e293b', background: '#0e2438', color: '#7dd3fc',
              }}
            >
              Go to Core Network
            </button>
          </Link>
        )}
      </div>

      {/* Multi-phone hint: each tab is an independent phone */}
      <div style={{ marginBottom: 16, color: '#64748b', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
        Each browser tab runs its own independent phone — open this page in a second tab and dial
        between the two numbers (shown in the SIM panel) to test a mutual VoNR call.
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Phone + icon rail */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <PhoneFrame state={state} txActive={txActive} rxActive={rxActive} onDial={dial} onHangup={hangup} onAnswer={answer} onReject={reject} />

          {/* icon rail: airplane toggle, divider, grouped panel openers */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 16, marginTop: 12, padding: '16px 10px',
              background: 'linear-gradient(160deg, rgba(20, 27, 45, 0.85) 0%, rgba(13, 17, 23, 0.7) 100%)',
              border: '1px solid #1e293b', borderRadius: 28,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
            }}
          >
            <RailButton
              active={state.airplane}
              color="#f59e0b"
              label={state.airplane ? 'Airplane' : state.phase === 'attaching' ? 'Attaching' : 'Online'}
              title={state.airplane ? 'Airplane mode ON — click to attach' : 'Airplane mode OFF — click to detach'}
              disabled={busy}
              onClick={() => handleAirplane(!state.airplane)}
            >
              ✈
            </RailButton>

            <div style={{ width: 34, height: 1, background: 'linear-gradient(90deg, transparent, #334155, transparent)' }} />

            <RailButton
              active={openPanel === 'sim'}
              label="SIM"
              title="SIM settings"
              onClick={() => togglePanel('sim')}
            >
              <IdcardOutlined />
            </RailButton>
            <RailButton
              active={openPanel === 'pdu'}
              label="PDU"
              title="PDU sessions"
              onClick={() => togglePanel('pdu')}
            >
              <NodeIndexOutlined />
            </RailButton>
            <RailButton
              active={openPanel === 'probe'}
              label="Ping"
              title="Connectivity probe"
              onClick={() => togglePanel('probe')}
            >
              <SendOutlined />
            </RailButton>
            <RailButton
              active={openPanel === 'traffic'}
              label="Traffic"
              title="Uplink/downlink packet traffic"
              onClick={() => togglePanel('traffic')}
            >
              <LineChartOutlined />
            </RailButton>
          </div>
        </div>

        {/* Right column: panels opened from the icon rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {openPanel === 'sim' && (
            <SimPanel
              value={sim}
              onChange={setSim}
              expanded
              onToggle={() => setOpenPanel(null)}
              // Always editable — even mid-attach — so a wrong core address
              // can be corrected and re-applied (values take effect the next
              // time airplane mode is switched OFF).
              profile={defaults.profile}
            />
          )}

          {/* Session info */}
          {openPanel === 'pdu' && (
          <div style={cardStyle}>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>PDU Sessions</div>
            {attached ? (
              <>
                {(['internet', 'ims'] as const).map(dnn => {
                  const s = state.session[dnn];
                  if (!s) return null;
                  return (
                    <div key={dnn} style={{ marginBottom: 6 }}>
                      <div style={{ color: '#00d4ff', fontSize: 11, fontWeight: 700 }}>{dnn}</div>
                      <div style={kvRow}><span style={{ color: '#64748b' }}>UE IP</span><span style={{ color: '#e2e8f0' }}>{s.ip}</span></div>
                      <div style={kvRow}><span style={{ color: '#64748b' }}>GTP TEID</span><span style={{ color: '#e2e8f0' }}>{s.teid}</span></div>
                    </div>
                  );
                })}
                <div style={kvRow}>
                  <span style={{ color: '#64748b' }}>IMS REGISTER</span>
                  <span style={{ color: state.sip_state === 'registered' ? '#4ade80' : state.sip_state === 'failed' ? '#ef4444' : '#94a3b8' }}>
                    {state.sip_state}
                  </span>
                </div>
                <div style={kvRow}>
                  <span style={{ color: '#64748b' }}>REG EVENT (SUBSCRIBE/NOTIFY)</span>
                  <span style={{ color: state.sub_state === 'active' ? '#4ade80' : state.sub_state === 'failed' || state.sub_state === 'terminated' ? '#ef4444' : '#94a3b8' }}>
                    {state.sub_state || 'none'}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ color: '#475569', fontSize: 11.5 }}>
                {state.airplane ? 'Airplane mode — no sessions' : state.phase === 'error' ? state.error : 'Waiting for attach…'}
              </div>
            )}
          </div>
          )}

          {/* Connectivity probe */}
          {openPanel === 'probe' && (
          <div style={cardStyle}>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Connectivity Probe</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={handlePing}
                disabled={!attached || pinging}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: attached && !pinging ? 'pointer' : 'default',
                  border: '1px solid #1e293b',
                  background: attached ? '#0e2438' : '#0d1424',
                  color: attached ? '#7dd3fc' : '#475569',
                }}
              >
                {pinging ? 'ping…' : 'ping 8.8.8.8'}
              </button>
              <span style={{ color: pingResult.startsWith('OK') ? '#4ade80' : pingResult.startsWith('FAIL') ? '#ef4444' : '#64748b', fontSize: 11.5, fontFamily: 'Consolas, monospace' }}>
                {pingResult}
              </span>
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 6 }}>
              ICMP echo leaves the phone through the internet GTP-U tunnel (UE IP → UPF → out).
            </div>
          </div>
          )}

          {/* Uplink/downlink traffic: send packets + live counters */}
          {openPanel === 'traffic' && (
          <div style={cardStyle}>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Data Traffic</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button
                onClick={handleSendTraffic}
                disabled={!attached || sending}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: attached && !sending ? 'pointer' : 'default',
                  border: '1px solid #1e293b',
                  background: attached ? '#0e2438' : '#0d1424',
                  color: attached ? '#7dd3fc' : '#475569',
                }}
              >
                {sending ? 'sending…' : 'send 20 UL packets'}
              </button>
              <span style={{ color: '#64748b', fontSize: 10.5 }}>UDP burst UE → UPF (internet tunnel)</span>
            </div>
            {attached && Object.keys(state.traffic || {}).length > 0 ? (
              (['internet', 'ims'] as const).map(dnn => {
                const c = state.traffic[dnn];
                if (!c) return null;
                const r = rates[dnn];
                const nowSec = Date.now() / 1000;
                const ulActive = nowSec - c.last_tx < 2;
                const dlActive = nowSec - c.last_rx < 2;
                return (
                  <div key={dnn} style={{ marginBottom: 6 }}>
                    <div style={{ color: '#00d4ff', fontSize: 11, fontWeight: 700 }}>{dnn}</div>
                    <div style={kvRow}>
                      <span style={{ color: '#64748b' }}>▲ UL</span>
                      <span style={{ color: ulActive ? '#4ade80' : '#e2e8f0' }}>
                        {c.tx_packets} pkts · {fmtBytes(c.tx_bytes)}{r ? ` · ${r.ul.toFixed(0)} pps` : ''}
                      </span>
                    </div>
                    <div style={kvRow}>
                      <span style={{ color: '#64748b' }}>▼ DL</span>
                      <span style={{ color: dlActive ? '#4ade80' : '#e2e8f0' }}>
                        {c.rx_packets} pkts · {fmtBytes(c.rx_bytes)}{r ? ` · ${r.dl.toFixed(0)} pps` : ''}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: '#475569', fontSize: 11.5 }}>
                {state.airplane ? 'Airplane mode — no tunnels' : 'Waiting for PDU sessions…'}
              </div>
            )}
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 6 }}>
              Counters stream live every second; ▲/▼ turn green while traffic is flowing.
              Ping produces a downlink reply, the UDP burst counts as uplink.
            </div>
          </div>
          )}

          {!openPanel && (
            <div style={{ ...cardStyle, maxWidth: 360, color: '#475569', fontSize: 11.5 }}>
              All panels are closed — use the round buttons next to the phone to
              open SIM settings, PDU sessions, the connectivity probe or data traffic.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
