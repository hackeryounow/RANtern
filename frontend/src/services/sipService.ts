/**
 * sipService.ts
 * Core JsSIP service layer — handles UA lifecycle, registration, and calls.
 */

import JsSIP from 'jssip';

const REGISTER_TIMEOUT_MS = 25_000;
const ICE_GATHER_TIMEOUT_MS = 2000;

let cachedLocalAudioStream: MediaStream | null = null;

const wiredSessions = new WeakSet<any>();
const wiredPeerConnections = new WeakSet<RTCPeerConnection>();

const defaultCallOptions = {
  mediaConstraints: { audio: true, video: false },
  pcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    iceTransportPolicy: 'all' as const,
    bundlePolicy: 'max-bundle' as const,
    rtcpMuxPolicy: 'require' as const,
    iceCandidatePoolSize: 0,
  },
  rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
  sessionTimersExpires: 0,
};

/** Acquire mic before ua.call() — JsSIP can hang silently if getUserMedia fails inside its promise chain. */
export async function acquireCallMedia(): Promise<MediaStream> {
  if (typeof window === 'undefined') {
    throw new Error('Cannot place calls outside a browser');
  }
  if (!window.RTCPeerConnection) {
    throw new Error('WebRTC is not supported in this browser');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    if (!window.isSecureContext) {
      const host = window.location.host;
      throw new Error(
        `Microphone blocked on http://${host} — Browser requires HTTPS for microphone access. ` +
        `Solutions: (1) Open https://${host}/ instead and accept the certificate warning; ` +
        `(2) Or run ./scripts/generate-ssl.sh then docker compose up --build to enable HTTPS.`
      );
    }
    throw new Error('Microphone API unavailable in this browser');
  }
  if (cachedLocalAudioStream?.active) {
    return cachedLocalAudioStream;
  }
  console.info('[SIP] Requesting microphone…');
  try {
    cachedLocalAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    console.info('[SIP] Microphone granted');
    return cachedLocalAudioStream;
  } catch (err: any) {
    cachedLocalAudioStream = null;
    const name = err?.name || 'Error';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error('Microphone permission denied — allow mic in the browser address bar');
    }
    if (name === 'NotFoundError') {
      throw new Error('No microphone found on this device');
    }
    throw new Error(`Microphone error (${name}): ${err?.message || 'unknown'}`);
  }
}

export function releaseCallMedia() {
  if (!cachedLocalAudioStream) return;
  cachedLocalAudioStream.getTracks().forEach((t) => t.stop());
  cachedLocalAudioStream = null;
}

function playRemoteAudio(stream: MediaStream) {
  if (!stream) return;
  const audioEl = document.getElementById('remoteAudio') as HTMLAudioElement | null;
  if (!audioEl) return;
  audioEl.srcObject = stream;
  audioEl.play().catch((err) => {
    console.warn('[SIP] Audio autoplay blocked:', err);
    document.addEventListener('click', () => audioEl.play(), { once: true });
  });
}

