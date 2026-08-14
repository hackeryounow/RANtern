/**
 * usePhone — REST + WebSocket wiring for the simulated phone page.
 *
 * State/progress arrives over the shared /ws hub as events:
 *   phone_state, phone_attach, phone_sip, phone_call, phone_traffic
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPhoneState,
  getPhoneDefaults,
  setPhoneAirplane,
  phoneDial,
  phoneHangup,
  phoneAnswer,
  phoneReject,
  phonePing,
  phoneTraffic,
  PhoneSimConfig,
} from '../services/api';
import { useWebSocket } from './useWebSocket';

export interface PhoneTrafficCounters {
  tx_packets: number;
  tx_bytes: number;
  rx_packets: number;
  rx_bytes: number;
  last_tx: number;
  last_rx: number;
}

export interface PhoneState {
  airplane: boolean;
  phase: 'idle' | 'attaching' | 'attached' | 'ims_registered' | 'detaching' | 'error';
  error: string | null;
  sim: {
    imsi?: string;
    msisdn?: string;
    mcc?: string;
    mnc?: string;
    core_address?: string;
    pcscf_address?: string;
    upf_address?: string;
    realm?: string;
  };
  session: {
    internet?: { ip: string; teid: string };
    ims?: { ip: string; teid: string };
  };
  sip_state: 'unregistered' | 'registering' | 'registered' | 'failed';
  sub_state?: 'none' | 'pending' | 'active' | 'terminated' | 'failed';
  call_state: 'idle' | 'calling' | 'ringing' | 'incoming' | 'connected' | 'ended';
  call_peer: string;
  call_end_reason?: string;
  attach_progress: { step: string; status: string; detail?: string; ts: number }[];
  traffic: Record<string, PhoneTrafficCounters>;
}

export interface PhoneDefaults extends PhoneSimConfig {
  realm?: string;
  profile?: string;
}

const EMPTY_STATE: PhoneState = {
  airplane: true,
  phase: 'idle',
  error: null,
  sim: {},
  session: {},
  sip_state: 'unregistered',
  sub_state: 'none',
  call_state: 'idle',
  call_peer: '',
  call_end_reason: '',
  attach_progress: [],
  traffic: {},
};

export function usePhone() {
  const [state, setState] = useState<PhoneState>(EMPTY_STATE);
  const [defaults, setDefaults] = useState<PhoneDefaults>({});
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Initial snapshot + SIM prefills
  useEffect(() => {
    getPhoneState().then(r => setState({ ...EMPTY_STATE, ...r.data })).catch(() => {});
    getPhoneDefaults().then(r => setDefaults(r.data)).catch(() => {});
  }, []);

  const onWs = useCallback((type: string, data: any) => {
    if (type === 'phone_state') {
      setState(prev => ({ ...prev, ...data }));
    } else if (type === 'phone_attach') {
      setState(prev => {
        const steps = prev.attach_progress.filter(s => s.step !== data.step);
        return { ...prev, attach_progress: [...steps, data] };
      });
    } else if (type === 'phone_sip') {
      setState(prev => {
        const next = { ...prev };
        if (data.phase === 'register') {
          if (data.status === 'registered') next.sip_state = 'registered';
          else if (data.status === 'rejected') next.sip_state = 'failed';
          else if (data.status === 'sending' || data.status === 'challenged')
            next.sip_state = 'registering';
        } else if (data.phase === 'subscribe') {
          // reg-event SUBSCRIBE/NOTIFY lifecycle
          if (data.status === 'sending') next.sub_state = 'pending';
          else if (data.status === 'active') next.sub_state = 'active';
          else if (data.status === 'terminated') next.sub_state = 'terminated';
          else if (data.status === 'rejected') next.sub_state = 'failed';
        }
        return next;
      });
    } else if (type === 'phone_call') {
      setState(prev => ({
        ...prev,
        call_state: data.state ?? prev.call_state,
        call_peer: data.peer ?? prev.call_peer,
        call_end_reason: data.reason ?? prev.call_end_reason,
      }));
    } else if (type === 'phone_traffic') {
      setState(prev => ({ ...prev, traffic: data.traffic ?? prev.traffic }));
    }
  }, []);

  useWebSocket(onWs);

  const toggleAirplane = useCallback(async (enabled: boolean, sim?: PhoneSimConfig) => {
    setBusy(true);
    try {
      const r = await setPhoneAirplane(enabled, sim);
      setState(prev => ({ ...prev, ...r.data }));
      return r.data;
    } finally {
      setBusy(false);
    }
  }, []);

  const dial = useCallback(async (callee: string) => {
    const r = await phoneDial(callee);
    setState(prev => ({ ...prev, ...r.data }));
  }, []);

  const hangup = useCallback(async () => {
    const r = await phoneHangup();
    setState(prev => ({ ...prev, ...r.data }));
  }, []);

  const answer = useCallback(async () => {
    const r = await phoneAnswer();
    setState(prev => ({ ...prev, ...r.data }));
  }, []);

  const reject = useCallback(async () => {
    const r = await phoneReject();
    setState(prev => ({ ...prev, ...r.data }));
  }, []);

  const ping = useCallback(async (target?: string) => {
    const r = await phonePing(target);
    return r.data as { ok: boolean; rtt_ms: number | null; error?: string | null };
  }, []);

  const sendTraffic = useCallback(async (burst?: number, target?: string) => {
    const r = await phoneTraffic(burst, target);
    setState(prev => ({
      ...prev,
      traffic: r.data?.traffic ?? prev.traffic,
    }));
    return r.data as { ok: boolean; sent: number; error?: string };
  }, []);

  // Arrow activity: show up/down arrows when traffic happened recently
  const now = Date.now() / 1000;
  const counters = state.traffic || {};
  const txActive = Object.values(counters).some(c => now - c.last_tx < 2.0);
  const rxActive = Object.values(counters).some(c => now - c.last_rx < 2.0);

  return {
    state,
    defaults,
    busy,
    txActive,
    rxActive,
    toggleAirplane,
    dial,
    hangup,
    answer,
    reject,
    ping,
    sendTraffic,
    refresh: () => getPhoneState().then(r => setState({ ...EMPTY_STATE, ...r.data })).catch(() => {}),
  };
}
