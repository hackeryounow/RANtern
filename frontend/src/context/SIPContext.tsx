/**
 * SIPContext.tsx
 * Global React context for SIP state management (参考 VoxEra SIPContext).
 */

import { createContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  createUA,
  makeCall as sipMakeCall,
  answerCall as sipAnswerCall,
  terminateSession,
  destroyUA,
} from '../services/sipService';
import type { SipCallbacks } from '../services/sipService';

interface SipConfig {
  websocketUrl: string;
  extension: string;
  password: string;
  displayName: string;
}

interface CallMetrics {
  jitter: number;
  rtt: number;
  packetLoss: number;
  packetsSent: number;
  packetsReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

interface SIPContextValue {
  isRegistered: boolean;
  isRegistering: boolean;
  registrationError: string | null;
  extension: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  sipOnline: boolean;
  sipConfig: SipConfig;
  setSipConfig: React.Dispatch<React.SetStateAction<SipConfig>>;

  callStatus: 'idle' | 'calling' | 'ringing' | 'connected' | 'ended' | 'incoming' | 'on-hold';
  callDuration: number;
  incomingCall: any | null;
  incomingFrom: string | null;
  currentCall: any | null;

  rtpMetrics: CallMetrics;
  sipLogs: { level: string; message: string; time: string }[];

  register: (ext?: string, password?: string, domainOverride?: string) => void;
  unregister: () => void;
  makeCall: (target: string) => Promise<void>;
  answerCall: () => void;
  hangupCall: () => void;
  rejectCall: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  holdCall: () => void;
  unholdCall: () => void;
}

const SIPContext = createContext<SIPContextValue | null>(null);
export { SIPContext };

const defaultMetrics: CallMetrics = {
  jitter: 0, rtt: 0, packetLoss: 0,
  packetsSent: 0, packetsReceived: 0,
  bytesSent: 0, bytesReceived: 0,
};

function parseSipUri(uri: string): { extension: string; domain: string } {
  const match = uri.match(/sip:(\d+)@(.+)/);
  if (match) return { extension: match[1], domain: match[2] };
  return { extension: '', domain: '' };
}

function hostFromUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^ws/, 'http'));
    return u.hostname;
  } catch {
    return '';
  }
}

