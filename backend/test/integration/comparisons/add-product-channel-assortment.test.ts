import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
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
 * Issue #259 — a comparison column is an acquisition too (Constitution XII).
 *
 * `ComparisonService.addProduct` already took the resolved channel as an
 * argument: it reads `compare.max_products` against it and stamps it on the
 * row. What it did not do with it was ask whether the channel sells the
 * product — so a comparison built on one storefront could hold, name, price and
 * PDF-export a row another storefront's operator had published nowhere near it.
 *
 * The refusal is `ProductNotFoundError`, which the public route turns into a
 * 404 `PRODUCT_NOT_FOUND` — the same answer the visibility half gives, on
 * purpose.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/comparisons/me/products — the request channel has to sell it', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'compare-assortment');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function addProduct(
    productId: string,
    channelCode: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: BUYER,
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      payload: { productId },
    });
    const body = res.json() as { error?: { code?: string } };
    return { statusCode: res.statusCode, code: body.error?.code };
  }

  it('refuses a product the request channel does not publish', async () => {
    const { statusCode, code } = await addProduct(probe.notSoldHereId, probe.code);
    expect(statusCode).toBe(404);
    expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('leaves nothing behind when it refuses', async () => {
    // A gate that threw *after* the bridge row was written would still pass the
    // status assertion above. Read before anything is legitimately added, so
    // the comparison is empty unless the refusal wrote to it.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.code },
    });
    // 204 is "this buyer has no comparison at all", which is the strongest form
    // of the claim; a 200 is accepted as long as the refused product is absent.
    if (res.statusCode === 200) {
      const view = res.json() as { data: { products: Array<{ id: string }> } };
      expect(view.data.products.map((p) => p.id)).not.toContain(probe.notSoldHereId);
    } else {
      expect(res.statusCode).toBe(204);
    }
  });

  it('still accepts a product the same channel does publish', async () => {
    const { statusCode } = await addProduct(probe.soldHereId, probe.code);
    expect(statusCode).toBe(200);
  });

  it('accepts the withheld product on a channel that does publish it', async () => {
    const { statusCode } = await addProduct(probe.notSoldHereId, 'pl_retail');
    expect(statusCode).toBe(200);
  });

});
