import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Issue #259 — the pasted-SKU seam, by **SKU** rather than by id
 * (Constitution XII).
 *
 * This is the sibling of issue #174's type-ahead, on the endpoint next to it.
 * `GET /quick-order/search` was taught the channel then; `POST
 * /quick-order/import` was taught the *audience* in issue #227 and never the
 * channel. A CSV of guessed SKUs is the cheapest enumeration there is, and the
 * response says outright which of them resolved to a real product id — so
 * without this the import surface answered, for any channel, "yes, that SKU is
 * a product, here is its id", and the id then went to `/quick-order/build`.
 *
 * `product_not_found` is the row's answer for an unknown SKU, and it is the
 * answer here too: the two must be indistinguishable or the partition itself is
 * the oracle.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/quick-order/import — the request channel has to sell the SKU', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'qo-assortment');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function importCsv(
    channelCode: string,
  ): Promise<{
    recognized: Array<{ sku: string; productId: string }>;
    rejected: Array<{ line: number; reason: string }>;
  }> {
    // Both SKUs in one file, on one channel: the pair is the point.
    const csv = [
      'sku,quantity',
      `${probe.soldHereSku},2`,
      `${probe.notSoldHereSku},3`,
    ].join('\n');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: BUYER,
      headers: { 'x-sales-channel': channelCode },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    return (
      res.json() as {
        data: {
          recognized: Array<{ sku: string; productId: string }>;
          rejected: Array<{ line: number; reason: string }>;
        };
      }
    ).data;
  }

  it('rejects the SKU the request channel does not publish, and recognises the one it does', async () => {
    const { recognized, rejected } = await importCsv(probe.code);

    expect(recognized.map((r) => r.sku)).toEqual([probe.soldHereSku]);
    expect(recognized.map((r) => r.productId)).not.toContain(probe.notSoldHereId);
    // Line 3 is the withheld SKU. Same reason code as a SKU nobody sells.
    expect(rejected).toEqual([
      expect.objectContaining({ line: 3, reason: 'product_not_found' }),
    ]);
  });

  it('recognises both SKUs on a channel that publishes both', async () => {
    // The restoration half — and the proof that the filter narrows rather than
    // empties. `pl_retail` carries every seeded product.
    const { recognized, rejected } = await importCsv('pl_retail');
    expect(recognized.map((r) => r.sku).sort()).toEqual(
      [probe.soldHereSku, probe.notSoldHereSku].sort(),
    );
    expect(rejected).toEqual([]);
  });
});
