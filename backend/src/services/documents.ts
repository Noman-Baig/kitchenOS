import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { one } from '../lib/db.js';
import { D, formatMoney, currencyDigits } from '../lib/money.js';
import { getBranding } from './settings.js';
import { fileExists, readFileBuffer } from './storage.js';

export interface ReportColumn { key: string; label: string; type?: 'money' | 'number' | 'text' | 'date' | 'percent' }
export interface ReportData {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: { label: string; value: string; type?: 'money' | 'number' | 'text' }[];
  notes?: string[];
}
export interface ReportContext { restaurantName: string; currency: string; logoFileId?: number | null; periodLabel: string; timezone: string; locale?: string }

async function logoPng(fileId?: number | null): Promise<Buffer | null> {
  if (!fileId) return null;
  const f = await one<any>('SELECT storage_key FROM files WHERE id=?', [fileId]);
  if (!f || !fileExists(f.storage_key)) return null;
  try { return await sharp(await readFileBuffer(f.storage_key)).resize(160, 160, { fit: 'inside' }).png().toBuffer(); } catch { return null; }
}

function cell(v: unknown, type: ReportColumn['type'], currency: string, locale = 'en') {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return formatMoney(String(v), currency, locale);
  if (type === 'percent') return `${D(String(v)).toFixed(2)}%`;
  if (type === 'number') return D(String(v)).toDecimalPlaces(4).toString();
  if (type === 'date' && v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return String(v);
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export async function reportPdf(data: ReportData, ctx: ReportContext): Promise<Buffer> {
  const b = await getBranding();
  const landscape = data.columns.length > 6;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: `${data.title} — ${ctx.restaurantName}`, Author: ctx.restaurantName, Creator: b.softwareName } });
  const logo = await logoPng(ctx.logoFileId);
  const width = doc.page.width - 80;
  if (logo) doc.image(logo, 40, 36, { fit: [48, 48] });
  const hx = logo ? 98 : 40;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(ctx.restaurantName, hx, 40);
  doc.font('Helvetica').fontSize(11).fillColor('#444').text(data.title, hx, 60);
  doc.fontSize(8.5).fillColor('#666').text(`Period: ${ctx.periodLabel}   ·   Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC   ·   Currency: ${ctx.currency}   ·   Timezone: ${ctx.timezone}`, hx, 76);
  doc.moveTo(40, 96).lineTo(40 + width, 96).strokeColor(b.primaryColor).lineWidth(1.5).stroke();
  let y = 108;
  if (data.summary?.length) {
    const colW = width / Math.min(4, data.summary.length);
    data.summary.forEach((s, i) => {
      const x = 40 + (i % 4) * colW;
      if (i % 4 === 0 && i > 0) y += 36;
      doc.font('Helvetica').fontSize(8).fillColor('#666').text(s.label, x, y, { width: colW - 8 });
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(s.type === 'money' ? formatMoney(s.value, ctx.currency, ctx.locale) : s.value, x, y + 11, { width: colW - 8 });
    });
    y += 42;
  }
  const cols = data.columns;
  const colWidth = width / cols.length;
  const header = () => {
    doc.rect(40, y, width, 18).fill('#f3f4f6');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    cols.forEach((c, i) => doc.text(c.label, 44 + i * colWidth, y + 5, { width: colWidth - 8, align: c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'right' : 'left', ellipsis: true }));
    y += 20;
  };
  header();
  doc.font('Helvetica').fontSize(8).fillColor('#222');
  for (const row of data.rows) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; header(); doc.font('Helvetica').fontSize(8).fillColor('#222'); }
    cols.forEach((c, i) => doc.text(cell(row[c.key], c.type, ctx.currency, ctx.locale), 44 + i * colWidth, y, { width: colWidth - 8, align: c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'right' : 'left', ellipsis: true, lineBreak: false }));
    y += 14;
    doc.moveTo(40, y - 3).lineTo(40 + width, y - 3).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  if (!data.rows.length) { doc.fillColor('#888').text('No records for this period.', 44, y); y += 16; }
  for (const n of data.notes || []) { y += 6; doc.fillColor('#666').fontSize(7.5).text(n, 40, y, { width }); y = doc.y; }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#999').text(`${ctx.restaurantName} · Powered by ${b.softwareName} · Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, { width, align: 'center', lineBreak: false });
  }
  return pdfToBuffer(doc);
}

