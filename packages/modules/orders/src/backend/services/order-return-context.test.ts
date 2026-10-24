import { describe, expect, it } from 'vitest';
import { returnContextFrom } from './order-return-context.js';

/**
 * Review of PR #423 (issue #417) — what an order charged is read from what it
 * stored, never recomputed with today's VAT method: a legacy order (placed
 * before 0.108.0, `vatMethod: null`) refunds what it actually charged.
 */
const order = (vatMethod: 'per_rate' | null, subtotal: string, taxTotal: string) =>
  ({
    salesChannelId: 'ch',
    placedByCustomerAccountId: 'acc',
    organizationId: 'org',
    currency: 'PLN',
    status: 'completed',
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    vatMethod,
    subtotal,
    taxTotal,
  }) as never;

const item = (id: string, unitPrice: string, quantity: number, taxRate: string, lineTotal: string) =>
  ({
    id,
    productId: `p-${id}`,
    productSnapshot: { name: id },
    quantity,
    unitPrice,
    taxRate,
    lineTotal,
    returnableAtPurchase: null,
  }) as never;

describe('returnContextFrom', () => {
  it('reports a legacy order’s stored line totals and products total, not today’s method', () => {
    // Placed before 0.108.0: 29.50 at 23 % stored 36.28 (binary `toFixed`), 0.70 at 5 % stored 0.73,
    // and the tax was the sum of exact taxes rounded once, 6.82 — products paid 37.02.
    const ctx = returnContextFrom(order(null, '30.20', '6.82'), [
      item('a', '29.50', 1, '0.2300', '36.28'),
      item('b', '0.70', 1, '0.0500', '0.73'),
    ]);
    expect(ctx.vatMethod).toBeNull();
    expect(ctx.productsPaidTotal).toBe('37.02');
    expect(ctx.lines.map((l) => [l.paidLineAmount, l.unitNetPrice, l.taxRate])).toEqual([
      [36.28, '29.50', '0.2300'],
      [0.73, '0.70', '0.0500'],
    ]);
  });

  it('reports an order placed under the per-rate method the same way, from what it stored', () => {
    const ctx = returnContextFrom(order('per_rate', '27.15', '2.17'), [item('a', '9.05', 3, '0.0800', '29.32')]);
    expect(ctx.vatMethod).toBe('per_rate');
    expect(ctx.productsPaidTotal).toBe('29.32');
    expect(ctx.lines[0]).toMatchObject({ paidLineAmount: 29.32, paidUnitAmount: 9.7733 });
  });
});
