import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { returnContextFrom } from './order-return-context.js';

/**
 * Review of PR #423 (issue #417) — what an order charged is read from what it
 * stored, never recomputed with today's VAT method: a legacy order (placed
 * before 0.108.0, `vatMethod: null`) refunds what it actually charged.
 */
const order = (vatMethod: 'per_rate' | null, subtotal: string, taxTotal: string, discountTotal = '0.00') =>
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
    discountTotal,
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

  it('takes the order-level discount off what the products were charged (review of PR #423)', () => {
    // 100.00 net + 23.00 VAT, a 50.00 discount on the gross, 10.00 delivery: 83.00 captured.
    // The products were charged 73.00 — not 123.00, and not the 83.00 that includes the delivery.
    const ctx = returnContextFrom(order('per_rate', '100.00', '23.00', '50.00'), [item('a', '100.00', 1, '0.2300', '123.00')]);
    expect([ctx.productsPaidTotal, ctx.discountTotal]).toEqual(['73.00', '50.00']);
  });

  it('reports the delivery cost and the payment surcharge as stored (issue #876)', () => {
    // A consumer's withdrawal from the whole sale refunds both (Directive 2011/83 art. 13(1)).
    const base = order('per_rate', '100.00', '23.00') as unknown as Record<string, unknown>;
    const ctx = returnContextFrom(
      { ...base, deliveryTotal: '15.99', paymentMethodSnapshot: { code: 'cod', name: 'COD', kind: 'cash_on_delivery', additionalPrice: 2.5 } } as never,
      [item('a', '50.00', 2, '0.2300', '123.00')],
    );
    expect([ctx.deliveryTotal, ctx.paymentSurcharge]).toEqual(['15.99', '2.50']);
  });

  it('reports 0.00 for an order with neither', () => {
    const ctx = returnContextFrom(order('per_rate', '100.00', '23.00'), [item('a', '50.00', 2, '0.2300', '123.00')]);
    expect([ctx.deliveryTotal, ctx.paymentSurcharge]).toEqual(['0.00', '0.00']);
  });
});

/**
 * Issue #905 (PR 1) — the withdrawal period counts from the moment the order
 * entered `completed`, stored once as `orders.completed_at`, and never from
 * `updatedAt`, which any later edit moves.
 */
describe('returnContextFrom — the completing anchor (issue #905)', () => {
  const at = (status: string, completedAt: Date | null, updatedAt: Date) =>
    ({
      salesChannelId: 'ch',
      placedByCustomerAccountId: 'acc',
      organizationId: 'org',
      currency: 'PLN',
      status,
      completedAt,
      updatedAt,
      vatMethod: 'per_rate',
      subtotal: '10.00',
      taxTotal: '0.00',
      discountTotal: '0.00',
    }) as never;

  it('reports completed_at, not updatedAt, as the moment the order entered its completing status', () => {
    const completedAt = new Date('2026-10-01T10:00:00Z');
    const ctx = returnContextFrom(at('completed', completedAt, new Date('2026-10-01T10:00:00Z')), []);
    expect(ctx.completingStatusEnteredAt).toEqual(completedAt);
  });

  it('does not move when the order is edited after completion', () => {
    const completedAt = new Date('2026-10-01T10:00:00Z');
    const editedLater = new Date('2026-10-20T08:30:00Z');
    const ctx = returnContextFrom(at('completed', completedAt, editedLater), []);
    expect(ctx.completingStatusEnteredAt).toEqual(completedAt);
  });

  it('is null for an order that has not been completed: its period has not started', () => {
    const ctx = returnContextFrom(at('shipment_sent', null, new Date('2026-10-20T08:30:00Z')), []);
    expect(ctx.completingStatusEnteredAt).toBeNull();
  });

  it('does not fall back to updatedAt for a completed row that carries no stamp', () => {
    // The migration backfills every completed row and the entity stamps every
    // new one, so such a row is not expected; if one exists, the period is
    // reported as not started rather than counted from a moment that drifts.
    const ctx = returnContextFrom(at('completed', null, new Date('2026-10-20T08:30:00Z')), []);
    expect(ctx.completingStatusEnteredAt).toBeNull();
  });

  it('reads no shipment fact: the anchor does not depend on `shipments`, so its off-state changes nothing', () => {
    const source = readFileSync(new URL('./order-return-context.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((specifier) => /shipment/i.test(specifier ?? ''))).toEqual([]);
    expect(source).not.toMatch(/\bShipment\b/);
  });
});
