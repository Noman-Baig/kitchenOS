/** Currency-aware formatting. Display can be compact (1.2K/3.4M/1B/2T); invoices & exports always use exact values. */
export function digits(currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}
export function money(v: string | number | null | undefined, currency = 'USD', locale?: string) {
  const n = Number(v ?? 0);
  const d = digits(currency);
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n); }
  catch { return `${currency} ${n.toFixed(d)}`; }
}
export function compact(v: string | number | null | undefined, currency = 'USD', locale?: string) {
  const n = Number(v ?? 0);
  const abs = Math.abs(n);
  if (abs < 1000) return money(n, currency, locale);
  let symbol = currency;
  try { symbol = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value || currency; } catch { /* code */ }
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [div, s] of units) if (abs >= div) return `${n < 0 ? '-' : ''}${symbol}${(Math.round((abs / div) * 10) / 10).toString()}${s}`;
  return money(n, currency, locale);
}
export function dt(v: string | Date | null | undefined, tz?: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!v) return '—';
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(new Date(v)); } catch { return String(v); }
}
export function dateOnly(v: string | Date | null | undefined, tz?: string) { return dt(v, tz, { dateStyle: 'medium' }); }
export function timeOnly(v: string | Date | null | undefined, tz?: string) { return dt(v, tz, { timeStyle: 'short' }); }
export function ago(v: string | Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(v).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}
export const titleCase = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const num = (v: unknown, dp = 2) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: dp });