export async function reportXlsx(data: ReportData, ctx: ReportContext): Promise<Buffer> {
  const b = await getBranding();
  const wb = new ExcelJS.Workbook();
  wb.creator = b.softwareName;
  wb.created = new Date();
  const ws = wb.addWorksheet(data.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const digits = currencyDigits(ctx.currency);
  const moneyFmt = `#,##0${digits ? '.' + '0'.repeat(digits) : ''}`;
  ws.addRow([ctx.restaurantName]).font = { bold: true, size: 14 };
  ws.addRow([data.title]).font = { size: 12 };
  ws.addRow([`Period: ${ctx.periodLabel}`, `Generated: ${new Date().toISOString()}`, `Currency: ${ctx.currency}`]);
  ws.addRow([]);
  if (data.summary?.length) {
    for (const s of data.summary) {
      const r = ws.addRow([s.label, s.type === 'money' ? Number(D(s.value).toFixed(digits)) : s.value]);
      if (s.type === 'money') r.getCell(2).numFmt = moneyFmt;
    }
    ws.addRow([]);
  }
  const hr = ws.addRow(data.columns.map((c) => c.label));
  hr.font = { bold: true };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; c.border = { bottom: { style: 'thin' } }; });
  for (const row of data.rows) {
    const r = ws.addRow(data.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return '';
      // exact values: decimals are written at currency precision, not compact notation
      if (c.type === 'money') return Number(D(String(v)).toFixed(digits));
      if (c.type === 'number' || c.type === 'percent') return Number(D(String(v)).toFixed(4));
      return v instanceof Date ? v : String(v);
    }));
    data.columns.forEach((c, i) => { if (c.type === 'money') r.getCell(i + 1).numFmt = moneyFmt; });
  }
  data.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(40, c.label.length + 6)); });
  ws.addRow([]);
  ws.addRow([`Powered by ${b.softwareName}`]).font = { italic: true, color: { argb: 'FF888888' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------- Receipts ------------------------------- */

export interface ReceiptData {
  restaurant: { name: string; address?: string | null; phone?: string | null; email?: string | null; logoFileId?: number | null };
  billNo: string; dateText: string; cashier?: string | null; tableText?: string | null; orderType: string;
  currency: string; locale?: string;
  lines: { name: string; qty: number; unit: string; total: string; complimentary?: boolean }[];
  subtotal: string; discount: string; taxes: { name: string; rate: string; amount: string; inclusive: boolean }[];
  deliveryCharge: string; total: string; paid: string; balance: string; payments: { method: string; amount: string }[];
  footer?: string | null; poweredBy: string;
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s);
const center = (s: string, n: number) => { const t = s.slice(0, n); const l = Math.floor((n - t.length) / 2); return ' '.repeat(l) + t; };

export function receiptText(d: ReceiptData, width = 48) {
  const m = (v: string) => D(v).toFixed(currencyDigits(d.currency));
  const row = (l: string, r: string) => pad(l, width - r.length - 1) + ' ' + r;
  const out: string[] = [];
  out.push(center(d.restaurant.name.toUpperCase(), width));
  if (d.restaurant.address) out.push(center(d.restaurant.address, width));
  if (d.restaurant.phone) out.push(center(d.restaurant.phone, width));
  out.push('-'.repeat(width));
  out.push(row(`Receipt: ${d.billNo}`, ''));
  out.push(row(d.dateText, d.orderType.replace('_', ' ')));
  if (d.tableText) out.push(row(d.tableText, ''));
  if (d.cashier) out.push(row(`Cashier: ${d.cashier}`, ''));
  out.push('-'.repeat(width));
  for (const l of d.lines) {
    out.push(pad(l.name, width));
    out.push(row(`  ${l.qty} x ${m(l.unit)}${l.complimentary ? ' (comp)' : ''}`, m(l.total)));
  }
  out.push('-'.repeat(width));
  out.push(row('Subtotal', m(d.subtotal)));
  if (D(d.discount).gt(0)) out.push(row('Discount', '-' + m(d.discount)));
  for (const t of d.taxes) out.push(row(`${t.name} ${D(t.rate).toDecimalPlaces(2)}%${t.inclusive ? ' (incl.)' : ''}`, m(t.amount)));
  if (D(d.deliveryCharge).gt(0)) out.push(row('Delivery', m(d.deliveryCharge)));
  out.push('='.repeat(width));
  out.push(row(`TOTAL ${d.currency}`, m(d.total)));
  for (const p of d.payments) out.push(row(`Paid (${p.method})`, m(p.amount)));
  out.push(row('Balance', m(d.balance)));
  out.push('-'.repeat(width));
  if (d.footer) out.push(center(d.footer, width));
  out.push(center(`Powered by ${d.poweredBy}`, width));
  return out.join('\n');
}

/** ESC/POS byte stream (init, text, feed, partial cut). Non-ASCII is transliterated for single-byte code pages. */
// Code page tables for the upper half (0x80-0xFF). Characters outside the table are transliterated.
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
const CODE_PAGES: Record<string, { table: string; escT: number }> = {
  cp437: { table: CP437_HIGH, escT: 0 },
  cp850: { table: CP850_HIGH, escT: 2 },
  cp858: { table: CP850_HIGH.replace('ı', '€'), escT: 19 },
};

/** Encode text for a single-byte ESC/POS code page, transliterating anything it cannot represent. */
export function encodeCodePage(text: string, encoding: string): Buffer {
  const cp = CODE_PAGES[encoding] ?? CODE_PAGES.cp437;
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 0x20 && c < 0x7f)) { out.push(c); continue; }
    const idx = cp.table.indexOf(ch);
    if (idx >= 0) { out.push(0x80 + idx); continue; }
    const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    out.push(base.length === 1 && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) < 0x7f ? base.charCodeAt(0) : 0x3f);
  }
  return Buffer.from(out);
}

