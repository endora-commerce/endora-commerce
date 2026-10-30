import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  QUICK_ORDER_BUILD_MAX_ITEMS,
  type CartBatchLineOutcome,
  type CartWritePort,
  type RfqCustomerPort,
} from '@endora-commerce/contracts';
import { QuickOrderBuildService, type QuickOrderBuildLineInput } from './quick-order-build-service.js';

/**
 * Feature 155 (FR-011 (b), FR-030, FR-038; research R8, R12.2, R20; threats F1,
 * F4, F10) — the build adds a cart batch through `addItems`, reports the lines
 * below a minimum, forwards the operator's `minimums: 'warn'` on the quote
 * target only, and refuses an oversized request before any port call.
 */

const BUYER = { customerAccountId: 'cust-1', organizationId: 'org-1', salesChannelId: 'channel-1' };
const A = '00000000-0000-4000-8000-0000000000a1';
const D = '00000000-0000-4000-8000-0000000000d1';
const RED = '00000000-0000-4000-8000-0000000000e1';

function doubles(outcomes: CartBatchLineOutcome[] = []) {
  const addItems = vi.fn(async () => ({
    cart: { id: 'cart-1' },
    items: [],
    outcomes,
  }));
  const addItem = vi.fn(async () => {
    throw new Error('the build must not add line by line');
  });
  const getOrCreateForCustomer = vi.fn(async () => ({ id: 'cart-1' }));
  const createForCustomer = vi.fn(async () => ({ id: 'rfq-1', businessId: 'RFQ-1' }));
  const cart = { addItems, addItem, getOrCreateForCustomer } as unknown as CartWritePort;
  const rfq = { createForCustomer } as unknown as RfqCustomerPort;
  return { service: new QuickOrderBuildService(cart, rfq), addItems, addItem, getOrCreateForCustomer, createForCustomer };
}

const ITEMS: QuickOrderBuildLineInput[] = [
  { productId: A, variantId: RED, quantity: 5 },
  { productId: D, variantId: null, quantity: 1 },
];

const A_BELOW: CartBatchLineOutcome = {
  index: 0,
  status: 'below_minimum',
  productId: A,
  productName: 'Anchor bolt',
  kind: 'pieces',
  minimum: 10,
};

describe('QuickOrderBuildService — target cart', () => {
  it.each([
    ['the buyer', undefined],
    ['the operator', 'operator' as const],
  ])('for %s: one addItems batch with onLineError throw; below_minimum lines reported in rejected[]', async (_who, actor) => {
    const { service, addItems, addItem } = doubles([A_BELOW, { index: 1, status: 'added' }]);
    const result = await service.build(BUYER, { target: 'cart', items: ITEMS }, {
      ...(actor ? { actor } : {}),
      language: 'pl',
    });

    expect(addItem).not.toHaveBeenCalled();
    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems).toHaveBeenCalledWith(
      { customer: BUYER },
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: D, quantity: 1 },
      ],
      { onLineError: 'throw', language: 'pl' },
    );
    expect(result).toEqual({
      target: 'cart',
      cartId: 'cart-1',
      checkoutUrl: '/checkout?cartId=cart-1',
      rejected: [
        {
          productId: A,
          variantId: RED,
          quantity: 5,
          productName: 'Anchor bolt',
          reason: 'below_minimum',
          kind: 'pieces',
          minimum: 10,
        },
      ],
    });
  });

  it('names the packaging unit of a packaging-unit refusal (packagingUnitName)', async () => {
    const { service } = doubles([
      {
        index: 0,
        status: 'below_minimum',
        productId: A,
        productName: 'Anchor bolt',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
      { index: 1, status: 'added' },
    ]);
    const result = await service.build(BUYER, { target: 'cart', items: ITEMS });
    expect(result.rejected).toEqual([
      {
        productId: A,
        variantId: RED,
        quantity: 5,
        productName: 'Anchor bolt',
        reason: 'below_minimum',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
    ]);
  });

  it('answers an empty rejected[] when every line was added', async () => {
    const { service } = doubles([{ index: 0, status: 'added' }, { index: 1, status: 'added' }]);
    const result = await service.build(BUYER, { target: 'cart', items: ITEMS });
    expect(result.rejected).toEqual([]);
  });

  it('lets a resolution failure propagate (the unknown-id 404, nothing added)', async () => {
    const { service, addItems } = doubles();
    const notFound = Object.assign(new Error('Product not found.'), { statusCode: 404 });
    addItems.mockRejectedValueOnce(notFound);
    await expect(service.build(BUYER, { target: 'cart', items: ITEMS })).rejects.toBe(notFound);
  });
});

