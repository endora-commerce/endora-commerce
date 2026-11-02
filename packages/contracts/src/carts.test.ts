import { describe, expect, it } from 'vitest';
import { cartFullPayloadSchema, cartMiniPayloadSchema, cartViewLineSchema } from './carts.js';

/**
 * Issue #128 — the cart-view schemas describe what the cart routes answer.
 *
 * Each value below is a reply the routes have been sending, copied from the
 * serialisers in `packages/modules/carts/src/backend/routes.ts`; before the
 * issue none of them parsed. The contract test
 * `backend/test/contract/carts/cart-response-schema.contract.test.ts` parses
 * the real replies; this file keeps the shape honest where the contract tree
 * does not run, before a merge.
 */

const LINE = {
  id: '00000000-0000-4000-8000-000000000011',
  productId: '00000000-0000-4000-8000-000000000101',
  variantId: null,
  quantity: 2,
  unitPrice: { amount: 10, currency: 'PLN' },
  lineTotal: { amount: 20, currency: 'PLN' },
  unavailable: false,
  unavailableReason: null,
  productSlug: null,
  productSku: null,
  packagingUnitName: null,
  packagingUnitBaseQuantity: null,
  displayName: null,
};

describe('cartViewLineSchema', () => {
  it('accepts a mutation-reply line: no product name resolved, no thumbnail key', () => {
    expect(cartViewLineSchema.safeParse({ ...LINE, productName: null }).success).toBe(true);
  });

  it('still requires the productName key', () => {
    expect(cartViewLineSchema.safeParse(LINE).success).toBe(false);
  });
});

describe('cartFullPayloadSchema', () => {
  it('accepts the empty basket, whose timestamps are null', () => {
    const empty = {
      id: null,
      customerAccountId: null,
      organizationId: null,
      salesChannelId: null,
      anonymousCartToken: null,
      status: 'active',
      approvalStatus: 'not_required',
      items: [],
      itemCount: 0,
      subtotal: { amount: 0, currency: 'PLN' },
      discount: null,
      appliedPromotions: [],
      grandTotal: { amount: 0, currency: 'PLN' },
      primaryCta: 'checkout',
      droppedLines: [],
      couponDroppedThisRead: null,
      createdAt: null,
      updatedAt: null,
      lastActivityAt: null,
    };
    expect(cartFullPayloadSchema.safeParse(empty).success).toBe(true);
  });
});

describe('cartMiniPayloadSchema', () => {
  it('accepts the mini view as answered and keeps its subtotal and line variantId', () => {
    const parsed = cartMiniPayloadSchema.parse({
      id: '00000000-0000-4000-8000-000000000010',
      itemCount: 1,
      items: [
        {
          id: LINE.id,
          productId: LINE.productId,
          variantId: null,
          quantity: 2,
          unitPrice: LINE.unitPrice,
          lineTotal: LINE.lineTotal,
        },
      ],
      subtotal: { amount: 20, currency: 'PLN' },
    });
    expect(parsed.subtotal).toEqual({ amount: 20, currency: 'PLN' });
    expect(parsed.items[0]?.variantId).toBeNull();
  });
});
