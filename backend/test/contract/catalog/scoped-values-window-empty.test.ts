import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170 (owner decision 2026-11-03, round 8; spec rule "an empty date is no limit") — an
 * empty publication window, `window: null`, means **no limit**: at Global it clears both bounds,
 * and at Channel it is an override that opens the window there whatever Global's window says.
 * The storefront product page is the reader that proves it.
 */
describe('170 — an empty publication window is no limit', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let channelCode: string;
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const page = async (productId: string) => {
    const slug = (await fx.read(productId, { channelId: channel })).fields.urlKey.value as string;
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slug}`,
      headers: { 'x-sales-channel': channelCode, 'accept-language': 'pl-PL' },
    });
    return res.statusCode;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL']);
    channelCode = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [channel]))[0]!.code;
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('at Global, window null clears both bounds: the product is published', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, {}, { window: { from: future, until: null } });
    expect(await page(id)).toBe(404);
    const data = await fx.save(id, {}, { window: null });
    expect(data.fields.window).toMatchObject({ value: { from: null, until: null } });
    expect(await fx.sql(`select publish_from, publish_until from products where id = ?`, [id])).toEqual([{ publish_from: null, publish_until: null }]);
    expect(await page(id)).toBe(200);
  });

  it("at Channel, window null is an override with no limit, whatever Global's window says", async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, {}, { window: { from: future, until: null } });
    expect(await page(id)).toBe(404);
    const data = await fx.save(id, { channelId: channel }, { window: null });
    // The store keeps an open window and an empty one alike (both bounds null), so the read
    // answers it as the channel's own open window.
    expect(data.fields.window).toMatchObject({ source: 'set', value: { from: null, until: null } });
    expect(await page(id)).toBe(200);
    // Inheriting again brings Global's limit back.
    await fx.save(id, { channelId: channel }, { window: { inherit: true } });
    expect(await page(id)).toBe(404);
  });
});