export function SIPProvider({ children }: { children: React.ReactNode }) {
  const [sipConfig, setSipConfig] = useState<SipConfig>(() => {
    const saved = localStorage.getItem('rantern_sip_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.uri && !parsed.extension) {
          const match = String(parsed.uri).match(/sip:(\d+)@/);
          parsed.extension = match ? match[1] : String(parsed.uri).replace(/[^0-9]/g, '');
          delete parsed.uri;
        }
        if (parsed.extension && typeof parsed.extension === 'string') {
          const sipMatch = parsed.extension.match(/sip:(\d+)@/);
          if (sipMatch) parsed.extension = sipMatch[1];
        }
        return {
          websocketUrl: parsed.websocketUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/sip-ws`,
          extension: String(parsed.extension || '').replace(/[^\d]/g, '') || '1001',
          password: parsed.password || '',
          displayName: parsed.displayName || 'CoreSim',
        };
      } catch {
        // fall through to default
      }
    }
    const wsProto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1';
    return {
      websocketUrl: `${wsProto}//${host}/sip-ws`,
      extension: '1001',
      password: '',
      displayName: 'CoreSim',
    };
  });

  const [isRegistered, setIsRegistered] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [extension, setExtension] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [uaLive, setUaLive] = useState(false);

  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'ringing' | 'connected' | 'ended' | 'incoming' | 'on-hold'>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<any | null>(null);
  const [incomingFrom, setIncomingFrom] = useState<string | null>(null);
  const [currentCall, setCurrentCall] = useState<any | null>(null);

  const [rtpMetrics, setRtpMetrics] = useState<CallMetrics>(defaultMetrics);
  const [sipLogs, setSipLogs] = useState<{ level: string; message: string; time: string }[]>([]);

  const uaRef = useRef<any>(null);
  const callTimerRef = useRef<any>(null);
  const statsTimerRef = useRef<any>(null);
  const prevBytesRef = useRef(0);
  const callStartTimeRef = useRef<number | null>(null);
  const currentCallRef = useRef<any>(null);
  const registerSignatureRef = useRef('');
  const registerInProgressRef = useRef(false);
  const disconnectTimerRef = useRef<any>(null);
  const extensionRef = useRef(extension);
  const isRegisteredRef = useRef(isRegistered);
  const incomingCallRef = useRef<any>(null);

  const addLog = useCallback((level: string, msg: string) => {
    setSipLogs(prev => [...prev.slice(-99), { level, message: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    localStorage.setItem('rantern_sip_config', JSON.stringify(sipConfig));
  }, [sipConfig]);

  useEffect(() => { extensionRef.current = extension; }, [extension]);
  useEffect(() => { isRegisteredRef.current = isRegistered; }, [isRegistered]);
  useEffect(() => { currentCallRef.current = currentCall; }, [currentCall]);

  const stopCallTimer = useCallback(() => {
    clearInterval(callTimerRef.current);
    callTimerRef.current = null;
    callStartTimeRef.current = null;
    setCallDuration(0);
  }, []);

  const startCallTimer = useCallback((connectedAt?: number) => {
    const anchor = connectedAt || callStartTimeRef.current || Date.now();
    callStartTimeRef.current = anchor;
    const tick = () => {
      if (callStartTimeRef.current) {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }
    };
    tick();
    clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(tick, 1000);
  }, []);

  const startStatsPolling = useCallback((pc: RTCPeerConnection) => {
    if (!pc) return;
    prevBytesRef.current = 0;

    statsTimerRef.current = setInterval(async () => {
      try {
        const report = await pc.getStats();
        const metrics = { ...defaultMetrics };

        report.forEach((r: any) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            metrics.jitter = Math.round((r.jitter || 0) * 1000);
            metrics.packetsReceived = r.packetsReceived || 0;
            metrics.bytesReceived = r.bytesReceived || 0;
            const lost = r.packetsLost || 0;
            const total = metrics.packetsReceived + lost;
            metrics.packetLoss = total > 0 ? parseFloat(((lost / total) * 100).toFixed(2)) : 0;
            // bitrate tracking removed
            prevBytesRef.current = metrics.bytesReceived;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'audio') {
            metrics.packetsSent = r.packetsSent || 0;
            metrics.bytesSent = r.bytesSent || 0;
          }
          if (r.type === 'remote-inbound-rtp' && r.kind === 'audio') {
            if (r.roundTripTime !== undefined) metrics.rtt = Math.round(r.roundTripTime * 1000);
          }
          if (r.type === 'candidate-pair' && r.state === 'succeeded') {
            if (metrics.rtt === 0 && r.currentRoundTripTime) {
              metrics.rtt = Math.round(r.currentRoundTripTime * 1000);
            }
          }
        });

        setRtpMetrics(metrics);
      } catch (e) {
        console.warn('[Stats] getStats error:', e);
      }
    }, 1000);
  }, []);

  const stopStatsPolling = useCallback(() => {
    clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
    setRtpMetrics(defaultMetrics);
    prevBytesRef.current = 0;
  }, []);

  const resetCallState = useCallback(() => {
    setCallStatus('idle');
    setCurrentCall(null);
    setIncomingCall(null);
    setIncomingFrom(null);
    incomingCallRef.current = null;
    stopCallTimer();
    stopStatsPolling();
  }, [stopCallTimer, stopStatsPolling]);

  const markCallConnected = useCallback((session: any) => {
    if (!session) return;
    setCurrentCall(session);
    setCallStatus('connected');
    setIncomingCall(null);
    setIncomingFrom(null);
    incomingCallRef.current = null;

    const pc = session.connection;
    if (pc) {
      startStatsPolling(pc);
    }

    if (!callStartTimeRef.current) {
      startCallTimer(Date.now());
    }
  }, [startStatsPolling, startCallTimer]);

  const register = useCallback((ext?: string, password?: string, domainOverride?: string) => {
    const websocketUrl = sipConfig.websocketUrl;
    let rawExt = ext ? ext.trim() : sipConfig.extension.trim();
    const sipMatch = rawExt.match(/sip:(\d+)@/);
    if (sipMatch) rawExt = sipMatch[1];
    const trimmedExt = rawExt.replace(/[^\d]/g, '') || rawExt;
    const explicitPass = password || sipConfig.password || '';

    const domain = domainOverride || hostFromUrl(websocketUrl) || '127.0.0.1';
    const uri = `sip:${trimmedExt}@${domain}`;

    if (!trimmedExt || !explicitPass) {
      setRegistrationError('Extension and password are required');
      return;
    }

    const signature = `${uri}|${explicitPass}`;
    const existingUa = uaRef.current;
    if (existingUa && registerSignatureRef.current === signature && (existingUa.isRegistered?.() || registerInProgressRef.current)) {
      console.info('[SIP] Already registered or registering with same credentials — skip');
      return;
    }

    if (existingUa) {
      destroyUA(existingUa);
      uaRef.current = null;
    }

    registerSignatureRef.current = signature;
    registerInProgressRef.current = true;
    setIsRegistering(true);
    setRegistrationError(null);
    setConnectionStatus('connecting');
    setUaLive(false);

    if (trimmedExt && explicitPass) {
      localStorage.setItem('sip_ext', trimmedExt);
    }

    const callbacks: SipCallbacks = {
      onConnecting: () => {
        setConnectionStatus('connecting');
        addLog('info', 'WebSocket connecting...');
      },
      onConnected: () => {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        setConnectionStatus('connected');
        addLog('info', 'WebSocket connected');
      },
      onDisconnected: (cause) => {
        console.warn('[SIP] WebSocket dropped, JsSIP reconnecting…', cause || 'no cause');
        setConnectionStatus('disconnected');
        setIsRegistered(false);
        setIsRegistering(false);
        setUaLive(false);
        registerInProgressRef.current = false;
        addLog('warning', `WebSocket disconnected: ${cause || 'unknown'}`);
      },
      onRegistered: (ext) => {
        registerInProgressRef.current = false;
        setIsRegistered(true);
        setIsRegistering(false);
        setExtension(ext);
        setConnectionStatus('connected');
        setUaLive(true);
        setRegistrationError(null);
        localStorage.setItem('sip_ext', ext);
        localStorage.setItem('sip_registered', 'true');
        addLog('success', `Registered as ${ext}`);
      },
      onUnregistered: () => {
        registerInProgressRef.current = false;
        setIsRegistered(false);
        setIsRegistering(false);
        setUaLive(false);
        setConnectionStatus('disconnected');
        setExtension('');
        localStorage.removeItem('sip_registered');
        localStorage.removeItem('sip_ext');
        addLog('info', 'Unregistered');
      },
      onRegistrationFailed: (detail) => {
        registerInProgressRef.current = false;
        setIsRegistered(false);
        setIsRegistering(false);
        setUaLive(false);
        setConnectionStatus('disconnected');

        const attemptedExt = ext || extensionRef.current || sipConfig.extension;
        let msg = `Registration failed: ${detail}`;
        if (String(detail).startsWith('404')) {
          msg += ` — Registrar AOR mismatch (server needs aors=${attemptedExt || 'ext'}).`;
        } else if (String(detail).includes('Timeout')) {
          msg += ' — Asterisk may have sent 200 OK without binding contact.';
        } else if (String(detail).startsWith('403')) {
          msg += ' — Forbidden (wrong password or endpoint not allowed to register).';
        } else if (String(detail).startsWith('401')) {
          msg += attemptedExt
            ? ` — Digest auth failed for extension ${attemptedExt} (password is usually ${attemptedExt}).`
            : ' — Digest auth failed.';
        } else if (String(detail).startsWith('500')) {
          msg += ' — Server error (check PJSIP auth object names on server).';
        }
        setRegistrationError(msg);
        addLog('error', msg);
      },
      onIncomingCall: (session, caller) => {
        incomingCallRef.current = session;
        setIncomingCall(session);
        setIncomingFrom(caller);
        setCallStatus('incoming');
        addLog('info', `Incoming call from ${caller}`);
      },
      onOutgoingCall: (session, callee) => {
        setCurrentCall(session);
        setCallStatus('calling');
        addLog('info', `Calling ${callee}...`);
      },
      onAccepted: (session) => {
        markCallConnected(session);
        addLog('success', 'Call accepted');
      },
      onConfirmed: (session) => {
        markCallConnected(session);
        addLog('success', 'Call confirmed');
      },
      onEnded: (session, cause) => {
        resetCallState();
        addLog('info', `Call ended: ${cause || 'normal'}`);
      },
      onFailed: (session, cause) => {
        if (cause === 'getUserMediaFailed' || cause === 'User Denied Media Access') {
          setRegistrationError('Microphone access failed — allow mic permission and try again');
        }
        resetCallState();
        addLog('error', `Call failed: ${cause || 'unknown'}`);
      },
      onPeerConnection: (_pc) => {
        // PC created
      },
    };

    try {
      const ua = createUA(callbacks, { websocketUrl, uri, password: explicitPass });
      uaRef.current = ua;
      ua.start();

      // Detect dead WebSocket while registering
      disconnectTimerRef.current = setTimeout(() => {
        const currentUa = uaRef.current;
        if (currentUa && !currentUa.isConnected?.()) {
          registerInProgressRef.current = false;
          setIsRegistered(false);
          setIsRegistering(false);
          setConnectionStatus('disconnected');
          setRegistrationError(
            'SIP WebSocket could not connect. Check Asterisk PJSIP WebSocket port and try again.'
          );
        }
      }, 12000);
    } catch (err: any) {
      setIsRegistering(false);
      registerInProgressRef.current = false;
      setRegistrationError(err.message);
      addLog('error', `Failed to create UA: ${err.message}`);
    }
  }, [sipConfig, addLog, markCallConnected, resetCallState]);

  const unregister = useCallback(() => {
    registerSignatureRef.current = '';
    registerInProgressRef.current = false;
    if (uaRef.current) {
      destroyUA(uaRef.current);
      uaRef.current = null;
    }
    resetCallState();
    setIsRegistered(false);
    setIsRegistering(false);
    setExtension('');
    setConnectionStatus('disconnected');
    setUaLive(false);
    localStorage.removeItem('sip_registered');
    localStorage.removeItem('sip_ext');
    addLog('info', 'Unregistered');
  }, [resetCallState, addLog]);

  const makeCall = useCallback(async (target: string) => {
    const ua = uaRef.current;
    if (!ua || !isRegistered) {
      addLog('error', 'Not registered — cannot make call');
      return;
    }
    if (!ua.isConnected?.() || !ua.isRegistered?.()) {
      setRegistrationError('SIP not connected — register again before calling');
      return;
    }
    if (callStatus !== 'idle') return;
    const normalizedTarget = target.trim();
    if (normalizedTarget === extensionRef.current) {
      setRegistrationError(`Cannot call your own extension (${normalizedTarget})`);
      return;
    }
    const domain = hostFromUrl(sipConfig.websocketUrl) || '127.0.0.1';
    try {
      setRegistrationError(null);
      await sipMakeCall(ua, normalizedTarget, domain);
    } catch (err: any) {
      addLog('error', `Call failed: ${err.message}`);
      setRegistrationError(err?.message || 'Call failed — see browser console');
    }
  }, [isRegistered, callStatus, addLog, sipConfig]);

  const answerCall = useCallback(async () => {
    const session = incomingCallRef.current || incomingCall;
    if (!session) return;
    try {
      await sipAnswerCall(session);
      setCurrentCall(session);
    } catch (e: any) {
      addLog('error', `Answer failed: ${e?.message || 'unknown'}`);
      setRegistrationError(e?.message || 'Answer failed — allow microphone access');
    }
  }, [incomingCall, addLog]);

  const hangupCall = useCallback(() => {
    if (currentCall) {
      terminateSession(currentCall);
    }
    if (incomingCall) {
      terminateSession(incomingCall);
    }
    resetCallState();
  }, [currentCall, incomingCall, resetCallState]);

  const rejectCall = useCallback(() => {
    const session = incomingCallRef.current || incomingCall;
    if (session) {
      terminateSession(session);
    }
    resetCallState();
  }, [incomingCall, resetCallState]);

  const muteAudio = useCallback(() => {
    if (currentCall?.mute) {
      currentCall.mute({ audio: true, video: false });
      addLog('info', 'Muted');
    }
  }, [currentCall, addLog]);

  const unmuteAudio = useCallback(() => {
    if (currentCall?.unmute) {
      currentCall.unmute({ audio: true, video: false });
      addLog('info', 'Unmuted');
    }
  }, [currentCall, addLog]);

  const holdCall = useCallback(() => {
    if (currentCall?.hold) {
      currentCall.hold();
      setCallStatus('on-hold');
      addLog('info', 'On hold');
    }
  }, [currentCall, addLog]);

  const unholdCall = useCallback(() => {
    if (currentCall?.unhold) {
      currentCall.unhold();
      setCallStatus('connected');
      addLog('info', 'Resumed');
    }
  }, [currentCall, addLog]);

  // Detect dead WebSocket while UI still shows registered
  useEffect(() => {
    const id = setInterval(() => {
      const ua = uaRef.current;
      if (!ua || !isRegistered) return;
      const live = Boolean(ua.isConnected?.() && ua.isRegistered?.());
      setUaLive(live);
      if (!live) {
        setIsRegistered(false);
        setRegistrationError('SIP connection lost — click Register to reconnect');
      }
    }, 8000);
    return () => clearInterval(id);
  }, [isRegistered]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uaRef.current) {
        destroyUA(uaRef.current);
      }
      clearInterval(callTimerRef.current);
      clearInterval(statsTimerRef.current);
    };
  }, []);

  const sipOnline = isRegistered && connectionStatus === 'connected' && uaLive;

  return (
    <SIPContext.Provider value={{
      isRegistered, isRegistering, registrationError, extension, connectionStatus, sipOnline,
      sipConfig, setSipConfig,
      callStatus, callDuration, incomingCall, incomingFrom, currentCall,
      rtpMetrics, sipLogs,
      register, unregister, makeCall, answerCall, hangupCall, rejectCall,
      muteAudio, unmuteAudio, holdCall, unholdCall,
    }}>
      {children}
    </SIPContext.Provider>
  );
}
