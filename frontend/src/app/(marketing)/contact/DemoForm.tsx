'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export function DemoForm() {
  const [f, setF] = useState({ name: '', email: '', phone: '', restaurantName: '', country: '', message: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  if (state === 'done') return <div className="alert alert-success">Thank you — we will be in touch shortly.</div>;
  return (
    <form className="form-grid" onSubmit={async (e) => {
      e.preventDefault(); setState('busy');
      try { await api('/public/demo-requests', { body: f }); setState('done'); } catch (x: any) { setErr(x.message); setState('error'); }
    }}>
      <h2 className="full" style={{ margin: 0 }}>Request a demo</h2>
      <label className="field">Name *<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field">Email *<input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field">Phone<input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <label className="field">Restaurant<input className="input" value={f.restaurantName} onChange={(e) => setF({ ...f, restaurantName: e.target.value })} /></label>
      <label className="field full">Country<input className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></label>
      <label className="field full">What would you like to see?<textarea className="input" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      {state === 'error' && <div className="error-text full">{err}</div>}
      <div className="full"><button className="btn btn-primary" disabled={state === 'busy'}>Send request</button></div>
      <p className="tiny muted full" style={{ margin: 0 }}>We use these details only to respond to your request. See our <a className="link" href="/privacy">Privacy Policy</a>.</p>
    </form>
  );
}
