'use client';
import { api } from './api';

/**
 * Receipt printing back-ends:
 *  - browser : system print dialog with an 58/80 mm receipt layout (works everywhere)
 *  - usb     : WebUSB (Chromium desktop/Android, HTTPS, printers exposing a bulk OUT endpoint — e.g. most ESC/POS USB printers)
 *  - bluetooth: Web Bluetooth BLE (Chromium on Android/desktop; BLE printers with a writable GATT characteristic). Classic SPP printers are not reachable from browsers.
 *  - network : raw TCP 9100 through the local print bridge (scripts/print-bridge.mjs) because browsers cannot open TCP sockets.
 */
export type Printer = { id: number; name: string; connection: 'browser' | 'usb' | 'bluetooth' | 'network'; address?: string | null; paper_width_mm: number; chars_per_line: number; encoding: string };

const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb'];
let usbDevice: any = null;
let bleChar: any = null;

export const support = () => ({
  usb: typeof navigator !== 'undefined' && 'usb' in navigator,
  bluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  secure: typeof window !== 'undefined' && window.isSecureContext,
});

async function usbWrite(bytes: Uint8Array) {
  const nav: any = navigator;
  if (!nav.usb) throw new Error('WebUSB is not supported in this browser. Use Chrome/Edge on desktop or Android, or choose browser printing.');
  if (!usbDevice) {
    const paired = await nav.usb.getDevices();
    usbDevice = paired[0] || await nav.usb.requestDevice({ filters: [{ classCode: 7 }, {}].slice(0, 1) }).catch(() => nav.usb.requestDevice({ filters: [] }));
  }
  if (!usbDevice.opened) await usbDevice.open();
  if (usbDevice.configuration === null) await usbDevice.selectConfiguration(1);
  const iface = usbDevice.configuration.interfaces.find((i: any) => i.alternate.endpoints.some((e: any) => e.direction === 'out' && e.type === 'bulk'));
  if (!iface) throw new Error('This USB device has no bulk OUT endpoint (not an ESC/POS printer?)');
  if (!iface.claimed) await usbDevice.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e: any) => e.direction === 'out' && e.type === 'bulk');
  for (let i = 0; i < bytes.length; i += 4096) await usbDevice.transferOut(ep.endpointNumber, bytes.slice(i, i + 4096));
}

async function bleWrite(bytes: Uint8Array) {
  const nav: any = navigator;
  if (!nav.bluetooth) throw new Error('Web Bluetooth is not supported in this browser. Use Chrome on Android/desktop, or a USB/network printer.');
  if (!bleChar) {
    const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    const server = await device.gatt.connect();
    for (const uuid of BLE_SERVICES) {
      try {
        const svc = await server.getPrimaryService(uuid);
        for (const ch of await svc.getCharacteristics()) if (ch.properties.write || ch.properties.writeWithoutResponse) { bleChar = ch; break; }
        if (bleChar) break;
      } catch { /* try next */ }
    }
    if (!bleChar) throw new Error('No writable print characteristic found on this Bluetooth device');
    device.addEventListener('gattserverdisconnected', () => { bleChar = null; });
  }
  for (let i = 0; i < bytes.length; i += 180) {
    const chunk = bytes.slice(i, i + 180);
    if (bleChar.properties.writeWithoutResponse) await bleChar.writeValueWithoutResponse(chunk); else await bleChar.writeValue(chunk);
  }
}

async function networkWrite(bytes: Uint8Array, address: string) {
  const bridge = process.env.NEXT_PUBLIC_PRINT_BRIDGE_URL || 'http://192.168.100.198:9123';
  const [host, port = '9100'] = address.split(':');
  const res = await fetch(`${bridge}/print?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`, { method: 'POST', body: bytes as any, headers: { 'content-type': 'application/octet-stream' } }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Print bridge not reachable at ${bridge}. Start it on this computer (see Printer setup guide).`);
}

export function browserPrint(text: string, widthMm = 80, logoUrl?: string | null) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) throw new Error('Pop-up blocked: allow pop-ups to print');
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  w.document.write(`<!doctype html><html><head><title>Receipt</title><style>@page{size:${widthMm}mm auto;margin:3mm}body{margin:0;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace}pre{white-space:pre-wrap;margin:0}img{max-width:40mm;margin:0 auto 4px;display:block}</style></head><body>${logoUrl ? `<img src="${logoUrl}" alt="">` : ''}<pre>${esc(text)}</pre><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script></body></html>`);
  w.document.close();
}

export async function printBytes(p: Printer, bytes: Uint8Array) {
  if (p.connection === 'usb') return usbWrite(bytes);
  if (p.connection === 'bluetooth') return bleWrite(bytes);
  if (p.connection === 'network') return networkWrite(bytes, p.address || '');
  throw new Error('Unsupported connection');
}

/** Print a bill receipt on the given printer, reporting success/failure back to the server. */
export async function printReceipt(billId: number, p: Printer | null, opts: { openDrawer?: boolean } = {}) {
  const printer = p ?? { id: 0, name: 'Browser', connection: 'browser', paper_width_mm: 80, chars_per_line: 48, encoding: 'cp437' } as Printer;
  try {
    if (printer.connection === 'browser') {
      const r = await api(`/r/bills/${billId}/receipt?width=${printer.chars_per_line}`);
      browserPrint(r.data.text, printer.paper_width_mm, r.data.logoUrl);
    } else {
      const res = await api<Response>(`/r/bills/${billId}/receipt?format=escpos&width=${printer.chars_per_line}&encoding=${printer.encoding}${opts.openDrawer ? '&drawer=1' : ''}`, { raw: true });
      await printBytes(printer, new Uint8Array(await res.arrayBuffer()));
    }
    if (printer.id) await api(`/r/printers/${printer.id}/status`, { body: { status: 'ok' } }).catch(() => undefined);
  } catch (e) {
    if (printer.id) await api(`/r/printers/${printer.id}/status`, { body: { status: 'failed' } }).catch(() => undefined);
    throw e;
  }
}

export async function testPrint(p: Printer) {
  if (p.connection === 'browser') {
    const res = await api<Response>(`/r/printers/test-page?width=${p.chars_per_line}`, { raw: true });
    browserPrint(await res.text(), p.paper_width_mm);
    return;
  }
  const res = await api<Response>(`/r/printers/test-page?format=escpos&width=${p.chars_per_line}&encoding=${p.encoding}`, { raw: true });
  await printBytes(p, new Uint8Array(await res.arrayBuffer()));
}
