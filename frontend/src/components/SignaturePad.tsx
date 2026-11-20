'use client';
import { useEffect, useRef, useState } from 'react';

/** Canvas signature capture (mouse, touch, pen). Emits a PNG data URL. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!; const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div>
      <canvas ref={ref} className="signature-pad" aria-label="Signature area"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); if (empty) setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; if (!empty) onChange(ref.current!.toDataURL('image/png')); }} />
      <div className="row-between small mt-s"><span className="muted">Sign with your finger, pen or mouse</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const c = ref.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); setEmpty(true); onChange(null); }}>Clear</button></div>
    </div>
  );
}
