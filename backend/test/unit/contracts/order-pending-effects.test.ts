import { describe, expect, it } from 'vitest';
import {
  orderCommittedWritePartialResponseSchema,
  orderPendingEffectSchema,
  orderSchema,
} from '@endora-commerce/contracts';

/**
 * `specs/142-order-transition-atomicity/` (D10, FR-019) — the admin order
 * response says which of an order's follow-ups have not happened yet.
 *
 * The field is optional and additive: an order with nothing outstanding carries
 * no `pendingEffects` at all, and every response written before the field
 * existed still parses.
 */

const ORDER = {
  id: '00000000-0000-4000-8000-000000000001',
  businessId: 'ORD-1',
  organizationId: '00000000-0000-4000-8000-000000000002',
  placedByCustomerAccountId: '00000000-0000-4000-8000-000000000003',
  placedOnBehalfByAdminUserId: null,
  salesChannelId: '00000000-0000-4000-8000-000000000004',
  status: 'cancelled',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: {
    recipientName: 'A', street: 'S 1', city: 'C', postalCode: '00-001', country: 'PL',
  },
  billingAddress: {
    recipientName: 'A', street: 'S 1', city: 'C', postalCode: '00-001', country: 'PL',
  },
  deliveryMethod: { id: '00000000-0000-4000-8000-000000000005', code: 'pickup', name: 'Pickup', cost: 0 },
  paymentMethod: {
    id: '00000000-0000-4000-8000-000000000006', code: 'cl', name: 'Credit', kind: 'credit_limit',
  },
  sourceQuoteRequestId: null,
  items: [],
  subtotal: 0,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 0,
  currency: 'PLN',
  placedAt: '2026-10-03T10:00:00.000Z',
  customerNote: null,
  nextAction: null,
};

describe('orderSchema — pendingEffects (spec 142, D10)', () => {
  it('accepts an order with no pendingEffects', () => {
    const parsed = orderSchema.parse(ORDER);
    expect(parsed.pendingEffects).toBeUndefined();
  });

  it('accepts and keeps an order with outstanding follow-ups', () => {
    const pendingEffects = [
      { effect: 'stock.release', blockedOn: 'inventory', attempts: 0, lastAttemptAt: null },
      {
        effect: 'credit.release',
        blockedOn: null,
        attempts: 3,
        lastAttemptAt: '2026-10-03T10:05:00.000Z',
      },
    ];
    const parsed = orderSchema.parse({ ...ORDER, pendingEffects });
    expect(parsed.pendingEffects).toEqual(pendingEffects);
  });

  it('refuses an effect it does not know', () => {
    const result = orderSchema.safeParse({
      ...ORDER,
      pendingEffects: [{ effect: 'refund.issue', blockedOn: null, attempts: 0, lastAttemptAt: null }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a negative attempt count', () => {
    expect(
      orderPendingEffectSchema.safeParse({
        effect: 'stock.release',
        blockedOn: null,
        attempts: -1,
        lastAttemptAt: null,
      }).success,
    ).toBe(false);
  });
});

describe('orderCommittedWritePartialResponseSchema (spec 142, FR-002)', () => {
  const partial = {
    data: { id: ORDER.id, businessId: 'ORD-1', status: 'cancelled', paymentStatus: 'deferred' },
    meta: { partial: true },
  };

  it('accepts the partial reply and keeps its marker', () => {
    expect(orderCommittedWritePartialResponseSchema.parse(partial)).toEqual(partial);
  });

  it('is what a client needs: the partial body is not an order', () => {
    expect(orderSchema.safeParse(partial.data).success).toBe(false);
  });

  it('does not match a whole order, nor four fields with no marker', () => {
    expect(orderCommittedWritePartialResponseSchema.safeParse({ data: ORDER }).success).toBe(false);
    expect(orderCommittedWritePartialResponseSchema.safeParse({ data: partial.data }).success).toBe(
      false,
    );
  });
});
