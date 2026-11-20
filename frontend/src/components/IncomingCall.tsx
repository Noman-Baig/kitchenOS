'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { getStaffSocket } from '@/lib/socket';
import { api } from '@/lib/api';
import { VoiceCall, webrtcSupported } from '@/lib/webrtc';
import { useSession } from './Session';

/** Global incoming-call handler for staff with calls.receive permission. */
export function IncomingCall() {
  const s = useSession();
  const [ringing, setRinging] = useState<any>(null);
  const [active, setActive] = useState<{ callId: string; customer: string; table: string } | null>(null);
  const [state, setState] = useState('');
  const [muted, setMuted] = useState(false);
  const call = useRef<VoiceCall | null>(null);
  const ring = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!s.can('calls.receive')) return;
    const sock = getStaffSocket();
    const onIncoming = (c: any) => { setRinging(c); try { navigator.vibrate?.([300, 200, 300]); } catch { /* */ } };
    const onCancelled = (c: any) => setRinging((r: any) => (r?.callId === c.callId ? null : r));
    const onEnded = (c: any) => { if (call.current && call.current.callId === c.callId) { call.current.close(); call.current = null; setActive(null); setState(''); } };
    sock.on('call:incoming', onIncoming); sock.on('call:cancelled', onCancelled); sock.on('call:ended', onEnded);
    return () => { sock.off('call:incoming', onIncoming); sock.off('call:cancelled', onCancelled); sock.off('call:ended', onEnded); };
  }, [s]);
  useEffect(() => {
    if (!ringing) { ring.current?.pause(); return; }
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const t = setInterval(() => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.value = 0.06; o.frequency.value = 660; o.start(); setTimeout(() => o.stop(), 400); }, 1200);
    return () => { clearInterval(t); ctx.close(); };
  }, [ringing]);
  const answer = async (accept: boolean) => {
    const c = ringing; setRinging(null);
    const sock = getStaffSocket();
    if (!accept) { sock.emit('call:answer', { callId: c.callId, accept: false }); return; }
    if (!webrtcSupported()) { alert('This browser does not support voice calls. Please use a recent Chrome, Edge, Safari or Firefox.'); return; }
    const iceServers: RTCIceServer[] = await api('/r/ice-servers').then((r) => r.data.iceServers).catch(() => [{ urls: 'stun:stun.l.google.com:19302' }]);
    const v = new VoiceCall(sock, c.callId, iceServers, setState);
    await v.prepareAsCallee();
    sock.emit('call:answer', { callId: c.callId, accept: true }, (r: any) => {
      if (!r?.ok) { v.close(); alert(r?.error || 'Call no longer available'); return; }
      call.current = v; setActive({ callId: c.callId, customer: c.customer, table: c.table }); setState('connecting');
    });
  };
  if (ringing) return (
    <div className="modal-wrap"><div className="modal stack" style={{ textAlign: 'center' }}>
      <Phone size={32} style={{ margin: '0 auto' }} color="var(--brand)" />
      <h2 style={{ margin: 0 }}>Incoming call</h2><p className="muted" style={{ margin: 0 }}>{ringing.customer} · {ringing.table}</p>
      <div className="row" style={{ justifyContent: 'center' }}><button className="btn btn-danger" onClick={() => answer(false)}><PhoneOff size={16} /> Decline</button><button className="btn btn-primary" onClick={() => answer(true)}><Phone size={16} /> Answer</button></div>
    </div></div>
  );
  if (active) return (
    <div className="card row" style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 70, gap: 14 }}>
      <span className="badge badge-success">{state || 'connected'}</span><span className="small">{active.customer} · {active.table}</span>
      <button className="btn btn-sm" onClick={() => { const m = !muted; setMuted(m); call.current?.mute(m); }}>{muted ? <MicOff size={15} /> : <Mic size={15} />}</button>
      <button className="btn btn-sm btn-danger" onClick={() => { call.current?.hangup(); call.current = null; setActive(null); }}><PhoneOff size={15} /> End</button>
    </div>
  );
  return null;
}
