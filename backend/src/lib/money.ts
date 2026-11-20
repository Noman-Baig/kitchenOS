import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value;

export const D = (v: Num | null | undefined) => new Decimal(v === null || v === undefined || v === '' ? 0 : v);

const digitsCache = new Map<string, number>();
/** ISO 4217 minor-unit digits, derived from Intl (e.g. JPY=0, KWD=3, USD=2). */
export function currencyDigits(currency: string): number {
  const c = (currency || 'USD').toUpperCase();
  if (digitsCache.has(c)) return digitsCache.get(c)!;
  let d = 2;
  try {
    d = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch { d = 2; }
  digitsCache.set(c, d);
  return d;
}

export function roundMoney(v: Num, currency: string): Decimal {
  return D(v).toDecimalPlaces(currencyDigits(currency), Decimal.ROUND_HALF_UP);
}

/** String with 4 dp for storage in DECIMAL(19,4). */
export const s4 = (v: Num) => D(v).toFixed(4);

export function isValidCurrency(code: string) {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch { return false; }
}

/** Exact formatting for invoices / exports. */
export function formatMoney(v: Num, currency: string, locale = 'en') {
  const digits = currencyDigits(currency);
  const fixed = D(v).toFixed(digits);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(fixed));
  } catch {
    return `${currency} ${fixed}`;
  }
}

/** Compact display (1.2K, 3.4M, 1.1B, 2T) — display only, never for invoices/exports. */
export function compactMoney(v: Num, currency: string, locale = 'en') {
  const n = D(v);
  const abs = n.abs();
  const units: [Decimal, string][] = [[D('1e12'), 'T'], [D('1e9'), 'B'], [D('1e6'), 'M'], [D('1e3'), 'K']];
  let symbol = currency;
  try {
    symbol = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value || currency;
  } catch { /* keep code */ }
  for (const [div, suffix] of units) {
    if (abs.gte(div)) return `${n.isNeg() ? '-' : ''}${symbol}${abs.div(div).toDecimalPlaces(1).toString()}${suffix}`;
  }
  return formatMoney(n, currency, locale);
}
