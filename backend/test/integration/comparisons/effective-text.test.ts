import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T053; FR-030, US3 #1, #2) — a comparison
 * column is named by the product's effective name at the reader's (channel, language), one string
 * (`comparisonProductSummarySchema.name`, `contracts/readers.md` §2): the C×L translation where
 * the reader's channel has one, else the Channel value, else the Global name.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
type Code = 'pl_retail' | 'pl_b2b_vip';
const on = (code: Code): Record<string, string> => ({ 'x-sales-channel': code, 'accept-language': 'pl-PL' });

describe('170 — comparison columns at the reader (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  let saw: MinimumProductFixture;
  const GLOBAL = `Drill X ${RUN}`;

  let pictured: MinimumProductFixture;
  const IMAGE_URL = `https://cdn.example.test/s170-cmp-${RUN}.jpg`;

  async function column(code: Code, productId: string): Promise<{ name: unknown; primaryAssetUrl: unknown } | undefined> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: BUYER,
      headers: { ...on(code), 'content-type': 'application/json' },
      payload: { productId },
    });
    expect(add.statusCode, add.body).toBe(200);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: on(code) });
    expect(res.statusCode, res.body).toBe(200);
    return (
      res.json() as { data: { products: Array<{ id: string; name: unknown; primaryAssetUrl: unknown }> } }
    ).data.products.find((p) => p.id === productId);
  }

  async function columnName(code: Code, productId: string): Promise<unknown> {
    return (await column(code, productId))?.name;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    const retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    drill = await createMinimumProduct(em, { sku: `S170-CM-${RUN}`, nameEn: GLOBAL, namePl: GLOBAL, channelIds: [vipId, retailId] });
    saw = await createMinimumProduct(em, { sku: `S170-CS-${RUN}`, nameEn: `Saw ${RUN}`, namePl: `Saw ${RUN}`, channelIds: [vipId] });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: `Wiertarka X Pro ${RUN}` },
    ]);
    await seedScopedValues(em, saw.id, [{ field: 'name', scope: { level: 'channel', channelId: vipId }, value: `Saw Pro ${RUN}` }]);
    // The base image of `pictured` is held by nobody at VIP x pl-PL (an empty role override), and by
    // the Global holder everywhere else.
    pictured = await createMinimumProduct(em, { sku: `S170-CP-${RUN}`, nameEn: `Pictured ${RUN}`, namePl: `Pictured ${RUN}`, channelIds: [vipId, retailId] });
    const assetId = randomUUID();
    await em.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'test.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [assetId, IMAGE_URL],
    );
    const attached = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${pictured.id}/gallery`,
      payload: { assetId, labels: ['base_image'] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(attached.statusCode, attached.body).toBe(201);
    await seedScopedValues(em, pictured.id, [
      { field: 'galleryRole:base_image', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: 'empty' },
    ]);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [drill.id, saw.id, pictured.id]);
    await teardownBackendServer(h);
  });

  it('names a column by the C×L translation on its channel, as one string', async () => {
    expect(await columnName('pl_b2b_vip', drill.id)).toBe(`Wiertarka X Pro ${RUN}`);
  });

  it('names a column by the Channel value when there is no C×L one (C×L → C)', async () => {
    expect(await columnName('pl_b2b_vip', saw.id)).toBe(`Saw Pro ${RUN}`);
  });

  it('names a column by the Global name on a channel without the translation (US3 #1)', async () => {
    expect(await columnName('pl_retail', drill.id)).toBe(GLOBAL);
  });

  it("shows the base image at the reader's language: none where the role is emptied at C x L", async () => {
    expect((await column('pl_b2b_vip', pictured.id))?.primaryAssetUrl).toBeNull();
    expect((await column('pl_retail', pictured.id))?.primaryAssetUrl).toBe(IMAGE_URL);
  });
});
