import { describe, expect, it } from 'vitest';
import {
  adminOrderPreviewResponseSchema,
  orderChargeLineSchema,
  orderPreviewTotalResponseSchema,
  orderVatMethodSchema,
} from '../src/index.js';

/**
 * Issue #904, Phase A — the contract fields delivery and the payment surcharge
 * will carry their VAT in. They are additive: an answer without them, which is
 * every answer the platform gives until the Phase B switch, still parses.
 */
describe('order charge lines (#904 Phase A)', () => {
  it('names the VAT method an order with taxed charges is placed under', () => {
    expect(orderVatMethodSchema.options).toEqual(['per_rate', 'per_rate_charges']);
  });

  it('holds one stored part of a charge as two-place decimal strings', () => {
    const line = { kind: 'delivery', rate: '0.23', gross: '10.66', net: '8.67' };
    expect(orderChargeLineSchema.parse(line)).toEqual(line);
    expect(orderChargeLineSchema.safeParse({ ...line, kind: 'discount' }).success).toBe(false);
    expect(orderChargeLineSchema.safeParse({ ...line, gross: 10.66 }).success).toBe(false);
  });

  const summary = {
    subtotal: 150,
    taxTotal: 25,
    deliveryTotal: 15.99,
    paymentSurcharge: 0,
    discountTotal: 0,
    total: 190.99,
    currency: 'PLN',
  };
  const additive = {
    deliveryNet: 13.75,
    paymentSurchargeNet: 0,
    vatRows: [{ taxRate: 0.23, netTotal: 108.67, vatAmount: 24.99, grossTotal: 133.66 }],
  };

  it('keeps the checkout preview parsing with and without the net charge fields', () => {
    const base = { ...summary, belowMinimumLines: [] };
    expect(orderPreviewTotalResponseSchema.safeParse(base).success).toBe(true);
    const parsed = orderPreviewTotalResponseSchema.parse({ ...base, ...additive });
    expect([parsed.deliveryNet, parsed.paymentSurchargeNet, parsed.vatRows]).toEqual([
      additive.deliveryNet,
      additive.paymentSurchargeNet,
      additive.vatRows,
    ]);
  });

  it('keeps the admin preview summary parsing with and without the net charge fields', () => {
    const base = { lines: [], summary, messages: [] };
    expect(adminOrderPreviewResponseSchema.safeParse(base).success).toBe(true);
    const parsed = adminOrderPreviewResponseSchema.parse({ ...base, summary: { ...summary, ...additive } });
    expect(parsed.summary.deliveryNet).toBe(13.75);
    expect(parsed.summary.vatRows).toEqual(additive.vatRows);
  });
});
