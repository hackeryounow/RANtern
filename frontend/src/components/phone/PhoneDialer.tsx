/**
 * PhoneDialer — in-screen dialer for the simulated phone.
 *
 * Keypad (phone-style with letter labels) -> dial (IMS INVITE through the
 * backend) -> ringing -> connected (timer) -> "Call ended" -> back to the
 * keypad. Recent numbers are kept in localStorage and offered for re-dial.
 * Audio is simulated: a local ringback tone only.
 */
import { useEffect, useRef, useState } from 'react';
import type { PhoneState } from '../../hooks/usePhone';

interface PhoneDialerProps {
  state: PhoneState;
  onDial: (callee: string) => Promise<void>;
  onHangup: () => Promise<void>;
  onAnswer: () => Promise<void>;
  onReject: () => Promise<void>;
  onClose: () => void;
}

// digit -> letter label, like a real handset keypad
const KEYS: { d: string; letters: string }[] = [
  { d: '1', letters: '' },
  { d: '2', letters: 'ABC' },
  { d: '3', letters: 'DEF' },
  { d: '4', letters: 'GHI' },
  { d: '5', letters: 'JKL' },
  { d: '6', letters: 'MNO' },
  { d: '7', letters: 'PQRS' },
  { d: '8', letters: 'TUV' },
  { d: '9', letters: 'WXYZ' },
  { d: '*', letters: '' },
  { d: '0', letters: '+' },
  { d: '#', letters: '' },
];

const HISTORY_KEY = 'rantern.dial-history';
const HISTORY_MAX = 12;

interface HistoryEntry {
  number: string;
  ts: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(e => e && typeof e.number === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* storage unavailable */
  }
}