export function receiptEscPos(d: ReceiptData, width = 48, encoding = 'cp437', opts: { openDrawer?: boolean } = {}): Buffer {
  const ESC = 0x1b, GS = 0x1d;
  const text = receiptText(d, width);
  const utf8 = encoding === 'utf8';
  const body = utf8 ? Buffer.from(text, 'utf8') : encodeCodePage(text, encoding);
  const parts = [
    Buffer.from([ESC, 0x40]),                                            // init
    utf8 ? Buffer.alloc(0) : Buffer.from([ESC, 0x74, (CODE_PAGES[encoding] ?? CODE_PAGES.cp437).escT]), // select code page
    Buffer.from([ESC, 0x61, 0x00]),                                      // align left
    body,
    Buffer.from('\n\n\n\n', 'ascii'),
    Buffer.from([GS, 0x56, 0x42, 0x00]),                                 // partial cut with feed
  ];
  if (opts.openDrawer) parts.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa])); // pulse drawer pin 2
  return Buffer.concat(parts);
}

export async function invoicePdf(d: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${d.billNo}`, Author: d.restaurant.name, Creator: d.poweredBy } });
  const logo = await logoPng(d.restaurant.logoFileId);
  if (logo) doc.image(logo, 50, 45, { fit: [56, 56] });
  const x = logo ? 116 : 50;
  doc.font('Helvetica-Bold').fontSize(18).text(d.restaurant.name, x, 48);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text([d.restaurant.address, d.restaurant.phone, d.restaurant.email].filter(Boolean).join('  ·  '), x, 72);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text('INVOICE / RECEIPT', 50, 120);
  doc.font('Helvetica').fontSize(9).text(`No. ${d.billNo}`, 50, 138).text(d.dateText).text(d.tableText || '').text(d.cashier ? `Cashier: ${d.cashier}` : '');
  let y = 200;
  const money = (v: string) => formatMoney(v, d.currency, d.locale);
  doc.rect(50, y, 495, 18).fill('#f3f4f6'); doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
  doc.text('Item', 56, y + 5).text('Qty', 330, y + 5, { width: 40, align: 'right' }).text('Unit', 375, y + 5, { width: 80, align: 'right' }).text('Total', 460, y + 5, { width: 80, align: 'right' });
  y += 24; doc.font('Helvetica').fontSize(9);
  for (const l of d.lines) {
    doc.text(l.name + (l.complimentary ? ' (complimentary)' : ''), 56, y, { width: 270 }).text(String(l.qty), 330, y, { width: 40, align: 'right' }).text(money(l.unit), 375, y, { width: 80, align: 'right' }).text(money(l.total), 460, y, { width: 80, align: 'right' });
    y += 16;
    if (y > 720) { doc.addPage(); y = 50; }
  }
  y += 8; doc.moveTo(330, y).lineTo(545, y).strokeColor('#ddd').stroke(); y += 8;
  const tot = (label: string, v: string, bold = false) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 330, y, { width: 125, align: 'right' }).text(v, 460, y, { width: 80, align: 'right' }); y += 15; };
  tot('Subtotal', money(d.subtotal));
  if (D(d.discount).gt(0)) tot('Discount', '-' + money(d.discount));
  for (const t of d.taxes) tot(`${t.name} (${D(t.rate).toDecimalPlaces(2)}%${t.inclusive ? ', incl.' : ''})`, money(t.amount));
  if (D(d.deliveryCharge).gt(0)) tot('Delivery', money(d.deliveryCharge));
  tot('Total', money(d.total), true);
  for (const p of d.payments) tot(`Paid — ${p.method}`, money(p.amount));
  tot('Balance due', money(d.balance), true);
  if (d.footer) doc.font('Helvetica').fontSize(9).fillColor('#555').text(d.footer, 50, y + 20, { width: 495, align: 'center' });
  doc.fontSize(7).fillColor('#999').text(`Powered by ${d.poweredBy}`, 50, 790, { width: 495, align: 'center' });
  return pdfToBuffer(doc);
}

export async function agreementPdf(p: {
  softwareName: string; agreementTitle: string; version: string; body: string; restaurantName: string;
  signerName: string; signerTitle?: string | null; signerEmail: string; signedAt: Date; ip?: string | null;
  contentHash: string; signaturePng: Buffer; platformSignature?: string | null; keyId?: string | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${p.agreementTitle} v${p.version} — ${p.restaurantName}`, Creator: p.softwareName } });
  doc.font('Helvetica-Bold').fontSize(16).text(p.agreementTitle);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Version ${p.version} · between ${p.softwareName} (platform) and ${p.restaurantName}`);
  doc.moveDown().fillColor('#111').fontSize(10).text(p.body, { align: 'left', lineGap: 2 });
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(13).text('Electronic acceptance record');
  doc.moveDown(0.5).font('Helvetica').fontSize(10)
    .text(`Restaurant: ${p.restaurantName}`)
    .text(`Authorised representative: ${p.signerName}${p.signerTitle ? ', ' + p.signerTitle : ''}`)
    .text(`Email: ${p.signerEmail}`)
    .text(`Signed at (UTC): ${p.signedAt.toISOString()}`)
    .text(`IP address: ${p.ip || 'not recorded'}`)
    .text(`Agreement version: ${p.version}`)
    .text(`SHA-256 of agreement text + acceptance data: ${p.contentHash}`);
  if (p.platformSignature) doc.text(`Platform signature (${p.keyId}): ${p.platformSignature}`, { width: 480 });
  doc.moveDown().text('Signature:');
  const png = await sharp(p.signaturePng).flatten({ background: '#ffffff' }).png().toBuffer();
  doc.image(png, { fit: [260, 110] });
  doc.moveDown(8).fontSize(8).fillColor('#777').text('This record documents an electronic acceptance. Its legal effect depends on the laws of the applicable jurisdiction; obtain jurisdiction-specific legal review where required.', { width: 480 });
  return pdfToBuffer(doc);
}
