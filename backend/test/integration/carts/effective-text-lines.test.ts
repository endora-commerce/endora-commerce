import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';
import { ProductLink } from '../../helpers/package-entities.js';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/` T050; FR-030, FR-032, US3 #1–#3) — the
 * basket reads a product's texts at the basket's (channel, language) along C×L → C → Global:
 * the line name, the minimum-order refusal and the up-sell strip. A translation at one channel
 * × Polish is not seen by a Polish buyer of another channel, who gets the Global string. The
 * packaging-unit name is a snapshot: taken at the line's (C, L) and kept when the override
 * changes afterwards.
 *
 * The demo channels are the illustration's real codes (owner, 2026-11-03): `pl_b2b_vip` carries
 * the translation, `pl_retail` does not. Both speak pl-PL by default.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const on = (code: 'pl_retail' | 'pl_b2b_vip'): Record<string, string> => ({
  'x-sales-channel': code,
  'accept-language': 'pl-PL',
});

interface CartLine {
  productId: string;
  productName?: string;
  name?: string;
  packagingUnitName: string | null;
}

describe('174 — basket texts at the basket (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  let source: MinimumProductFixture;
  let unitId = '';
  let vipId = '';
  let retailId = '';
  const linkIds: string[] = [];
  const GLOBAL = `Drill X ${RUN}`;
  const VIP_PL = `Wiertarka X Pro ${RUN}`;

  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);
  const completeActiveBaskets = () =>
    sql(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);

  async function add(code: 'pl_retail' | 'pl_b2b_vip', payload: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: BUYER, headers: on(code), payload });
  }
  async function line(code: 'pl_retail' | 'pl_b2b_vip', productId: string): Promise<CartLine | undefined> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: BUYER, headers: on(code) });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { items: CartLine[] } }).data.items.find((i) => i.productId === productId);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    drill = await createMinimumProduct(em, {
      sku: `S170-CT-${RUN}`,
      nameEn: GLOBAL,
      namePl: GLOBAL,
      minOrderQuantity: 10,
      channelIds: [vipId, retailId],
    });
    source = await createMinimumProduct(em, {
      sku: `S170-CS-${RUN}`,
      nameEn: `Bit set ${RUN}`,
      namePl: `Bit set ${RUN}`,
      channelIds: [vipId, retailId],
    });
    unitId = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Carton ${RUN}`, baseQuantity: 12 });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: VIP_PL },
      {
        field: `packagingUnit:${unitId}:name`,
        scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' },
        value: `Karton ${RUN}`,
      },
    ]);
    const link = em.create(ProductLink, { sourceProductId: source.id, targetProductId: drill.id, kind: 'up_sell' });
    await em.persistAndFlush(link);
    linkIds.push(link.id);
  });

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await h.em().nativeDelete(ProductLink, { id: { $in: linkIds } });
    await clearValueOverrides(h.em(), [drill.id, source.id]);
    await sql(`delete from product_packaging_unit_scope_overrides where product_id = ?`, [drill.id]);
    await teardownBackendServer(h);
  });

  it('names the line by the C×L translation on its channel, and by the Global name on another (US3 #1)', async () => {
    expect((await add('pl_b2b_vip', { productId: drill.id, quantity: 10 })).statusCode).toBeLessThan(300);
    const vip = await line('pl_b2b_vip', drill.id);
    expect(vip?.productName ?? vip?.name).toBe(VIP_PL);

    expect((await add('pl_retail', { productId: drill.id, quantity: 10 })).statusCode).toBeLessThan(300);
    const retail = await line('pl_retail', drill.id);
    expect(retail?.productName ?? retail?.name).toBe(GLOBAL);
  });

  it('names the product of a minimum refusal at the basket (C, L)', async () => {
    const vip = await add('pl_b2b_vip', { productId: drill.id, quantity: 5 });
    expect(vip.statusCode, vip.body).toBe(422);
    expect((vip.json() as { error: { details: Record<string, unknown> } }).error.details).toMatchObject({
      productName: VIP_PL,
    });
    const retail = await add('pl_retail', { productId: drill.id, quantity: 5 });
    expect(retail.statusCode, retail.body).toBe(422);
    expect((retail.json() as { error: { details: Record<string, unknown> } }).error.details).toMatchObject({
      productName: GLOBAL,
    });
  });

  it('names an up-sell candidate at the basket (C, L)', async () => {
    for (const [code, expected] of [
      ['pl_b2b_vip', VIP_PL],
      ['pl_retail', GLOBAL],
    ] as const) {
      expect((await add(code, { productId: source.id, quantity: 1 })).statusCode).toBeLessThan(300);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart/upsells', cookies: BUYER, headers: on(code) });
      expect(res.statusCode, res.body).toBe(200);
      const hits = (res.json() as { data: Array<{ productId: string; productName: string }> }).data;
      expect(hits.find((c) => c.productId === drill.id)?.productName, code).toBe(expected);
    }
  });

  it('snapshots the packaging-unit name at the line (C, L) and keeps it after the override changes (FR-032)', async () => {
    expect((await add('pl_b2b_vip', { productId: drill.id, quantity: 1, packagingUnitId: unitId })).statusCode).toBeLessThan(
      300,
    );
    expect((await line('pl_b2b_vip', drill.id))?.packagingUnitName).toBe(`Karton ${RUN}`);
    await sql(
      `update product_packaging_unit_scope_overrides set value = ?::jsonb where packaging_unit_id = ? and sales_channel_id = ?`,
      [JSON.stringify({ v: `Pudło ${RUN}` }), unitId, vipId],
    );
    expect((await line('pl_b2b_vip', drill.id))?.packagingUnitName).toBe(`Karton ${RUN}`);

    expect((await add('pl_retail', { productId: drill.id, quantity: 1, packagingUnitId: unitId })).statusCode).toBeLessThan(
      300,
    );
    expect((await line('pl_retail', drill.id))?.packagingUnitName).toBe(`Carton ${RUN}`);
  });

  // Owner decision after C1 (2026-11-03, tasks.md): an empty packaging-unit name override at C or
  // C×L does not blank the basket snapshot — the line keeps the unit's Global name.
  it('keeps the Global packaging-unit name on the snapshot where the override at C or C×L is empty', async () => {
    const em = h.em();
    const emptyAtChannel = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Box C ${RUN}`, baseQuantity: 6 });
    const emptyAtLanguage = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Box CL ${RUN}`, baseQuantity: 4 });
    await seedScopedValues(em, drill.id, [
      { field: `packagingUnit:${emptyAtChannel}:name`, scope: { level: 'channel', channelId: vipId }, value: 'empty' },
      {
        field: `packagingUnit:${emptyAtLanguage}:name`,
        scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' },
        value: 'empty',
      },
    ]);
    for (const [packagingUnitId, globalName] of [
      [emptyAtChannel, `Box C ${RUN}`],
      [emptyAtLanguage, `Box CL ${RUN}`],
    ] as const) {
      await completeActiveBaskets();
      const added = await add('pl_b2b_vip', { productId: drill.id, quantity: 3, packagingUnitId });
      expect(added.statusCode, added.body).toBeLessThan(300);
      expect((await line('pl_b2b_vip', drill.id))?.packagingUnitName, packagingUnitId).toBe(globalName);
    }
  });
});
