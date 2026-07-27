import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, Button, Input, Tag, Row, Col, Typography, Space, Alert, Modal } from 'antd';
import {
  PhoneOutlined, PhoneFilled, CloseCircleOutlined,
  RollbackOutlined, AudioOutlined, AudioMutedOutlined,
  PauseCircleOutlined, PlayCircleOutlined,
  WifiOutlined,
  GlobalOutlined, FieldTimeOutlined, BarChartOutlined,
  UserOutlined, LockOutlined,
} from '@ant-design/icons';
import { useSip } from '../hooks/useSip';

const { Text } = Typography;

const KEYPAD_KEYS = [
  { num: '1', letters: '' },
  { num: '2', letters: 'ABC' },
  { num: '3', letters: 'DEF' },
  { num: '4', letters: 'HNI' },
  { num: '5', letters: 'JKL' },
  { num: '6', letters: 'MNO' },
  { num: '7', letters: 'PQRS' },
  { num: '8', letters: 'TUV' },
  { num: '9', letters: 'WXYZ' },
  { num: '*', letters: '' },
  { num: '0', letters: '+' },
  { num: '#', letters: '' },
];

const glassCard: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(20, 27, 45, 0.9) 0%, rgba(10, 14, 23, 0.75) 100%)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.07)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 12,
  color: '#f0f4ff',
  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
  fontSize: 13,
  transition: 'all 0.2s ease',
};

const liveDotStyle: React.CSSProperties = {
  width: 8, height: 8, borderRadius: '50%',
  background: '#52c41a',
  boxShadow: '0 0 8px #52c41a',
  animation: 'blink-live 2s ease-in-out infinite',
};

function KeypadButton({ btn, disabled, onPress }: { btn: typeof KEYPAD_KEYS[0]; disabled: boolean; onPress: (key: string) => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const nextId = useRef(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = nextId.current++;
    setRipples(prev => [...prev, { id, x, y }]);
    onPress(btn.num);
  };

  useEffect(() => {
    if (ripples.length === 0) return;
    const timer = setTimeout(() => {
      setRipples(prev => prev.slice(1));
    }, 600);
    return () => clearTimeout(timer);
  }, [ripples]);

  return (
    <button
      ref={btnRef}
      onClick={handleClick}
      disabled={disabled}
      style={{
        width: 76, height: 76, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)',
        background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 70%)',
        color: '#f0f4ff',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.25s ease', outline: 'none',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = 'radial-gradient(circle at 30% 30%, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.04) 70%)';
        e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.35)';
        e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 212, 255, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)';
        e.currentTarget.style.transform = 'scale(1.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 70%)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)';
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.92)'; }}
      onMouseUp={e => { if (!disabled) e.currentTarget.style.transform = 'scale(1.08)'; }}
    >
      {ripples.map(r => (
        <span
          key={r.id}
          style={{
            position: 'absolute', left: r.x - 20, top: r.y - 20,
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(0, 212, 255, 0.3)',
            animation: 'ripple-expand 0.6s ease-out forwards',
            pointerEvents: 'none',
          }}
        />
      ))}
      <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{btn.num}</span>
      {btn.letters && <span style={{ fontSize: 9, color: '#5a6988', marginTop: 1, letterSpacing: 1.5, fontWeight: 500 }}>{btn.letters}</span>}
    </button>
  );
}

