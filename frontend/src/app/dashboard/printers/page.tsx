'use client';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { Status, useToast } from '@/components/ui';
import { support, testPrint } from '@/lib/print';
import { dt } from '@/lib/format';
import { api } from '@/lib/api';

export default function Printers() {
  const toast = useToast();
  const stations = useOptions('/r/stations');
  const sup = typeof window !== 'undefined' ? support() : { usb: false, bluetooth: false, secure: false };
  return (
    <div className="page">
      <div className="alert small mb">This browser: WebUSB {sup.usb ? 'available' : 'not available'} · Web Bluetooth {sup.bluetooth ? 'available' : 'not available'} · {sup.secure ? 'secure context (HTTPS)' : 'not HTTPS — USB/Bluetooth require HTTPS'}. Network printers require the local print bridge. See <a className="link" href="/help/printers" target="_blank">printer guide</a>.</div>
      <ResourcePage title="Printers" endpoint="/r/printers" searchable={false}
        fields={[
          { name: 'name', label: 'Name', required: true }, { name: 'connection', label: 'Connection', type: 'select', required: true, options: [{ value: 'browser', label: 'Browser print dialog' }, { value: 'usb', label: 'USB (WebUSB)' }, { value: 'bluetooth', label: 'Bluetooth LE (Web Bluetooth)' }, { value: 'network', label: 'Network via print bridge' }] },
          { name: 'address', label: 'Network address (IP:port)', placeholder: '192.168.1.50:9100', nullable: true },
          { name: 'paper_width_mm', label: 'Paper width', type: 'select', required: true, options: [{ value: 80, label: '80 mm' }, { value: 58, label: '58 mm' }] },
          { name: 'chars_per_line', label: 'Characters per line', type: 'number', required: true, hint: '48 for 80 mm, 32 for 58 mm (typical)' },
          { name: 'encoding', label: 'Character encoding', type: 'select', required: true, options: [{ value: 'cp437', label: 'CP437 (most ESC/POS)' }, { value: 'cp858', label: 'CP858 (Euro sign)' }, { value: 'utf8', label: 'UTF-8 (modern printers)' }] },
          { name: 'purpose', label: 'Used for', type: 'select', required: true, options: [{ value: 'receipt', label: 'Receipts' }, { value: 'kitchen', label: 'Kitchen tickets' }, { value: 'both', label: 'Both' }] },
          { name: 'station_id', label: 'Kitchen station', type: 'select', options: stations, nullable: true }, { name: 'is_default', label: 'Default receipt printer', type: 'checkbox' },
        ]}
        defaults={{ connection: 'browser', paper_width_mm: 80, chars_per_line: 48, encoding: 'cp437', purpose: 'receipt' }}
        transform={(d) => ({ ...d, paper_width_mm: Number(d.paper_width_mm) })}
        columns={[{ key: 'name', label: 'Printer', render: (r) => <strong>{r.name}{r.is_default ? ' ★' : ''}</strong> }, { key: 'connection', label: 'Connection' }, { key: 'paper', label: 'Paper', render: (r) => `${r.paper_width_mm} mm · ${r.chars_per_line} chars` }, { key: 'last_status', label: 'Last test', render: (r) => r.last_status ? <><Status value={r.last_status} /> <span className="tiny muted">{dt(r.last_test_at)}</span></> : '—' }]}
        extraActions={(r, reload) => <button className="btn btn-sm" onClick={async () => { try { await testPrint(r); await api(`/r/printers/${r.id}/status`, { body: { status: 'ok' } }); toast('Test page sent'); } catch (e: any) { toast(e.message, 'error'); await api(`/r/printers/${r.id}/status`, { body: { status: 'failed' } }).catch(() => undefined); } reload(); }}>Test print</button>} />
    </div>
  );
}
