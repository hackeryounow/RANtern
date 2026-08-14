/**
 * PhoneFrame — the device itself: rounded frame, dark home screen,
 * lock-screen-style clock, attach progress, in-screen dialer.
 */
import { useEffect, useState } from 'react';
import type { PhoneState } from '../../hooks/usePhone';
import StatusBar from './StatusBar';
import PhoneDialer from './PhoneDialer';

interface PhoneFrameProps {
  state: PhoneState;
  txActive: boolean;
  rxActive: boolean;
  onDial: (callee: string) => Promise<void>;
  onHangup: () => Promise<void>;
  onAnswer: () => Promise<void>;
  onReject: () => Promise<void>;
}

const STEP_LABELS: Record<string, string> = {
  gnb: 'gNB setup',
  ngap: 'NGSetup → AMF',
  nas: '5G Registration',
  pdu_internet: 'PDU · internet',
  pdu_ims: 'PDU · ims',
  sip: 'IMS REGISTER',
};

function stepIcon(status: string) {
  if (status === 'done') return <span style={{ color: '#4ade80' }}>✓</span>;
  if (status === 'failed') return <span style={{ color: '#ef4444' }}>✗</span>;
  return <span style={{ color: '#00d4ff', display: 'inline-block', animation: 'spin 1s linear infinite' }}>◌</span>;
}

export default function PhoneFrame({ state, txActive, rxActive, onDial, onHangup, onAnswer, onReject }: PhoneFrameProps) {
  const [now, setNow] = useState(new Date());
  const [dialerOpen, setDialerOpen] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 5000);
    return () => window.clearInterval(t);
  }, []);

  // Incoming call: bring up the dialer so the answer/decline screen shows
  useEffect(() => {
    if (state.call_state === 'incoming') setDialerOpen(true);
  }, [state.call_state]);

  const attached = !!state.session?.internet || state.phase === 'attached' || state.phase === 'ims_registered';
  const imsRegistered = state.sip_state === 'registered';
  const attaching = state.phase === 'attaching';
  const steps = state.attach_progress.filter(s => STEP_LABELS[s.step] || s.step === 'error');

  const phaseText =
    state.airplane ? 'Airplane mode' :
    state.phase === 'error' ? (state.error || 'Attach failed') :
    attaching ? 'Attaching to network…' :
    state.phase === 'detaching' ? 'Detaching…' :
    imsRegistered ? 'IMS registered · VoNR ready' :
    attached ? '5G connected' :
    'No service';

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div
      style={{
        width: 310,
        height: 640,
        borderRadius: 42,
        background: '#1c2431',
        padding: 10,
        boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 0 0 2px #2b3648',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Screen */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 34,
          overflow: 'hidden',
          background: 'linear-gradient(170deg, #0b1220 0%, #101a2c 55%, #0c1526 100%)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* punch-hole camera */}
        <div
          style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            width: 10, height: 10, borderRadius: '50%', background: '#000',
            border: '1px solid #1e293b', zIndex: 5,
          }}
        />

        <StatusBar
          airplane={state.airplane}
          attached={attached}
          imsRegistered={imsRegistered}
          txActive={txActive}
          rxActive={rxActive}
          time={now}
        />

        {dialerOpen ? (
          <PhoneDialer
            state={state}
            onDial={onDial}
            onHangup={onHangup}
            onAnswer={onAnswer}
            onReject={onReject}
            onClose={() => setDialerOpen(false)}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 22px' }}>
            {/* lock-screen clock */}
            <div style={{ marginTop: 46, textAlign: 'center', userSelect: 'none' }}>
              <div style={{ fontSize: 12, color: '#64748b', letterSpacing: 1 }}>{dateStr}</div>
              <div
                style={{
                  fontSize: 56, fontWeight: 200, color: '#f0f4ff', lineHeight: 1.1,
                  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                }}
              >
                {hh}:{mm}
              </div>
              <div
                style={{
                  marginTop: 10, fontSize: 11,
                  color: state.phase === 'error' ? '#ef4444' : attaching ? '#00d4ff' : '#94a3b8',
                }}
              >
                {phaseText}
              </div>
            </div>

            {/* attach progress toasts */}
            {(attaching || steps.length > 0) && !state.airplane && (
              <div
                style={{
                  marginTop: 18, alignSelf: 'center', minWidth: 200,
                  background: 'rgba(15, 23, 42, 0.75)', border: '1px solid #1e293b',
                  borderRadius: 10, padding: '8px 12px', backdropFilter: 'blur(4px)',
                }}
              >
                {steps.map(s => (
                  <div
                    key={s.step}
                    style={{
                      display: 'flex', gap: 8, alignItems: 'center',
                      fontSize: 10.5, color: '#cbd5e1', padding: '2.5px 0',
                      fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                    }}
                  >
                    <span style={{ width: 12, textAlign: 'center' }}>{stepIcon(s.status)}</span>
                    <span style={{ width: 100 }}>{STEP_LABELS[s.step] || s.step}</span>
                    <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.detail || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* dock: dialer icon */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 26 }}>
              <button
                onClick={() => setDialerOpen(true)}
                style={{
                  width: 52, height: 52, borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: imsRegistered ? 'linear-gradient(135deg,#22c55e,#15803d)' : '#334155',
                  color: '#fff', fontSize: 22,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                }}
                title="Dialer"
              >
                ✆
              </button>
            </div>
          </div>
        )}

        {/* home indicator */}
        <div
          style={{
            position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)',
            width: 100, height: 4, borderRadius: 2, background: 'rgba(226,232,240,0.35)',
          }}
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