export default function Dialer() {
  const sip = useSip();

  const [dialedNumber, setDialedNumber] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isHeld, setIsHeld] = useState(false);

  const config = sip.sipConfig;
  const setConfig = sip.setSipConfig;

  const isInCall = sip.callStatus === 'calling' || sip.callStatus === 'connected' || sip.callStatus === 'ringing' || sip.callStatus === 'incoming' || sip.callStatus === 'on-hold';

  const handleKeyPress = useCallback((key: string) => {
    setDialedNumber(prev => prev + key);
  }, []);

  const handleBackspace = useCallback(() => {
    setDialedNumber(prev => prev.slice(0, -1));
  }, []);

  const handleCall = useCallback(() => {
    if (!dialedNumber) return;
    sip.makeCall(dialedNumber);
  }, [dialedNumber, sip]);

  const handleHangup = useCallback(() => {
    sip.hangupCall();
    setIsMuted(false);
    setIsHeld(false);
  }, [sip]);

  const handleAnswer = useCallback(() => {
    sip.answerCall();
  }, [sip]);

  const handleReject = useCallback(() => {
    sip.rejectCall();
  }, [sip]);

  const handleMute = useCallback(() => {
    if (isMuted) { sip.unmuteAudio(); setIsMuted(false); }
    else { sip.muteAudio(); setIsMuted(true); }
  }, [isMuted, sip]);

  const handleHold = useCallback(() => {
    if (isHeld) { sip.unholdCall(); setIsHeld(false); }
    else { sip.holdCall(); setIsHeld(true); }
  }, [isHeld, sip]);

  const handleRegister = useCallback(() => {
    sip.register(config.extension, config.password);
  }, [config, sip]);

  const handleUnregister = useCallback(() => {
    sip.unregister();
  }, [sip]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const callStatusColor = sip.callStatus === 'connected' ? '#52c41a'
    : sip.callStatus === 'ringing' || sip.callStatus === 'incoming' ? '#faad14'
    : '#00d4ff';

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 96px)' }}>
      <audio id="remoteAudio" autoPlay style={{ display: 'none' }} />

      {/* ── LEFT: SIP Config + Call Metrics ── */}
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, overflowY: 'auto' }}>

        {/* HTTPS Warning */}
        {typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && (
          <Alert
            message="Microphone requires HTTPS"
            description={<span>Browser blocks microphone on HTTP. Access via <strong>https://{window.location.host}/</strong> or run <code>./scripts/generate-ssl.sh</code>.</span>}
            type="warning" showIcon
            style={{ borderRadius: 10, background: 'rgba(250, 173, 20, 0.08)', borderColor: 'rgba(250, 173, 20, 0.2)', fontSize: 12 }}
          />
        )}

        {/* SIP Registration Config */}
        <Card size="small" style={glassCard} bodyStyle={{ padding: '16px 18px' }}
          title={
            <Space>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #5B2EFF, #00A6FF)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PhoneOutlined style={{ color: '#fff', fontSize: 16 }} />
              </div>
              <div>
                <div style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 700 }}>SIP Registration</div>
                <div style={{ color: '#64748b', fontSize: 10 }}>Connect to Asterisk PBX</div>
              </div>
            </Space>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '8px 12px', borderRadius: 10, background: sip.sipOnline ? 'rgba(82, 196, 26, 0.08)' : sip.registrationError ? 'rgba(255, 77, 79, 0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${sip.sipOnline ? 'rgba(82, 196, 26, 0.2)' : sip.registrationError ? 'rgba(255, 77, 79, 0.2)' : 'rgba(255,255,255,0.06)'}` }}>
            {sip.sipOnline && <span style={liveDotStyle} />}
            <span style={{ fontSize: 12, fontWeight: 600, color: sip.sipOnline ? '#52c41a' : sip.registrationError ? '#ff4d4f' : '#8a9bb8' }}>
              {sip.sipOnline ? '● REGISTERED' : sip.isRegistering ? '● CONNECTING' : sip.registrationError ? '● ERROR' : '● IDLE'}
            </span>
            {sip.sipOnline && sip.extension && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#64748b' }}>
                sip:{sip.extension}
              </span>
            )}
          </div>

          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>WebSocket URL</Text>
              <Input size="small" value={config.websocketUrl} onChange={e => setConfig({ ...config, websocketUrl: e.target.value })} placeholder="ws://127.0.0.1:8089/ws"
                style={{ ...inputStyle, marginTop: 4 }} prefix={<WifiOutlined style={{ color: '#64748b' }} />} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>Phone Number</Text>
              <Input size="small" value={config.extension} onChange={e => setConfig({ ...config, extension: e.target.value })} placeholder="1001"
                style={{ ...inputStyle, marginTop: 4 }} prefix={<UserOutlined style={{ color: '#64748b' }} />} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>Password</Text>
              <Input.Password size="small" value={config.password} onChange={e => setConfig({ ...config, password: e.target.value })}
                style={{ ...inputStyle, marginTop: 4 }} prefix={<LockOutlined style={{ color: '#64748b' }} />} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>Display Name</Text>
              <Input size="small" value={config.displayName} onChange={e => setConfig({ ...config, displayName: e.target.value })}
                style={{ ...inputStyle, marginTop: 4 }} />
            </div>
          </Space>

          {sip.registrationError && (
            <Alert message={sip.registrationError} type="error" showIcon style={{ marginTop: 10, borderRadius: 10, background: 'rgba(255, 77, 79, 0.08)', borderColor: 'rgba(255, 77, 79, 0.2)', fontSize: 12 }} />
          )}

          <div style={{ marginTop: 14 }}>
            {sip.sipOnline ? (
              <Button block danger onClick={handleUnregister}
                style={{ borderRadius: 10, background: 'rgba(255, 77, 79, 0.1)', borderColor: 'rgba(255, 77, 79, 0.3)', height: 36 }}>
                Unregister
              </Button>
            ) : (
              <Button block type="primary" onClick={handleRegister} loading={sip.isRegistering}
                style={{ borderRadius: 10, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none', height: 36 }}>
                Register SIP
              </Button>
            )}
          </div>
        </Card>

        {/* Call Metrics */}
        <Card size="small" title={
          <Space><BarChartOutlined style={{ color: '#00d4ff', fontSize: 16 }} /><span style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 600 }}>Call Metrics</span></Space>
        } style={glassCard} bodyStyle={{ padding: '14px 18px' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {[
              { label: 'Duration', value: formatDuration(sip.callDuration), color: '#00d4ff' },
              { label: 'State', value: sip.callStatus.toUpperCase(), color: sip.callStatus === 'connected' ? '#52c41a' : sip.callStatus === 'idle' || sip.callStatus === 'ended' ? '#5a6988' : '#faad14' },
              { label: 'Jitter', value: `${sip.rtpMetrics.jitter} ms`, color: '#f0f4ff' },
              { label: 'RTT', value: `${sip.rtpMetrics.rtt} ms`, color: '#f0f4ff' },
              { label: 'Packet Loss', value: `${sip.rtpMetrics.packetLoss}%`, color: sip.rtpMetrics.packetLoss > 5 ? '#ff4d4f' : '#f0f4ff' },
            ].map(item => (
              <Row key={item.label} justify="space-between" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{item.label}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: item.color, fontWeight: 600 }}>{item.value}</Text>
              </Row>
            ))}
          </Space>
        </Card>
      </div>

      {/* ── CENTER: Dialpad (VoxEra style) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, alignItems: 'center', justifyContent: 'center' }}>

        {/* Call Status bar (non-incoming) */}
        {sip.callStatus !== 'idle' && sip.callStatus !== 'ended' && sip.callStatus !== 'incoming' && (
          <Card size="small" style={{ ...glassCard, width: '100%', maxWidth: 420, borderColor: `${callStatusColor}25` }} bodyStyle={{ padding: '14px 18px' }}>
            <Row justify="space-between" align="middle">
              <Col>
                <Space>
                  <Tag style={{ borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, background: `${callStatusColor}1F`, color: callStatusColor }}>
                    {sip.callStatus.toUpperCase()}
                  </Tag>
                  <Text strong style={{ color: '#f0f4ff', fontSize: 18, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>{sip.incomingFrom || dialedNumber || sip.extension}</Text>
                  {sip.callStatus === 'connected' && (
                    <Text style={{ fontSize: 14, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#00d4ff' }}>
                      <FieldTimeOutlined style={{ marginRight: 4 }} />{formatDuration(sip.callDuration)}
                    </Text>
                  )}
                </Space>
              </Col>
              <Col>
                {sip.callStatus === 'ringing' ? (
                  <Space>
                    <Button size="small" type="primary" icon={<PhoneOutlined />} onClick={handleAnswer} style={{ borderRadius: 20, background: '#52c41a', borderColor: '#52c41a' }}>Answer</Button>
                    <Button size="small" danger icon={<CloseCircleOutlined />} onClick={handleReject} style={{ borderRadius: 20 }}>Reject</Button>
                  </Space>
                ) : sip.callStatus === 'connected' || sip.callStatus === 'on-hold' ? (
                  <Space>
                    <Button size="small" icon={isMuted ? <AudioMutedOutlined /> : <AudioOutlined />} onClick={handleMute} style={{ borderRadius: 20, background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)', color: '#f0f4ff' }}>{isMuted ? 'Unmute' : 'Mute'}</Button>
                    <Button size="small" icon={isHeld ? <PlayCircleOutlined /> : <PauseCircleOutlined />} onClick={handleHold} style={{ borderRadius: 20, background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)', color: '#f0f4ff' }}>{isHeld ? 'Resume' : 'Hold'}</Button>
                    <Button size="small" danger icon={<PhoneFilled />} onClick={handleHangup} style={{ borderRadius: 20, background: '#ff4d4f', borderColor: '#ff4d4f' }}>Hangup</Button>
                  </Space>
                ) : (
                  <Button size="small" danger icon={<CloseCircleOutlined />} onClick={handleHangup} style={{ borderRadius: 20 }}>Cancel</Button>
                )}
              </Col>
            </Row>
          </Card>
        )}

        {/* Number Display */}
        <div style={{ width: '100%', maxWidth: 320, position: 'relative' }}>
          <Input
            value={dialedNumber}
            onChange={e => setDialedNumber(e.target.value)}
            placeholder="Enter number"
            style={{
              fontSize: 32, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', textAlign: 'center',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#f0f4ff', borderRadius: 20, padding: '16px 48px 16px 16px', height: 72,
            }}
            suffix={dialedNumber ? (
              <Button type="text" icon={<RollbackOutlined />} onClick={handleBackspace} style={{ color: '#64748b', fontSize: 18 }} />
            ) : null}
          />
        </div>

        {/* VoxEra-style circular keypad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 280 }}>
          {KEYPAD_KEYS.map((btn) => (
            <KeypadButton key={btn.num} btn={btn} disabled={!sip.sipOnline && !isInCall} onPress={handleKeyPress} />
          ))}
        </div>

        {/* Call / Clear buttons */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <button
            onClick={() => setDialedNumber('')}
            disabled={!dialedNumber}
            style={{
              width: 60, height: 60, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)', color: '#8a9bb8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.25s ease', opacity: dialedNumber ? 1 : 0.4,
            }}
            onMouseEnter={e => { if (dialedNumber) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            <CloseCircleOutlined style={{ fontSize: 22 }} />
          </button>
          <button
            onClick={handleCall}
            disabled={!dialedNumber || (!sip.sipOnline && !isInCall)}
            style={{
              width: 68, height: 68, borderRadius: '50%', border: 'none',
              background: !dialedNumber || (!sip.sipOnline && !isInCall)
                ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #52c41a, #389e0d)',
              color: '#fff', cursor: !dialedNumber || (!sip.sipOnline && !isInCall) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.3s ease',
              boxShadow: !dialedNumber || (!sip.sipOnline && !isInCall)
                ? 'none' : '0 4px 24px rgba(82, 196, 26, 0.35)',
              opacity: !dialedNumber || (!sip.sipOnline && !isInCall) ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (dialedNumber && (sip.sipOnline || isInCall)) { e.currentTarget.style.boxShadow = '0 8px 32px rgba(82, 196, 26, 0.5)'; e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)'; } }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 24px rgba(82, 196, 26, 0.35)'; e.currentTarget.style.transform = 'none'; }}
          >
            <PhoneFilled style={{ fontSize: 26 }} />
          </button>
        </div>
      </div>

      {/* ── RIGHT: SIP Status + SIP Logs ── */}
      <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, overflowY: 'auto' }}>

        {/* SIP Status */}
        <Card size="small" title={
          <Space><WifiOutlined style={{ color: '#00d4ff', fontSize: 16 }} /><span style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 600 }}>SIP Status</span></Space>
        } style={glassCard} bodyStyle={{ padding: '14px 18px' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {[
              { label: 'WebSocket', value: sip.connectionStatus === 'connected' || sip.connectionStatus === 'connecting' ? 'Connected' : 'Disconnected', color: sip.connectionStatus === 'connected' || sip.connectionStatus === 'connecting' ? '#52c41a' : '#5a6988' },
              { label: 'Registration', value: sip.isRegistered ? 'Active' : sip.registrationError ? 'Failed' : 'Inactive', color: sip.isRegistered ? '#52c41a' : sip.registrationError ? '#ff4d4f' : '#5a6988' },
              { label: 'Extension', value: sip.extension || config.extension || '-', color: '#f0f4ff' },
            ].map(item => (
              <Row key={item.label} justify="space-between" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{item.label}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: item.color, fontWeight: 600 }}>{item.value}</Text>
              </Row>
            ))}
          </Space>
        </Card>

        {/* SIP Logs */}
        <Card size="small" title={
          <Space><GlobalOutlined style={{ color: '#00d4ff', fontSize: 16 }} /><span style={{ color: '#f0f4ff', fontSize: 13, fontWeight: 600 }}>SIP Logs</span></Space>
        } style={{ ...glassCard, flex: 1, minHeight: 180 }} bodyStyle={{ padding: '10px 14px' }}
          extra={<Button size="small" type="text" style={{ fontSize: 11, color: '#64748b' }} onClick={() => { /* logs are managed by context */ }}>Clear</Button>}
        >
          <div style={{ fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 10, maxHeight: 300, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 10px' }}>
            {sip.sipLogs.length === 0 && <Text type="secondary" style={{ fontSize: 10 }}>No SIP events yet...</Text>}
            {sip.sipLogs.map((log, i) => (
              <div key={i} style={{ padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log.level === 'error' ? <span style={{ color: '#ff4d4f' }}>[{log.time}] {log.message}</span>
                  : log.level === 'success' ? <span style={{ color: '#52c41a' }}>[{log.time}] {log.message}</span>
                  : log.level === 'warning' ? <span style={{ color: '#faad14' }}>[{log.time}] {log.message}</span>
                  : <span style={{ color: '#8a9bb8' }}>[{log.time}] {log.message}</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Incoming Call Modal (VoxEra style) ── */}
      <Modal
        open={sip.callStatus === 'incoming'}
        closable={false}
        footer={null}
        centered
        width={360}
        styles={{
          container: {
            background: 'linear-gradient(145deg, rgba(20, 27, 45, 0.95) 0%, rgba(10, 14, 23, 0.9) 100%)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(250, 173, 20, 0.25)',
            borderRadius: 24,
            boxShadow: '0 0 60px rgba(250, 173, 20, 0.15), 0 16px 48px rgba(0, 0, 0, 0.4)',
            padding: '32px 24px',
          },
          mask: {
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Animated ring indicator */}
          <div style={{ position: 'relative', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', border: '2px solid rgba(250, 173, 20, 0.3)', animation: 'ring-pulse 1.5s ease-out infinite' }} />
            <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', border: '2px solid rgba(250, 173, 20, 0.2)', animation: 'ring-pulse 1.5s ease-out infinite 0.5s' }} />
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(250, 173, 20, 0.2), rgba(250, 173, 20, 0.08))',
              border: '1px solid rgba(250, 173, 20, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PhoneOutlined style={{ fontSize: 24, color: '#faad14' }} />
            </div>
          </div>

          <Text style={{ color: '#faad14', fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>
            Incoming Call
          </Text>

          <Text style={{ color: '#f0f4ff', fontSize: 24, fontWeight: 700, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
            {sip.incomingFrom || 'Unknown'}
          </Text>

          {/* Answer / Reject buttons */}
          <div style={{ display: 'flex', gap: 32, marginTop: 8 }}>
            <button
              onClick={handleAnswer}
              style={{
                width: 64, height: 64, borderRadius: '50%', border: 'none',
                background: 'linear-gradient(135deg, #52c41a, #389e0d)',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(82, 196, 26, 0.4)',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(82, 196, 26, 0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(82, 196, 26, 0.4)'; }}
            >
              <PhoneOutlined style={{ fontSize: 24 }} />
            </button>
            <button
              onClick={handleReject}
              style={{
                width: 64, height: 64, borderRadius: '50%', border: 'none',
                background: 'linear-gradient(135deg, #ff4d4f, #cf1322)',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(255, 77, 79, 0.4)',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(255, 77, 79, 0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(255, 77, 79, 0.4)'; }}
            >
              <CloseCircleOutlined style={{ fontSize: 24 }} />
            </button>
          </div>
        </div>
      </Modal>

      <style>{`
        @keyframes blink-live { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes ripple-expand { 0%{transform:scale(0);opacity:1} 100%{transform:scale(2.5);opacity:0} }
        @keyframes ring-pulse { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.8);opacity:0} }
      `}</style>
    </div>
  );
}
