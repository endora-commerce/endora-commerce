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
 * Issue #259 — saving to a list is an acquisition (Constitution XII).
 *
 * A saved line is read back, named and priced on every later visit, so it is
 * the longest-lived of the acquisition seams and the one where a product that
 * should never have entered stays visible. `ShoppingListService.addItem` asked
 * `isProductVisibleTo` and no channel question at all.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/shopping-lists/default/items — the request channel has to sell it', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'list-assortment');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function save(
    productId: string,
    channelCode: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists/default/items',
      cookies: BUYER,
      headers: { 'x-sales-channel': channelCode },
      payload: { productId, quantity: 1 },
    });
    const body = res.json() as { error?: { code?: string } };
    return { statusCode: res.statusCode, code: body.error?.code };
  }

  it('refuses a product the request channel does not publish', async () => {
    const { statusCode, code } = await save(probe.notSoldHereId, probe.code);
    expect(statusCode).toBe(404);
    expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('still accepts a product the same channel does publish', async () => {
    const { statusCode } = await save(probe.soldHereId, probe.code);
    expect(statusCode).toBe(201);
  });

  it('accepts the withheld product on a channel that does publish it', async () => {
    const { statusCode } = await save(probe.notSoldHereId, 'pl_retail');
    expect(statusCode).toBe(201);
  });

  it('skips an out-of-channel line on conversion instead of refusing the whole list', async () => {
    // By the end of the cases above the default list holds both products: one
    // saved on the probe channel, one saved on `pl_retail`. Converting on the
    // probe channel must carry the line that channel sells and report the other
    // as skipped — the vocabulary this seam has had since T201. A conversion
    // that let the target refuse for it would turn one unacquirable line into
    // one refusal for the whole list.
    const listId = (
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/v1/shopping-lists/default',
          cookies: BUYER,
          headers: { 'x-sales-channel': probe.code },
        })
      ).json() as { data: { id: string } }
    ).data.id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/convert-to-cart`,
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.code },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as {
      data: {
        added: number;
        skipped: Array<{ productId: string; reason: string }>;
      };
    };
    expect(result.data.added).toBe(1);
    // `product_not_found`, not a reason of its own: out of assortment reads as
    // absent everywhere else, and a distinct reason here would tell a buyer
    // that some other channel sells it.
    expect(result.data.skipped).toEqual([
      expect.objectContaining({ productId: probe.notSoldHereId, reason: 'product_not_found' }),
    ]);
  });

  it('carries every line when the conversion runs on a channel that sells them all', async () => {
    const listId = (
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/v1/shopping-lists/default',
          cookies: BUYER,
          headers: { 'x-sales-channel': 'pl_retail' },
        })
      ).json() as { data: { id: string } }
    ).data.id;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/convert-to-cart`,
      cookies: BUYER,
      headers: { 'x-sales-channel': 'pl_retail' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as { data: { added: number; skipped: unknown[] } };
    expect(result.data.added).toBe(2);
    expect(result.data.skipped).toEqual([]);
  });
});
