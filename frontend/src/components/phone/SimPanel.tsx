/**
 * SimPanel — collapsible "SIM Settings" card beside the phone.
 * Prefilled from GET /api/phone/defaults (active profile); every field can
 * override the core address / MCC / MNC / P-CSCF / UPF before attach.
 */
import { DownOutlined, IdcardOutlined, RightOutlined } from '@ant-design/icons';
import type { PhoneSimConfig } from '../../services/api';

interface SimPanelProps {
  value: PhoneSimConfig;
  onChange: (v: PhoneSimConfig) => void;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  profile?: string;
}

const FIELDS: { key: keyof PhoneSimConfig; label: string; hint?: string; mono?: boolean }[] = [
  { key: 'imsi', label: 'IMSI' },
  { key: 'ki', label: 'Ki (K)' },
  { key: 'opc', label: 'OPc' },
  { key: 'msisdn', label: 'MSISDN' },
  { key: 'mcc', label: 'MCC' },
  { key: 'mnc', label: 'MNC' },
  { key: 'core_address', label: 'Core (AMF)', hint: 'AMF SCTP target' },
  { key: 'pcscf_address', label: 'P-CSCF', hint: 'SIP registrar entry' },
  { key: 'upf_address', label: 'UPF N3', hint: 'GTP-U peer' },
  { key: 'gnb_address', label: 'gNB IP', hint: 'local SCTP bind' },
  { key: 'sip_password', label: 'SIP Password', hint: 'optional; auto-tries Ki/OPc/IMSI/MSISDN' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0d1424',
  border: '1px solid #1e293b',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  padding: '5px 8px',
  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
  outline: 'none',
};

export default function SimPanel({ value, onChange, expanded, onToggle, disabled, profile }: SimPanelProps) {
  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid #1e293b',
        borderRadius: 10,
        width: 320,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
          background: '#151d2e',
        }}
      >
        <IdcardOutlined style={{ color: '#00d4ff' }} />
        <span style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 600, flex: 1 }}>SIM Settings</span>
        {profile && <span style={{ color: '#64748b', fontSize: 11 }}>profile: {profile}</span>}
        {expanded ? <DownOutlined style={{ color: '#64748b', fontSize: 11 }} />
          : <RightOutlined style={{ color: '#64748b', fontSize: 11 }} />}
      </div>

      {expanded && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {FIELDS.map(f => (
            <div key={f.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>{f.label}</span>
                {f.hint && <span style={{ color: '#475569', fontSize: 10 }}>{f.hint}</span>}
              </div>
              <input
                style={inputStyle}
                value={(value[f.key] as string) || ''}
                disabled={disabled}
                onChange={e => onChange({ ...value, [f.key]: e.target.value })}
                spellCheck={false}
              />
            </div>
          ))}
          <div style={{ color: '#475569', fontSize: 10.5, lineHeight: 1.5, marginTop: 2 }}>
            Applied when airplane mode is switched OFF. Values are prefilled from
            the active profile; P-CSCF / UPF default to the core address
            (docker_open5gs single-host layout).
          </div>
        </div>
      )}
    </div>
  );
}