function useRingback(active: boolean) {
  const ctxRef = useRef<{ ctx: AudioContext; gain: GainNode; osc: OscillatorNode; timer: number } | null>(null);

  useEffect(() => {
    if (active && !ctxRef.current) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 425;
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        // cadence: 1s on / 4s off
        let on = true;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        const timer = window.setInterval(() => {
          on = !on;
          gain.gain.setValueAtTime(on ? 0.08 : 0, ctx.currentTime);
        }, on ? 1000 : 4000);
        ctxRef.current = { ctx, gain, osc, timer };
      } catch {
        /* audio unavailable */
      }
    }
    if (!active && ctxRef.current) {
      const { ctx, osc, timer } = ctxRef.current;
      window.clearInterval(timer);
      osc.stop();
      ctx.close();
      ctxRef.current = null;
    }
  }, [active]);

  useEffect(() => () => {
    if (ctxRef.current) {
      const { ctx, osc, timer } = ctxRef.current;
      window.clearInterval(timer);
      try { osc.stop(); ctx.close(); } catch { /* noop */ }
    }
  }, []);
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function fmtWhen(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

// Classic handset glyph — upright for "answer", rotated for "hang up"
function HandsetIcon({ size = 26, rotate = 0 }: { size?: number; rotate?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}
    >
      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.4 11.4 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .57 3.57 1 1 0 0 1-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

export default function PhoneDialer({ state, onDial, onHangup, onAnswer, onReject, onClose }: PhoneDialerProps) {
  const [number, setNumber] = useState('');
  const [callStart, setCallStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  // Briefly show the "Call ended" screen, then return to the keypad
  const [showEnded, setShowEnded] = useState(false);
  const prevCallState = useRef(state.call_state);

  const inCall = state.call_state === 'calling' || state.call_state === 'ringing' || state.call_state === 'connected';
  const incoming = state.call_state === 'incoming';
  useRingback(state.call_state === 'calling' || state.call_state === 'ringing' || incoming);

  // Call timer
  useEffect(() => {
    if (state.call_state === 'connected' && callStart === null) {
      setCallStart(Date.now());
    }
    if (!inCall && state.call_state !== 'ended') {
      setCallStart(null);
      setElapsed(0);
    }
  }, [state.call_state, inCall, callStart]);

  useEffect(() => {
    if (callStart === null) return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - callStart) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [callStart]);

  // On the transition into 'ended': clear the number and show the
  // "Call ended" screen for a moment, then fall back to the keypad
  useEffect(() => {
    if (prevCallState.current !== state.call_state) {
      if (state.call_state === 'ended' && prevCallState.current !== 'idle') {
        setNumber('');
        setShowEnded(true);
        setCallStart(null);
        const t = window.setTimeout(() => setShowEnded(false), 1600);
        return () => window.clearTimeout(t);
      }
      prevCallState.current = state.call_state;
    }
  }, [state.call_state]);

  // call_peer is a SIP/tel URI — show just the dialed number part
  const peerDisplay = state.call_peer
    ? state.call_peer.replace(/^sips?:|^tel:/, '').split(';')[0].split('@')[0]
    : number;

  const statusText =
    state.call_state === 'calling' ? 'Calling…' :
    state.call_state === 'ringing' ? 'Ringing…' :
    state.call_state === 'connected' ? fmtDuration(elapsed) :
    showEnded ? (state.call_end_reason || 'Call ended') : '';

  const dial = async (target: string) => {
    if (!target || state.sip_state !== 'registered') return;
    const entry: HistoryEntry = { number: target, ts: Date.now() };
    const next = [entry, ...history.filter(h => h.number !== target)].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
    await onDial(target);
  };

  if (incoming) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '52px 20px 34px' }}>
        {/* pulsing caller avatar */}
        <div style={{ position: 'relative', width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(34, 197, 94, 0.22)', animation: 'phonePulse 1.6s ease-out infinite' }} />
          <div
            style={{
              width: 68, height: 68, borderRadius: '50%',
              background: 'linear-gradient(135deg, #1e3a5f, #0e2438)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, color: '#7dd3fc', border: '1px solid #334155',
              position: 'relative',
            }}
          >
            {peerDisplay ? peerDisplay.replace('+', '').slice(0, 2) : '?'}
          </div>
        </div>
        <div style={{ marginTop: 18, fontSize: 22, color: '#f0f4ff', fontWeight: 500, letterSpacing: 1 }}>
          {peerDisplay || 'Unknown'}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#4ade80', animation: 'phoneBlink 1.2s ease-in-out infinite' }}>
          Incoming call…
        </div>
        <div style={{ flex: 1 }} />
        {/* Decline / Answer — answer is a green handset button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => onReject()}
              style={{
                width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: '#ef4444', color: '#fff', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
              }}
              title="Decline"
            >
              <HandsetIcon rotate={135} />
            </button>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>Decline</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => onAnswer()}
              style={{
                width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #22c55e, #15803d)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(34, 197, 94, 0.5)',
                animation: 'phonePulse 1.6s ease-out infinite',
              }}
              title="Answer"
            >
              <HandsetIcon />
            </button>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>Answer</span>
          </div>
        </div>
        <style>{`
          @keyframes phonePulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.45); } 100% { box-shadow: 0 0 0 14px rgba(34,197,94,0); } }
          @keyframes phoneBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        `}</style>
      </div>
    );
  }

  if (inCall || showEnded) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px 28px' }}>
        <div
          style={{
            width: 68, height: 68, borderRadius: '50%',
            background: 'linear-gradient(135deg, #1e3a5f, #0e2438)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, color: '#7dd3fc', border: '1px solid #334155',
          }}
        >
          {peerDisplay ? peerDisplay.replace('+', '').slice(0, 2) : '?'}
        </div>
        <div style={{ marginTop: 16, fontSize: 22, color: '#f0f4ff', fontWeight: 500, letterSpacing: 1 }}>
          {peerDisplay || '—'}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#64748b', minHeight: 18 }}>{statusText}</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={showEnded && !inCall ? () => setShowEnded(false) : () => onHangup()}
          style={{
            width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: inCall ? '#ef4444' : '#334155',
            color: '#fff', fontSize: 22,
            boxShadow: inCall ? '0 4px 14px rgba(239, 68, 68, 0.35)' : 'none',
          }}
          title={inCall ? 'Hang up' : 'Dismiss'}
        >
          ⬇
        </button>
      </div>
    );
  }

  const registered = state.sip_state === 'registered';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px 26px 18px' }}>
      {/* number display */}
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 48, marginTop: 6 }}>
        <input
          value={number}
          onChange={e => setNumber(e.target.value.replace(/[^\d*#+]/g, ''))}
          onKeyDown={e => {
            if (e.key === 'Enter' && number && registered) { e.preventDefault(); dial(number); }
          }}
          placeholder="Enter number"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#f0f4ff', fontSize: number.length > 13 ? 20 : 26, textAlign: 'center',
            letterSpacing: 1.5,
            fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
          }}
        />
        <span
          onClick={() => setNumber(number.slice(0, -1))}
          style={{
            cursor: number ? 'pointer' : 'default', color: number ? '#94a3b8' : 'transparent',
            fontSize: 18, padding: '0 6px', userSelect: 'none',
          }}
          title="Delete digit"
        >
          ⌫
        </span>
      </div>

      {/* recent numbers — shown while the input is empty */}
      {!number && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '2px 0 6px' }}>
          {history.length > 0 ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 4px' }}>
                <span style={{ fontSize: 11, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase' }}>Recent</span>
                <span
                  onClick={() => { setHistory([]); saveHistory([]); }}
                  style={{ fontSize: 10, color: '#475569', cursor: 'pointer' }}
                >
                  Clear
                </span>
              </div>
              {history.map(h => (
                <div
                  key={`${h.number}-${h.ts}`}
                  onClick={() => dial(h.number)}
                  title={`Call ${h.number}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px',
                    borderRadius: 8, cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: '#22c55e', fontSize: 13 }}>✆</span>
                  <span style={{ flex: 1, color: '#e2e8f0', fontSize: 14, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
                    {h.number}
                  </span>
                  <span style={{ color: '#475569', fontSize: 10 }}>{fmtWhen(h.ts)}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', marginTop: 18 }}>
              No recent calls
            </div>
          )}
        </div>
      )}
      {!!number && <div style={{ flex: 1 }} />}

      {/* keypad — handset style: round keys, digit + letter labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: '10px 26px', justifyContent: 'center' }}>
        {KEYS.map(k => (
          <button
            key={k.d}
            onClick={() => setNumber(n => n + k.d)}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(226, 232, 240, 0.09)', color: '#f0f4ff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(226, 232, 240, 0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(226, 232, 240, 0.09)')}
          >
            <span style={{ fontSize: 24, lineHeight: 1.05, fontWeight: 400 }}>{k.d}</span>
            <span style={{ fontSize: 8.5, letterSpacing: 1.5, color: '#64748b', minHeight: 10 }}>{k.letters}</span>
          </button>
        ))}
      </div>

      {/* action row: close / call */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 44, marginTop: 14 }}>
        <button
          onClick={onClose}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: '1px solid #334155',
            background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13,
          }}
          title="Close dialer"
        >
          ✕
        </button>
        <button
          onClick={() => dial(number)}
          disabled={!number || !registered}
          style={{
            width: 62, height: 62, borderRadius: '50%', border: 'none',
            cursor: number && registered ? 'pointer' : 'default',
            background: registered ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#334155',
            color: '#fff', fontSize: 24,
            opacity: number && registered ? 1 : 0.5,
            boxShadow: number && registered ? '0 4px 14px rgba(34, 197, 94, 0.35)' : 'none',
          }}
          title={registered ? 'Call' : 'IMS not registered'}
        >
          ✆
        </button>
        <span style={{ width: 44 }} />
      </div>
      {!registered && (
        <div style={{ textAlign: 'center', fontSize: 10, color: '#64748b', marginTop: 6 }}>
          IMS not registered — dialing unavailable
        </div>
      )}
    </div>
  );
}
