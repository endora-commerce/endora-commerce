import { describe, expect, it } from 'vitest';
import {
  cartFullPayloadSchema,
  cartMiniPayloadSchema,
  cartViewLineSchema,
  orgCartDetailViewSchema,
} from './carts.js';

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

/** The reply for a caller with no basket yet — `emptyCart()` in the carts routes. */
const EMPTY_BASKET = {
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

describe('cartFullPayloadSchema', () => {
  it('accepts the empty basket, whose timestamps are null', () => {
    expect(cartFullPayloadSchema.safeParse(EMPTY_BASKET).success).toBe(true);
  });

  // Issue #650 — additive: a reply from before the field parses, as `null`.
  it('reads a reply without previousRejection as null', () => {
    const parsed = cartFullPayloadSchema.parse(EMPTY_BASKET);
    expect(parsed.previousRejection).toBeNull();
  });

  it('accepts the rejection of the previous basket and refuses a malformed one', () => {
    const previousRejection = {
      cartId: '00000000-0000-4000-8000-000000000020',
      rejectedAt: '2026-11-03T09:00:00.000Z',
      reason: 'Over the quarterly budget',
    };
    expect(cartFullPayloadSchema.parse({ ...EMPTY_BASKET, previousRejection }).previousRejection).toEqual({
      ...previousRejection,
      restoredLineCount: 0,
      skippedLines: [],
    });
    expect(
      cartFullPayloadSchema.safeParse({ ...EMPTY_BASKET, previousRejection: { ...previousRejection, cartId: 'x' } })
        .success,
    ).toBe(false);
  });

  // Issue #755 — the rejected basket's lines restored into this one, and the
  // ones that could not be. Additive: a reply without them reads nothing restored.
  it('carries what was restored from the rejected basket and what was skipped', () => {
    const previousRejection = {
      cartId: '00000000-0000-4000-8000-000000000020',
      rejectedAt: '2026-11-03T09:00:00.000Z',
      reason: null,
      restoredLineCount: 2,
      skippedLines: [
        { productId: '00000000-0000-4000-8000-000000000021', productName: 'Bolt', reason: 'not_purchasable' },
      ],
    };
    expect(cartFullPayloadSchema.parse({ ...EMPTY_BASKET, previousRejection }).previousRejection).toEqual(
      previousRejection,
    );
    expect(
      cartFullPayloadSchema.safeParse({ ...EMPTY_BASKET, previousRejection: { ...previousRejection, restoredLineCount: -1 } })
        .success,
    ).toBe(false);
  });
});

describe('orgCartDetailViewSchema (issue #650)', () => {
  const DETAIL = {
    id: '00000000-0000-4000-8000-000000000030',
    ownerCustomerAccountId: '00000000-0000-4000-8000-000000000031',
    ownerDisplayName: 'Jan Kowalski',
    ownerEmail: 'buyer@example.com',
    orderId: null,
    status: 'active',
    approvalStatus: 'pending',
    itemCount: 1,
    total: { amount: 30, currency: 'PLN' },
    lastActivityAt: '2026-11-03T09:00:00.000Z',
    submittedForApprovalAt: '2026-11-03T09:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    items: [
      {
        id: LINE.id,
        productId: LINE.productId,
        variantId: null,
        displayName: 'Bolt M8',
        productSku: 'BOLT-M8',
        quantity: 3,
        unitPrice: { amount: 10, currency: 'PLN' },
        lineTotal: { amount: 30, currency: 'PLN' },
      },
    ],
  };

  it('accepts the detail with its lines', () => {
    expect(orgCartDetailViewSchema.safeParse(DETAIL).success).toBe(true);
  });

  // Issue #751 — the owner is named, the e-mail travelling beside the name.
  it("carries the owner's e-mail beside the name, null for an account that is gone", () => {
    expect(orgCartDetailViewSchema.parse(DETAIL).ownerEmail).toBe('buyer@example.com');
    expect(orgCartDetailViewSchema.safeParse({ ...DETAIL, ownerEmail: null }).success).toBe(true);
    const { ownerEmail: _ownerEmail, ...withoutEmail } = DETAIL;
    expect(orgCartDetailViewSchema.safeParse(withoutEmail).success).toBe(false);
  });

  // Issue #751 (owner ruling on PR #760) — a completed cart names the order it produced.
  it('carries the order a completed cart produced, null for any other', () => {
    const orderId = '00000000-0000-4000-8000-000000000751';
    expect(orgCartDetailViewSchema.parse({ ...DETAIL, status: 'completed', orderId }).orderId).toBe(orderId);
    expect(orgCartDetailViewSchema.parse(DETAIL).orderId).toBeNull();
    const { orderId: _orderId, ...withoutOrder } = DETAIL;
    expect(orgCartDetailViewSchema.safeParse(withoutOrder).success).toBe(false);
  });

  it('requires the lines', () => {
    const { items: _items, ...withoutLines } = DETAIL;
    expect(orgCartDetailViewSchema.safeParse(withoutLines).success).toBe(false);
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
