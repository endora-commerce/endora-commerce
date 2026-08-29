import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Regression coverage for the failure paths that the comparison-page
 * `<CompareAddToCartButton>` (feature 007 / US3 / T045) surfaces back
 * to the customer. The button is a thin client-side wrapper around
 * `POST /api/v1/cart/items`; this test pins the contract at the spot
 * the compare page depends on most: a refusal MUST come back with the
 * standard error envelope, never a 500 / generic crash.
 *
 * Archived-product behaviour is enforced by carts separately and is not
 * regressed here — the spec's only behavioural promise to the comparison page
 * is that the cart's response makes the refusal reason visible (FR-016).
 *
 * This sentence used to say "out-of-channel and archived-product", and the
 * first half of it was not true: until issue #259 `CartService.addItem`
 * applied `isProductVisibleTo` and no channel test at all, so a product
 * published on another storefront went into the cart by id. It is enforced now,
 * and `add-item-channel-assortment.test.ts` next to this file is what enforces
 * the claim rather than a comment asserting it.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('POST /api/v1/cart/items — failure modes surfaced by Compare US3', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 404 PRODUCT_NOT_FOUND when the productId is unknown', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: {
        productId: '00000000-0000-4000-8000-00000000ffff',
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.PRODUCT_NOT_FOUND },
    });
  });
});