describe('QuickOrderBuildService — target quote_request', () => {
  it("forwards minimums 'warn' when the actor is the operator", async () => {
    const { service, createForCustomer, addItems } = doubles();
    await service.build(BUYER, { target: 'quote_request', items: ITEMS }, { actor: 'operator' });
    expect(addItems).not.toHaveBeenCalled();
    expect(createForCustomer).toHaveBeenCalledTimes(1);
    // The RFQ context carries the buyer's identity, not the build's channel.
    const { salesChannelId: _channel, ...identity } = BUYER;
    expect(createForCustomer).toHaveBeenCalledWith(
      { ...identity, isOrgAdmin: false },
      {
        items: [
          { productId: A, variantId: RED, quantity: 5 },
          { productId: D, quantity: 1 },
        ],
      },
      { minimums: 'warn' },
    );
  });

  it('passes no minimums option for the buyer, only the language a refusal names a product in and the build’s channel (163)', async () => {
    const { service, createForCustomer } = doubles();
    const result = await service.build(
      { ...BUYER, salesChannelId: 'channel-1' },
      { target: 'quote_request', items: ITEMS },
      { language: 'en' },
    );
    expect(createForCustomer).toHaveBeenCalledTimes(1);
    const call = createForCustomer.mock.calls[0] as unknown[];
    expect(call).toHaveLength(3);
    expect(call[2]).toEqual({ language: 'en', salesChannelId: 'channel-1' });
    expect(result).toEqual({ target: 'quote_request', quoteRequestId: 'rfq-1', quoteRequestBusinessId: 'RFQ-1' });
    expect(result).not.toHaveProperty('rejected');
  });

  it('forwards the request’s language tag for the lines’ scope language beside the message language (163, T155 §1.5b)', async () => {
    const { service, createForCustomer } = doubles();
    await service.build(
      { ...BUYER, salesChannelId: 'channel-1' },
      { target: 'quote_request', items: ITEMS },
      { language: 'pl', languageTag: 'de-DE' },
    );
    const call = createForCustomer.mock.calls[0] as unknown[];
    expect(call[2]).toEqual({ language: 'pl', languageTag: 'de-DE', salesChannelId: 'channel-1' });
  });
});

describe('QuickOrderBuildService — the item bound (FR-038)', () => {
  const tooMany = (): QuickOrderBuildLineInput[] =>
    Array.from({ length: QUICK_ORDER_BUILD_MAX_ITEMS + 1 }, () => ({ productId: D, quantity: 1 }));

  it.each(['cart', 'quote_request'] as const)(
    'refuses %s with more than 200 items, 422 too_many_items, before any port call',
    async (target) => {
      const { service, addItems, addItem, getOrCreateForCustomer, createForCustomer } = doubles();
      await expect(service.build(BUYER, { target, items: tooMany() })).rejects.toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
        details: { code: 'too_many_items', maximum: QUICK_ORDER_BUILD_MAX_ITEMS },
      });
      expect(addItems).not.toHaveBeenCalled();
      expect(addItem).not.toHaveBeenCalled();
      expect(getOrCreateForCustomer).not.toHaveBeenCalled();
      expect(createForCustomer).not.toHaveBeenCalled();
    },
  );

  it('accepts exactly 200 items', async () => {
    const { service, addItems } = doubles();
    const items = Array.from({ length: QUICK_ORDER_BUILD_MAX_ITEMS }, () => ({ productId: D, quantity: 1 }));
    await service.build(BUYER, { target: 'cart', items });
    expect(addItems).toHaveBeenCalledTimes(1);
  });
});
