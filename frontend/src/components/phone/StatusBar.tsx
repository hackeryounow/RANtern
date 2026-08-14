/**
 * StatusBar — the phone's top status bar (mobilegym style).
 *
 * Airplane mode: airplane icon only. Attached: signal bars + 5G badge +
 * animated up/down arrows while traffic flows + HD icon once SIP REGISTER
 * succeeded. Before attach: "no service".
 */

interface StatusBarProps {
  airplane: boolean;
  attached: boolean;            // PDU sessions established
  imsRegistered: boolean;       // SIP REGISTER accepted -> HD
  txActive: boolean;
  rxActive: boolean;
  time: Date;
}

const iconColor = '#e2e8f0';
const dimColor = '#475569';

function AirplaneIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={iconColor}>
      <path d="M21.5 15.5v-2l-8.5-5V3.2a1.2 1.2 0 0 0-2.4 0v5.3l-8.5 5v2l8.5-2.6v5.4l-2.3 1.7v1.5l3.5-1 3.5 1v-1.5l-2.3-1.7v-5.4l8.5 2.6z" />
    </svg>
  );
}

function SignalBars() {
  const bars = [4, 6, 8, 10];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 11 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 1,
            background: iconColor,
          }}
        />
      ))}
    </div>
  );
}

function Arrow({ dir, active }: { dir: 'up' | 'down'; active: boolean }) {
  return (
    <svg width={6} height={6} viewBox="0 0 10 10" style={{ opacity: active ? 1 : 0.3 }}>
      <path
        d={dir === 'up' ? 'M5 0 L9 6 L1 6 Z' : 'M5 10 L9 4 L1 4 Z'}
        fill={active ? '#4ade80' : dimColor}
      />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <div
        style={{
          width: 18,
          height: 9,
          border: `1px solid ${iconColor}`,
          borderRadius: 2,
          padding: 1,
        }}
      >
        <div style={{ width: '72%', height: '100%', background: iconColor, borderRadius: 1 }} />
      </div>
      <div style={{ width: 1.5, height: 4, background: iconColor, borderRadius: 1 }} />
    </div>
  );
}

export default function StatusBar({ airplane, attached, imsRegistered, txActive, rxActive, time }: StatusBarProps) {
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 18px 2px',
        fontSize: 11,
        color: iconColor,
        fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
        userSelect: 'none',
      }}
    >
      <div style={{ fontWeight: 600 }}>{hh}:{mm}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {airplane ? (
          <AirplaneIcon />
        ) : attached ? (
          <>
            {/* compact UL/DL markers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Arrow dir="up" active={txActive} />
              <Arrow dir="down" active={rxActive} />
            </div>
            {imsRegistered && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  border: `1px solid #4ade80`,
                  color: '#4ade80',
                  borderRadius: 3,
                  padding: '0 3px',
                  lineHeight: '12px',
                }}
              >
                HD
              </span>
            )}
            <SignalBars />
            <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>5G</span>
          </>
        ) : (
          <span style={{ color: dimColor, fontSize: 10 }}>No Service</span>
        )}
        <BatteryIcon />
      </div>
    </div>
  );
}
