import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/` T056; FR-030, US3 #1) — the quick-order
 * search names a hit by its effective name at the request's (channel, language), one string
 * (`CatalogQuickSearchHit.name`, `contracts/readers.md` §2): the C×L translation on its channel,
 * the Global name on a channel without it.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
type Code = 'pl_retail' | 'pl_b2b_vip';
const on = (code: Code): Record<string, string> => ({ 'x-sales-channel': code, 'accept-language': 'pl-PL' });

describe('174 — quick-order search hits at the request (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;

  async function hitName(code: Code): Promise<unknown> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/search?q=${encodeURIComponent(drill.sku)}`,
      cookies: BUYER,
      headers: on(code),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ productId: string; name: unknown }> }).data.find((d) => d.productId === drill.id)
      ?.name;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    const retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    drill = await createMinimumProduct(em, {
      sku: `S170-QO-${RUN}`,
      nameEn: `Drill X ${RUN}`,
      namePl: `Drill X ${RUN}`,
      channelIds: [vipId, retailId],
    });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: `Wiertarka X Pro ${RUN}` },
    ]);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [drill.id]);
    await teardownBackendServer(h);
  });

  it('names the hit by the C×L translation on its channel', async () => {
    expect(await hitName('pl_b2b_vip')).toBe(`Wiertarka X Pro ${RUN}`);
  });

  it('names the hit by the Global name on a channel without the translation (US3 #1)', async () => {
    expect(await hitName('pl_retail')).toBe(`Drill X ${RUN}`);
  });
});
