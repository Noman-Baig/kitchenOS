import { D, Decimal, roundMoney } from '../lib/money.js';

/**
 * Pure bill calculation engine. No I/O: fully unit-tested.
 *
 * Rules
 * - line gross = (unit price + add-ons) × quantity; complimentary lines are 0.
 * - Discount (percent or fixed, capped at subtotal) is allocated to lines pro-rata.
 * - Percent taxes apply to the discounted base of the lines they cover
 *   (by item id / category id / order type). Inclusive taxes are extracted from
 *   the base (base × r / (1 + Σr_inclusive)); exclusive taxes are added on top.
 * - Fixed taxes are charged once per bill when at least one covered line exists.
 * - Every tax amount is rounded to the currency's minor unit.
 * - total = subtotal − discount + Σexclusive taxes + delivery charge.
 */
export interface CalcLine {
  key: string | number;
  itemId: number;
  categoryId: number;
  unitPrice: Decimal.Value;
  addonsTotal?: Decimal.Value;
  quantity: number;
  complimentary?: boolean;
}

export interface CalcTax {
  id: number;
  name: string;
  calcType: 'percent' | 'fixed';
  rate: Decimal.Value;
  inclusive: boolean;
  isLiability: boolean;
  appliesTo?: { itemIds?: number[]; categoryIds?: number[] } | null;
  orderTypes?: string[] | null;
  selected: boolean;
}

export interface CalcInput {
  currency: string;
  orderType: string;
  lines: CalcLine[];
  taxes: CalcTax[];
  discount?: { type: 'percent' | 'fixed'; value: Decimal.Value } | null;
  deliveryCharge?: Decimal.Value;
}

export interface CalcTaxResult {
  taxId: number; name: string; calcType: 'percent' | 'fixed'; rate: string; inclusive: boolean; isLiability: boolean;
  taxableAmount: string; amount: string;
}

export interface CalcResult {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;            // all tax amounts (inclusive + exclusive)
  exclusiveTaxTotal: string;
  inclusiveTaxTotal: string;
  liabilityTaxTotal: string;   // portion that is a tax liability (not revenue)
  deliveryCharge: string;
  total: string;
  netRevenue: string;          // total − liability taxes (what the business earns)
  taxes: CalcTaxResult[];
  lines: { key: string | number; gross: string; discount: string; net: string }[];
}

function taxApplies(t: CalcTax, line: CalcLine, orderType: string) {
  if (t.orderTypes && t.orderTypes.length && !t.orderTypes.includes(orderType)) return false;
  const a = t.appliesTo;
  if (!a || ((!a.itemIds || !a.itemIds.length) && (!a.categoryIds || !a.categoryIds.length))) return true;
  return (a.itemIds?.includes(line.itemId) ?? false) || (a.categoryIds?.includes(line.categoryId) ?? false);
}

