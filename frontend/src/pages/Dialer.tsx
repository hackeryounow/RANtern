/**
 * Dialer — unified dialing page.
 *
 * Merges the two dialing features behind a segmented mode switch:
 *   · SIP   — browser SIP softphone (Asterisk / WebSocket, real audio)
 *   · Phone — simulated 5G phone (NGAP/NAS attach + IMS VoNR dialing)
 *
 * The mode is carried in the URL (?mode=phone) so nav links and the
 * legacy /phone route can deep-link straight to the phone dialer.
 */
import { Segmented } from 'antd';
import { MobileOutlined, PhoneOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import SipDialerPanel from '../components/dialer/SipDialerPanel';
import PhoneDialerPanel from '../components/dialer/PhoneDialerPanel';

type DialMode = 'sip' | 'phone';

export default function Dialer() {
  const [params, setParams] = useSearchParams();
  const mode: DialMode = params.get('mode') === 'phone' ? 'phone' : 'sip';

  const switchMode = (m: DialMode) => {
    // Keep a clean URL for the default mode
    setParams(m === 'sip' ? {} : { mode: m }, { replace: true });
  };

  return (
    <div>
      {/* Page header with the mode switch */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, marginBottom: 18, flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 className="fx-page-title" style={{ fontSize: 18, marginBottom: 4, paddingBottom: 8 }}>Dialer</h2>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {mode === 'sip'
              ? 'Browser SIP softphone — WebSocket registration to Asterisk PBX, live RTP audio'
              : 'Simulated 5G phone — real attach (NGAP/NAS), GTP-U user plane, IMS VoNR calls'}
          </div>
        </div>
        <Segmented
          value={mode}
          onChange={v => switchMode(v as DialMode)}
          options={[
            { label: 'SIP Dialer', value: 'sip', icon: <PhoneOutlined /> },
            { label: 'Phone', value: 'phone', icon: <MobileOutlined /> },
          ]}
          style={{
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: 10,
            padding: 3,
          }}
        />
      </div>

      {mode === 'sip' ? <SipDialerPanel /> : <PhoneDialerPanel />}
    </div>
  );
}
