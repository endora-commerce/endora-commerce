import { describe, expect, it } from 'vitest';
import { settlementPrefillSchema, settlementRequestSchema } from './returns.js';

/**
 * Issue #876 — a consumer withdrawal refunds the delivery and the payment
 * surcharge. Additive on the wire: the settlement request may name either
 * amount (two places, non-negative), and the prefill reports each with its cap.
 */
const ITEM = '00000000-0000-4000-8000-000000087601';

describe('settlement charges on the wire (#876)', () => {
  it('a request may name the delivery and the surcharge refund, and an older one still parses', () => {
    const parsed = settlementRequestSchema.parse({
      resolutionType: 'refund',
      lines: [{ returnCaseItemId: ITEM, approvedRefundAmount: 123 }],
      deliveryRefundAmount: 15.99,
      surchargeRefundAmount: 0,
    });
    expect([parsed.deliveryRefundAmount, parsed.surchargeRefundAmount]).toEqual([15.99, 0]);
    expect(settlementRequestSchema.parse({ resolutionType: 'refund' }).deliveryRefundAmount).toBeUndefined();
  });

  it('refuses a negative or a three-place charge amount', () => {
    expect(settlementRequestSchema.safeParse({ resolutionType: 'refund', deliveryRefundAmount: -1 }).success).toBe(false);
    expect(settlementRequestSchema.safeParse({ resolutionType: 'refund', surchargeRefundAmount: 1.005 }).success).toBe(false);
  });

  it('the prefill reports each charge with its cap and the approved amount', () => {
    const prefill = settlementPrefillSchema.parse({
      currency: 'PLN',
      resolutionOptions: ['refund'],
      items: [],
      charges: { delivery: { cap: 15.99, approved: 15.99 } },
    });
    expect(prefill.charges).toEqual({ delivery: { cap: 15.99, approved: 15.99 } });
  });
});
