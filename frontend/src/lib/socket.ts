'use client';
import { useEffect, useRef, useState as useStateCompat } from 'react';
import { io, type Socket } from 'socket.io-client';

const base = () => process.env.NEXT_PUBLIC_SOCKET_URL || (typeof window !== 'undefined' ? window.location.origin : '');
let staffSocket: Socket | null = null;

/** Single shared staff socket (cookie-authenticated). Reconnects automatically; listeners resync on 'connect'. */
export function getStaffSocket() {
  if (!staffSocket) staffSocket = io(base(), { path: '/realtime', addTrailingSlash: false, withCredentials: true, reconnectionDelayMax: 8000 });
  return staffSocket;
}
export function closeStaffSocket() { staffSocket?.close(); staffSocket = null; }

export function customerSocket(token: string) {
  return io(base(), { path: '/realtime', addTrailingSlash: false, auth: { customerToken: token }, reconnectionDelayMax: 8000 });
}

/** De-duplicates events by eventId (events may be re-delivered after a reconnect). */
const seen = new Set<string>();
export function dedupe(e: any) {
  if (!e?.eventId) return true;
  if (seen.has(e.eventId)) return false;
  seen.add(e.eventId);
  if (seen.size > 2000) seen.clear();
  return true;
}

/** Subscribe to staff events; `onResync` runs on every (re)connect so screens reload authoritative state. */
export function useStaffEvents(events: Record<string, (p: any) => void>, onResync?: () => void) {
  const ref = useRef(events); ref.current = events;
  const sync = useRef(onResync); sync.current = onResync;
  useEffect(() => {
    const s = getStaffSocket();
    const handlers = Object.keys(ref.current).map((ev) => { const h = (p: any) => { if (dedupe(p)) ref.current[ev]?.(p); }; s.on(ev, h); return [ev, h] as const; });
    const onConnect = () => sync.current?.();
    s.on('connect', onConnect);
    return () => { handlers.forEach(([ev, h]) => s.off(ev, h)); s.off('connect', onConnect); };
  }, []);
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); setTimeout(() => { o.frequency.value = 1175; }, 120); setTimeout(() => { o.stop(); ctx.close(); }, 260);
  } catch { /* audio blocked until user interaction */ }
}

/** Live connection state for the shared staff socket. */
export function useSocketStatus() {
  const [up, setUp] = useStateCompat(false);
  useEffect(() => {
    const s = getStaffSocket();
    const on = () => setUp(true); const off = () => setUp(false);
    setUp(s.connected); s.on('connect', on); s.on('disconnect', off); s.io.on('reconnect_attempt', off);
    return () => { s.off('connect', on); s.off('disconnect', off); s.io.off('reconnect_attempt', off); };
  }, [setUp]);
  return up;
}
