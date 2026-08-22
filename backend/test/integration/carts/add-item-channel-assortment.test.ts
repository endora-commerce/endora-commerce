import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  seedProbeChannelAssortment,
  type ChannelAssortment,
} from '../../helpers/channel-assortment-fixture.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #259 — a cart line is an acquisition, and an acquisition owes the
 * channel filter (Constitution XII).
 *
 * `CartService.addItem` learned `isProductVisibleTo` in issue #227 and stopped
 * there. The predicate says in its own contract that it is *not* the channel
 * answer — "a second filter every buyer-facing path owes on top of this one" —
 * and no second filter existed here. So a product an operator published on one
 * storefront only was refused on that storefront's listing and its product
 * page, and accepted by `POST /api/v1/cart/items` from any other, by id.
 *
 * Both halves are asserted on the **same** channel with the **same** request
 * shape, because a filter that narrows against the wrong channel refuses
 * everything and would pass the first case alone.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/cart/items — the request channel has to sell it', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'cart-assortment');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function addItem(
    productId: string,
    channelCode: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      payload: { productId, quantity: 1 },
    });
    const body = res.json() as { error?: { code?: string } };
    return { statusCode: res.statusCode, code: body.error?.code };
  }

  it('refuses a product the request channel does not publish', async () => {
    const { statusCode, code } = await addItem(probe.notSoldHereId, probe.code);
    expect(statusCode).toBe(404);
    // The same answer as an unknown id and as a restricted one. A distinct code
    // here would turn the cart into an assortment oracle: post an id, read the
    // refusal, learn whether some other channel sells it.
    expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('still accepts a product the same channel does publish', async () => {
    const { statusCode } = await addItem(probe.soldHereId, probe.code);
    expect(statusCode).toBe(200);
  });

  it('accepts the withheld product on a channel that does publish it', async () => {
    // The row is live, active and `public`; the only thing that moved between
    // this case and the first one is the bridge row.
    const { statusCode } = await addItem(probe.notSoldHereId, 'pl_retail');
    expect(statusCode).toBe(200);
  });

  it('refuses an anonymous shopper the same way it refuses a signed-in one', async () => {
    // The audience differs; the channel answer does not, because the channel is
    // a property of the request rather than of the viewer.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-sales-channel': probe.code, 'content-type': 'application/json' },
      payload: { productId: probe.notSoldHereId, quantity: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );
  });
});
