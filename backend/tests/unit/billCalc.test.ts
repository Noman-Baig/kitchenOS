import { describe, expect, it } from 'vitest';
import { calculateBill, splitByLines, splitCustom, splitEqual } from '../../src/services/billCalc.js';
import { compactMoney, currencyDigits, formatMoney, roundMoney } from '../../src/lib/money.js';

const tax = (o: Partial<Parameters<typeof calculateBill>[0]['taxes'][number]>) => ({ id: 1, name: 'VAT', calcType: 'percent' as const, rate: '10', inclusive: false, isLiability: true, selected: true, ...o });

describe('bill calculation', () => {
  it('computes exclusive percentage taxes separately', () => {
    const r = calculateBill({ currency: 'USD', orderType: 'dine_in', lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '10.00', quantity: 3 }],
      taxes: [tax({ id: 1, name: 'GST', rate: '12' }), tax({ id: 2, name: 'Service', rate: '5', isLiability: false })] });
    expect(r.subtotal).toBe('30.0000');
    expect(r.taxes.map((t) => [t.name, t.amount])).toEqual([['GST', '3.6000'], ['Service', '1.5000']]);
    expect(r.total).toBe('35.1000');
    expect(r.liabilityTaxTotal).toBe('3.6000');
    expect(r.netRevenue).toBe('31.5000'); // service charge kept by restaurant is revenue; GST is not
  });

  it('extracts inclusive taxes without changing the total', () => {
    const r = calculateBill({ currency: 'AED', orderType: 'dine_in', lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '105.00', quantity: 1 }], taxes: [tax({ rate: '5', inclusive: true })] });
    expect(r.total).toBe('105.0000');
    expect(r.taxes[0].amount).toBe('5.0000');
    expect(r.netRevenue).toBe('100.0000');
  });

  it('applies discounts before tax and allocates them across lines', () => {
    const r = calculateBill({ currency: 'USD', orderType: 'dine_in', discount: { type: 'percent', value: '10' },
      lines: [{ key: 'a', itemId: 1, categoryId: 1, unitPrice: '20', quantity: 1 }, { key: 'b', itemId: 2, categoryId: 2, unitPrice: '10', quantity: 1 }], taxes: [tax({ rate: '10' })] });
    expect(r.discountTotal).toBe('3.0000');
    expect(r.taxes[0].amount).toBe('2.7000');
    expect(r.total).toBe('29.7000');
    expect(r.lines.reduce((s, l) => s + Number(l.discount), 0)).toBeCloseTo(3);
  });

  it('respects category scoping, order types, optional taxes and fixed taxes', () => {
    const r = calculateBill({ currency: 'USD', orderType: 'delivery',
      lines: [{ key: 1, itemId: 1, categoryId: 7, unitPrice: '10', quantity: 1 }, { key: 2, itemId: 2, categoryId: 8, unitPrice: '10', quantity: 1 }],
      taxes: [tax({ id: 1, name: 'Alcohol', rate: '20', appliesTo: { categoryIds: [7] } }), tax({ id: 2, name: 'Dine-in only', rate: '50', orderTypes: ['dine_in'] }),
        tax({ id: 3, name: 'Optional', rate: '50', selected: false }), tax({ id: 4, name: 'Packaging', calcType: 'fixed', rate: '1.25' })] });
    expect(r.taxes.map((t) => t.name)).toEqual(['Alcohol', 'Packaging']);
    expect(r.taxes[0].amount).toBe('2.0000');
    expect(r.total).toBe('23.2500');
  });

  it('never counts complimentary lines as revenue', () => {
    const r = calculateBill({ currency: 'USD', orderType: 'dine_in', lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '10', quantity: 2, complimentary: true }, { key: 2, itemId: 2, categoryId: 1, unitPrice: '5', quantity: 1 }], taxes: [tax({ rate: '10' })] });
    expect(r.subtotal).toBe('5.0000');
    expect(r.total).toBe('5.5000');
  });

  it('rounds to currency minor units (JPY 0, KWD 3)', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
    const r = calculateBill({ currency: 'JPY', orderType: 'dine_in', lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '999', quantity: 1 }], taxes: [tax({ rate: '8' })] });
    expect(r.taxes[0].amount).toBe('80.0000');
    expect(roundMoney('1.0005', 'KWD').toFixed(3)).toBe('1.001');
  });

  it('caps fixed discounts at the subtotal', () => {
    const r = calculateBill({ currency: 'USD', orderType: 'dine_in', discount: { type: 'fixed', value: '100' }, lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '10', quantity: 1 }], taxes: [] });
    expect(r.total).toBe('0.0000');
  });
});

describe('splits', () => {
  it('equal split sums exactly to the total', () => {
    const parts = splitEqual('100.00', 3, 'USD');
    expect(parts).toEqual(['33.3300', '33.3300', '33.3400']);
  });
  it('custom split must match the total', () => {
    expect(() => splitCustom('50', ['20', '20'])).toThrow();
    expect(splitCustom('50', ['20', '30'])).toEqual(['20.0000', '30.0000']);
  });
  it('split by items allocates tax and discount proportionally', () => {
    const calc = calculateBill({ currency: 'USD', orderType: 'dine_in', lines: [{ key: 1, itemId: 1, categoryId: 1, unitPrice: '30', quantity: 1 }, { key: 2, itemId: 2, categoryId: 1, unitPrice: '10', quantity: 1 }], taxes: [tax({ rate: '10' })] });
    expect(splitByLines(calc, [[1], [2]], 'USD')).toEqual(['33.0000', '11.0000']);
    expect(() => splitByLines(calc, [[1]], 'USD')).toThrow();
  });
});

describe('money formatting', () => {
  it('formats exact and compact values', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('$1,234.50');
    expect(compactMoney('1500', 'USD')).toBe('$1.5K');
    expect(compactMoney('2500000', 'EUR')).toBe('€2.5M');
    expect(compactMoney('3100000000', 'USD')).toBe('$3.1B');
    expect(compactMoney('4000000000000', 'USD')).toBe('$4T');
  });
});