function bindPeerConnection(pc: RTCPeerConnection, session: any, callbacks: any) {
  if (!pc || wiredPeerConnections.has(pc)) return;
  wiredPeerConnections.add(pc);

  const onMediaReady = () => {
    callbacks.onMediaConnected?.(session);
  };

  pc.addEventListener('connectionstatechange', () => {
    console.info(`[SIP] PeerConnection connectionState — ${pc.connectionState}`);
    if (pc.connectionState === 'connected') onMediaReady();
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    console.info(`[SIP] PeerConnection iceConnectionState — ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      onMediaReady();
    }
  });

  pc.addEventListener('track', (trackEvent: RTCTrackEvent) => {
    console.info('[SIP] Remote track received:', trackEvent.track.kind);
    if (trackEvent.streams?.[0]) playRemoteAudio(trackEvent.streams[0]);
    onMediaReady();
  });

  if (pc.connectionState === 'connected') onMediaReady();
  if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
    onMediaReady();
  }

  callbacks.onPeerConnection?.(pc, session);
  armIceGatherFallback(pc, session);
}

/** JsSIP blocks INVITE until ICE gathering finishes — force proceed after timeout. */
function armIceGatherFallback(pc: RTCPeerConnection, session: any) {
  const anyPc = pc as any;
  if (!pc || anyPc.__ranternIceArm) return;
  anyPc.__ranternIceArm = true;

  let iceReadyFn: (() => void) | null = null;
  let done = false;

  const proceed = (reason: string) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (typeof iceReadyFn === 'function') {
      console.info(`[SIP] ICE proceed (${reason})`);
      iceReadyFn();
    } else {
      console.warn(`[SIP] ICE proceed (${reason}) but ready callback not set yet`);
    }
  };

  const timer = setTimeout(() => proceed('timeout'), ICE_GATHER_TIMEOUT_MS);

  session.on('icecandidate', (data: any) => {
    if (data?.ready) iceReadyFn = data.ready;
    if (!data?.candidate) proceed('gathering-complete');
  });

  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') proceed('icegatheringstate-complete');
  });
}

function attachSessionHandlers(session: any, callbacks: any) {
  if (!session || wiredSessions.has(session)) return;
  wiredSessions.add(session);

  session.on('progress', (e: any) => {
    const code = e.response?.status_code;
    console.info(`[SIP] Session progress — ${code}`);
    callbacks.onProgress?.(session, code);
  });

  session.on('accepted', () => {
    console.info('[SIP] Session accepted (200 OK)');
    callbacks.onAccepted?.(session);
  });

  session.on('confirmed', () => {
    console.info('[SIP] Session confirmed — ACK complete');
    callbacks.onConfirmed?.(session);
  });

  session.on('ended', (e: any) => {
    console.info('[SIP] Session ended', e.cause);
    callbacks.onEnded?.(session, e.cause);
  });

  session.on('failed', (e: any) => {
    const code = e.message?.status_code || e.response?.status_code;
    const dir = session.direction || 'unknown';
    console.error(
      `[SIP] Session failed (${dir})`,
      e.cause,
      code ? `SIP ${code}` : '',
      session.remote_identity?.uri?.user ? `peer ${session.remote_identity.uri.user}` : ''
    );
    callbacks.onFailed?.(session, e.cause);
  });

  session.on('getusermediafailed', (e: any) => {
    console.error('[SIP] getUserMedia failed', e);
    callbacks.onFailed?.(session, 'getUserMediaFailed');
  });

  session.on('connecting', () => {
    console.info('[SIP] Session connecting — acquiring media / building SDP');
  });

  session.on('peerconnection:createofferfailed', (e: any) => {
    console.error('[SIP] createOffer failed', e);
    callbacks.onFailed?.(session, 'WebRTC Error');
  });

  session.on('sending', (e: any) => {
    if (e.request?.method === 'INVITE') {
      console.info('[SIP] INVITE sent');
      callbacks.onProgress?.(session, 100);
    }
  });

  session.on('peerconnection', (e: any) => {
    console.info('[SIP] PeerConnection created');
    bindPeerConnection(e.peerconnection, session, callbacks);
  });

  if (session.connection) {
    console.info('[SIP] PeerConnection already present on session');
    bindPeerConnection(session.connection, session, callbacks);
  }
}

export interface SipCallbacks {
  onConnecting?: () => void;
  onConnected?: () => void;
  onDisconnected?: (cause?: string) => void;
  onRegistered?: (extension: string) => void;
  onUnregistered?: () => void;
  onRegistrationFailed?: (detail: string, e?: any) => void;
  onIncomingCall?: (session: any, caller: string) => void;
  onOutgoingCall?: (session: any, callee: string) => void;
  onProgress?: (session: any, code?: number) => void;
  onAccepted?: (session: any) => void;
  onConfirmed?: (session: any) => void;
  onEnded?: (session: any, cause?: string) => void;
  onFailed?: (session: any, cause?: string) => void;
  onMediaConnected?: (session: any) => void;
  onPeerConnection?: (pc: RTCPeerConnection, session: any) => void;
}

export interface SipOverrides {
  websocketUrl?: string;
  uri?: string;
  password?: string;
}

export function createUA(callbacks: SipCallbacks, overrides: SipOverrides = {}): any {
  const websocketUrl = overrides.websocketUrl || '';
  const uri = String(overrides.uri || '');
  const password = overrides.password || '';

  if (!websocketUrl || !uri || !password) {
    throw new Error('SIP configuration incomplete — set WebSocket URL, SIP URI, and password');
  }

  const socket = new (JsSIP as any).WebSocketInterface(websocketUrl);

  // Parse URI to get extension and domain
  const uriMatch = uri.match(/sip:(\d+)@(.+)/);
  if (!uriMatch) {
    throw new Error(`Invalid SIP URI — expected sip:1001@host, got "${uri}"`);
  }
  const authorizationUser = uriMatch[1];
  const uriDomain = uriMatch[2];

  const configuration = {
    sockets: [socket],
    uri: uri,
    contact_uri: `sip:${authorizationUser}@${uriDomain}`,
    display_name: authorizationUser,
    authorization_user: authorizationUser,
    password,
    register: true,
    session_timers: false,
    register_expires: 600,
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  };

  console.log('[SIP] UA config', {
    ...configuration,
    password: configuration.password ? '***' : undefined,
    sockets: [websocketUrl],
  });

  const extension = authorizationUser;
  const ua = new (JsSIP as any).UA(configuration);
  let registerTimeoutId: any = null;
  let hadDisconnected = false;

  const clearRegisterTimeout = () => {
    if (registerTimeoutId) {
      clearTimeout(registerTimeoutId);
      registerTimeoutId = null;
    }
  };

  const startRegisterTimeout = () => {
    clearRegisterTimeout();
    registerTimeoutId = setTimeout(() => {
      console.error(`[SIP] Registration timeout — no final REGISTER response within ${REGISTER_TIMEOUT_MS / 1000}s`);
      callbacks.onRegistrationFailed?.(
        `Timeout — no REGISTER response from server within ${REGISTER_TIMEOUT_MS / 1000}s (check Asterisk PJSIP + port)`
      );
    }, REGISTER_TIMEOUT_MS);
  };

  ua.on('connecting', () => {
    console.info(`[SIP] Connecting — ${uri}`);
    callbacks.onConnecting?.();
  });

  ua.on('connected', () => {
    console.info(`[SIP] WebSocket connected — ${uri} (sending REGISTER…)`);
    startRegisterTimeout();
    callbacks.onConnected?.();
    if (hadDisconnected) {
      console.info('[SIP] WebSocket reconnected — refreshing REGISTER contact');
      ua.register({ expires: configuration.register_expires });
    }
    hadDisconnected = false;
  });

  ua.on('disconnected', (e: any) => {
    clearRegisterTimeout();
    hadDisconnected = true;
    const cause = e?.cause ?? e?.error?.cause ?? e?.error ?? 'unknown';
    console.warn(`[SIP] WebSocket disconnected — ${uri}`, cause);
    callbacks.onDisconnected?.(cause);
  });

  ua.on('registered', () => {
    clearRegisterTimeout();
    console.info(`[SIP] Registered — ${uri}`);
    callbacks.onRegistered?.(extension);
  });

  ua.on('unregistered', () => {
    clearRegisterTimeout();
    console.info(`[SIP] Unregistered — ${uri}`);
    callbacks.onUnregistered?.();
  });

  ua.on('registrationFailed', (e: any) => {
    clearRegisterTimeout();
    const code = e.response?.status_code;
    const reason = e.response?.reason_phrase;
    const detail = code ? `${code} ${reason || ''}`.trim() : String(e.cause || 'Unknown error');
    if (ua.isRegistered()) {
      console.warn(`[SIP] Ignoring registrationFailed after successful register — ${detail}`);
      return;
    }
    console.error(`[SIP] Registration failed — ${uri}`, detail, e.response || e);
    callbacks.onRegistrationFailed?.(detail, e);
  });

  ua.on('registrationExpiring', () => {
    console.info(`[SIP] Registration expiring — ${uri}`);
  });

  ua.on('newRTCSession', (data: any) => {
    const session = data.session;
    const originator = data.originator;

    console.info(`[SIP] New session — originator: ${originator}`);

    attachSessionHandlers(session, callbacks);

    if (originator === 'remote') {
      const caller = session.remote_identity?.uri?.user || 'Unknown';
      console.info(`[SIP] Incoming call from ${caller}`);
      callbacks.onIncomingCall?.(session, caller);
    } else {
      const callee = session.remote_identity?.uri?.user || 'Unknown';
      console.info(`[SIP] Outgoing call to ${callee}`);
      callbacks.onOutgoingCall?.(session, callee);
    }
  });

  return ua;
}

export function getUaSipDomain(ua: any): string {
  const uri = ua?.configuration?.uri;
  if (uri) {
    const match = uri.match(/sip:\d+@(.+)/);
    if (match) return match[1];
  }
  return '';
}

export async function makeCall(ua: any, target: string, domain?: string): Promise<any> {
  if (!ua) throw new Error('UA not initialized');

  const callDomain = domain || getUaSipDomain(ua);
  const targetURI = `sip:${target}@${callDomain}`;

  const mediaStream = await acquireCallMedia();
  console.info(`[SIP] Calling ${targetURI}`);
  const session = ua.call(targetURI, { ...defaultCallOptions, mediaStream });
  return session;
}

export async function answerCall(session: any): Promise<void> {
  if (!session) return;
  const mediaStream = await acquireCallMedia();

  const STATUS_EARLY = 5;
  const STATUS_CONFIRMED = 7;
  const status = session.status ?? session._status;

  if (status === STATUS_EARLY) {
    console.info('[SIP] Session in EARLY state (status 5) — waiting for confirmed before answering');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for session confirmation'));
      }, 10000);

      const onConfirmed = () => {
        clearTimeout(timeout);
        cleanup();
        try {
          session.answer({ ...defaultCallOptions, mediaStream });
          console.info('[SIP] Call answered after confirmed');
          resolve();
        } catch (e: any) {
          reject(e);
        }
      };

      const onFailed = (e: any) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Call failed while waiting: ${e?.cause || 'unknown'}`));
      };

      const onEnded = () => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Call ended while waiting for confirmation'));
      };

      const cleanup = () => {
        session.off('confirmed', onConfirmed);
        session.off('failed', onFailed);
        session.off('ended', onEnded);
      };

      session.on('confirmed', onConfirmed);
      session.on('failed', onFailed);
      session.on('ended', onEnded);

      if (session.status === STATUS_CONFIRMED || session._status === STATUS_CONFIRMED) {
        clearTimeout(timeout);
        cleanup();
        try {
          session.answer({ ...defaultCallOptions, mediaStream });
          console.info('[SIP] Call answered (already confirmed)');
          resolve();
        } catch (e: any) {
          reject(e);
        }
      }
    });
  } else {
    session.answer({ ...defaultCallOptions, mediaStream });
    console.info('[SIP] Call answered');
  }
}

export function terminateSession(session: any): void {
  if (!session) return;
  try {
    session.terminate();
    console.info('[SIP] Session terminated');
  } catch (e) {
    console.warn('[SIP] Terminate error:', e);
  }
}

export function destroyUA(ua: any): void {
  if (!ua) return;
  try {
    ua.stop();
    releaseCallMedia();
    console.info('[SIP] UA stopped');
  } catch (e) {
    console.warn('[SIP] UA stop error:', e);
  }
}