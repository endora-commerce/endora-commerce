import { describe, expect, it } from 'vitest';
import { keptDiscount, keptOrderLines, retainedOnReturnLines } from './kept-quantities.js';

/**
 * Issue #435 — an invoice issued after a return lists what the buyer kept
 * (product-owner ruling of 2026-11-07).
 */
const line = (id: string, quantity: number) => ({ id, quantity });

describe('keptOrderLines', () => {
  it('leaves every line as ordered when nothing came back', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [])).toEqual([
      { item: line('a', 3), quantity: 3 },
      { item: line('b', 1), quantity: 1 },
    ]);
  });

  it('takes the returned quantity off a line returned in part', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'a', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 2 },
      { item: line('b', 1), quantity: 1 },
    ]);
  });

  it('drops a line returned in full', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'b', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });

  it('sums two returns of one line, and never keeps less than nothing', () => {
    expect(
      keptOrderLines(
        [line('a', 3)],
        [
          { orderItemId: 'a', quantity: 2, discount: '0.00' },
          { orderItemId: 'a', quantity: 2, discount: '0.00' },
        ],
      ),
    ).toEqual([]);
  });

  it('ignores a returned quantity for a line the order does not have', () => {
    expect(keptOrderLines([line('a', 3)], [{ orderItemId: 'z', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });
});

/** Ruling Q3 of 2026-11-07 — the discount line carries only the kept goods' share. */
describe('keptDiscount', () => {
  const back = (discount: string) => ({ orderItemId: 'a', quantity: 1, discount });

  it('is the order discount when nothing came back', () => {
    expect(keptDiscount('6.94', [])).toBe('6.94');
  });

  it('is the order discount less what the returns carried back', () => {
    expect(keptDiscount('6.94', [back('2.31'), back('2.32')])).toBe('2.31');
  });

  it('is zero when the returns carried it all back, and never negative', () => {
    expect(keptDiscount('6.94', [back('2.31'), back('2.32'), back('2.31')])).toBe('0.00');
    expect(keptDiscount('1.00', [back('2.31')])).toBe('0.00');
  });

  it('is zero for an order without a discount', () => {
    expect(keptDiscount('0.00', [back('0.00')])).toBe('0.00');
  });
});

/**
 * Issue #854, owner ruling of 2026-11-07 — the amount withheld on a return is
 * part of the goods' price, at the goods' VAT rate: one line per order line
 * something was withheld from, at that line's rate, its net from the rate
 * row's target (`grossPartsAtRowTarget`).
 */
describe('retainedOnReturnLines', () => {
  const item = (id: string, quantity: number, unitPrice: string, taxRate = '0.2300') => ({ id, quantity, unitPrice, taxRate });
  const back = (orderItemId: string, quantity: number, retained?: string) => ({
    orderItemId,
    quantity,
    discount: '0.00',
    ...(retained !== undefined ? { retained } : {}),
  });
  const shape = (rows: ReturnType<typeof retainedOnReturnLines>) =>
    rows.map((r) => ({ id: r.item.id, rate: r.rate, gross: r.gross, net: r.net, exact: r.exact }));

  it('is empty when nothing was withheld, or the reader says nothing about it', () => {
    const items = [item('a', 3, '10.00')];
    expect(retainedOnReturnLines(items, [back('a', 1, '0.00')])).toEqual([]);
    expect(retainedOnReturnLines(items, [back('a', 1)])).toEqual([]);
  });

  it('nets the withheld gross against the kept goods at the line rate', () => {
    // Kept 2 × 10.00 + 1 × 20.00 = 40.00 net, 49.20 gross; 2.30 withheld → row 51.50 = 41.87 + 9.63.
    const items = [item('a', 3, '10.00'), item('b', 1, '20.00')];
    expect(shape(retainedOnReturnLines(items, [back('a', 1, '2.30')]))).toEqual([
      { id: 'a', rate: '0.23', gross: '2.30', net: '1.87', exact: true },
    ]);
  });

  it('is the whole gross at the rate when the line came back in full and nothing else is kept there', () => {
    expect(shape(retainedOnReturnLines([item('a', 1, '20.00')], [back('a', 1, '6.15')]))).toEqual([
      { id: 'a', rate: '0.23', gross: '6.15', net: '5.00', exact: true },
    ]);
  });

  it('one line per order line, each at its own rate, in the order of the order', () => {
    const items = [item('a', 2, '10.00'), item('c', 1, '50.00', '0.0800'), item('b', 2, '10.00')];
    expect(shape(retainedOnReturnLines(items, [back('b', 1, '1.23'), back('c', 1, '5.40'), back('a', 1, '1.23')]))).toEqual([
      { id: 'a', rate: '0.23', gross: '1.23', net: '1.00', exact: true },
      { id: 'c', rate: '0.08', gross: '5.40', net: '5.00', exact: true },
      { id: 'b', rate: '0.23', gross: '1.23', net: '1.00', exact: true },
    ]);
  });

  it('sums two returns of one line', () => {
    expect(shape(retainedOnReturnLines([item('a', 3, '10.00')], [back('a', 1, '1.23'), back('a', 1, '1.23')]))).toEqual([
      { id: 'a', rate: '0.23', gross: '2.46', net: '2.00', exact: true },
    ]);
  });

  it('answers the nearest net when no net carries the row gross (owner ruling E1)', () => {
    expect(shape(retainedOnReturnLines([item('a', 1, '1.00')], [back('a', 1, '0.03')]))).toEqual([
      { id: 'a', rate: '0.23', gross: '0.03', net: '0.02', exact: false },
    ]);
  });

  it('ignores a line the order does not have', () => {
    expect(retainedOnReturnLines([item('a', 1, '1.00')], [back('z', 1, '1.00')])).toEqual([]);
  });
});