export function calculateBill(input: CalcInput): CalcResult {
  const cur = input.currency;
  const lines = input.lines.map((l) => {
    const gross = l.complimentary ? D(0) : D(l.unitPrice).plus(D(l.addonsTotal ?? 0)).times(l.quantity);
    return { src: l, gross: roundMoney(gross, cur) };
  });
  const subtotal = lines.reduce((s, l) => s.plus(l.gross), D(0));

  let discountTotal = D(0);
  if (input.discount && D(input.discount.value).gt(0) && subtotal.gt(0)) {
    discountTotal = input.discount.type === 'percent'
      ? subtotal.times(Decimal.min(D(input.discount.value), 100)).div(100)
      : Decimal.min(D(input.discount.value), subtotal);
    discountTotal = roundMoney(discountTotal, cur);
  }

  // allocate discount pro-rata; last line absorbs rounding remainder
  let allocated = D(0);
  const withNet = lines.map((l, i) => {
    let disc = D(0);
    if (discountTotal.gt(0) && subtotal.gt(0)) {
      disc = i === lines.length - 1 ? discountTotal.minus(allocated) : roundMoney(discountTotal.times(l.gross).div(subtotal), cur);
      allocated = allocated.plus(disc);
    }
    return { ...l, discount: disc, net: l.gross.minus(disc) };
  });

  const active = input.taxes.filter((t) => t.selected);
  const taxResults: CalcTaxResult[] = [];

  for (const t of active) {
    const covered = withNet.filter((l) => taxApplies(t, l.src, input.orderType) && !l.src.complimentary);
    if (!covered.length) continue;
    const base = covered.reduce((s, l) => s.plus(l.net), D(0));
    let amount: Decimal;
    if (t.calcType === 'fixed') {
      amount = D(t.rate);
    } else if (t.inclusive) {
      // per line, extract using combined inclusive rate of all inclusive taxes covering that line
      amount = covered.reduce((s, l) => {
        const inclRates = active.filter((x) => x.inclusive && x.calcType === 'percent' && taxApplies(x, l.src, input.orderType)).reduce((r, x) => r.plus(D(x.rate)), D(0));
        return s.plus(l.net.times(D(t.rate)).div(D(100).plus(inclRates)));
      }, D(0));
    } else {
      amount = base.times(D(t.rate)).div(100);
    }
    amount = roundMoney(amount, cur);
    taxResults.push({
      taxId: t.id, name: t.name, calcType: t.calcType, rate: D(t.rate).toFixed(4), inclusive: t.inclusive && t.calcType === 'percent',
      isLiability: t.isLiability, taxableAmount: roundMoney(base, cur).toFixed(4), amount: amount.toFixed(4),
    });
  }

  const inclusiveTaxTotal = taxResults.filter((t) => t.inclusive).reduce((s, t) => s.plus(t.amount), D(0));
  const exclusiveTaxTotal = taxResults.filter((t) => !t.inclusive).reduce((s, t) => s.plus(t.amount), D(0));
  const liabilityTaxTotal = taxResults.filter((t) => t.isLiability).reduce((s, t) => s.plus(t.amount), D(0));
  const delivery = roundMoney(D(input.deliveryCharge ?? 0), cur);
  const total = subtotal.minus(discountTotal).plus(exclusiveTaxTotal).plus(delivery);

  return {
    subtotal: subtotal.toFixed(4),
    discountTotal: discountTotal.toFixed(4),
    taxTotal: inclusiveTaxTotal.plus(exclusiveTaxTotal).toFixed(4),
    exclusiveTaxTotal: exclusiveTaxTotal.toFixed(4),
    inclusiveTaxTotal: inclusiveTaxTotal.toFixed(4),
    liabilityTaxTotal: liabilityTaxTotal.toFixed(4),
    deliveryCharge: delivery.toFixed(4),
    total: total.toFixed(4),
    netRevenue: total.minus(liabilityTaxTotal).toFixed(4),
    taxes: taxResults,
    lines: withNet.map((l) => ({ key: l.src.key, gross: l.gross.toFixed(4), discount: l.discount.toFixed(4), net: l.net.toFixed(4) })),
  };
}

/** Split a total into parts. Remainder from rounding goes to the last part so parts always sum to total. */
export function splitEqual(total: Decimal.Value, parts: number, currency: string): string[] {
  if (parts < 1 || !Number.isInteger(parts)) throw new Error('parts must be a positive integer');
  const t = D(total);
  const each = roundMoney(t.div(parts), currency);
  const out = Array.from({ length: parts }, () => each);
  out[parts - 1] = t.minus(each.times(parts - 1));
  return out.map((d) => d.toFixed(4));
}

export function splitCustom(total: Decimal.Value, amounts: Decimal.Value[]): string[] {
  const sum = amounts.reduce<Decimal>((s, a) => s.plus(D(a)), D(0));
  if (!sum.eq(D(total))) throw new Error(`Custom split amounts (${sum.toFixed(2)}) must equal the bill total (${D(total).toFixed(2)})`);
  if (amounts.some((a) => D(a).lte(0))) throw new Error('Each split amount must be positive');
  return amounts.map((a) => D(a).toFixed(4));
}

/** Allocate a bill's total to a subset of lines (split by items), proportional share of discount & tax. */
export function splitByLines(calc: CalcResult, groups: (string | number)[][], currency: string): string[] {
  const netTotal = calc.lines.reduce((s, l) => s.plus(l.net), D(0));
  const total = D(calc.total);
  const parts = groups.map((keys) => {
    const net = calc.lines.filter((l) => keys.includes(l.key)).reduce((s, l) => s.plus(l.net), D(0));
    return netTotal.gt(0) ? roundMoney(total.times(net).div(netTotal), currency) : D(0);
  });
  const assignedKeys = new Set(groups.flat().map(String));
  if (calc.lines.some((l) => !assignedKeys.has(String(l.key)))) throw new Error('Every bill line must be assigned to a split part');
  const diff = total.minus(parts.reduce((s, p) => s.plus(p), D(0)));
  parts[parts.length - 1] = parts[parts.length - 1].plus(diff);
  return parts.map((p) => p.toFixed(4));
}
