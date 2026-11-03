import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T052; FR-030, FR-032, US3 #1, #3) — a
 * quote-request line snapshots the product name and the packaging-unit name at the request's
 * (channel, language) along C×L → C → Global, keeps both after the overrides change, and a
 * Polish request on another channel snapshots the Global strings. A minimum refusal names the
 * product at the same scope.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
type Code = 'pl_retail' | 'pl_b2b_vip';
const on = (code: Code): Record<string, string> => ({ 'x-sales-channel': code, 'accept-language': 'pl-PL' });

describe('170 — quote-request line snapshots at the request (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  let bolt: MinimumProductFixture;
  let unitId = '';
  let vipId = '';
  const GLOBAL = `Drill X ${RUN}`;
  const VIP_PL = `Wiertarka X Pro ${RUN}`;
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);

  const lineName = (body: unknown, productId: string): string | undefined =>
    (body as { data: { items: Array<{ productId: string; productName: string }> } }).data.items.find(
      (i) => i.productId === productId,
    )?.productName;

  const create = (code: Code, items: unknown[]) =>
    h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies: BUYER, headers: on(code), payload: { items } });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    const retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    drill = await createMinimumProduct(em, { sku: `S170-QR-${RUN}`, nameEn: GLOBAL, namePl: GLOBAL, channelIds: [vipId, retailId] });
    bolt = await createMinimumProduct(em, {
      sku: `S170-QB-${RUN}`,
      nameEn: `Bolt ${RUN}`,
      namePl: `Bolt ${RUN}`,
      minOrderQuantity: 10,
      channelIds: [vipId, retailId],
    });
    unitId = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Carton ${RUN}`, baseQuantity: 6 });
    const cl = { level: 'channel_language' as const, channelId: vipId, languageCode: 'pl-PL' };
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: cl, value: VIP_PL },
      { field: `packagingUnit:${unitId}:name`, scope: cl, value: `Karton ${RUN}` },
    ]);
    await seedScopedValues(em, bolt.id, [{ field: 'name', scope: cl, value: `Śruba ${RUN}` }]);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [drill.id, bolt.id]);
    await sql(`delete from product_packaging_unit_scope_overrides where product_id = ?`, [drill.id]);
    await teardownBackendServer(h);
  });

  it('snapshots the C×L product and unit names on their channel and keeps them (US3 #3)', async () => {
    const res = await create('pl_b2b_vip', [{ productId: drill.id, quantity: 1, packagingUnitId: unitId }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(lineName(res.json(), drill.id)).toBe(`${VIP_PL} (Karton ${RUN})`);
    const id = (res.json() as { data: { id: string } }).data.id;
    const unitRow = (await sql(
      `select packaging_unit_name from quote_request_items where quote_request_id = ? and product_id = ?`,
      [id, drill.id],
    )) as Array<{ packaging_unit_name: string | null }>;
    expect(unitRow[0]?.packaging_unit_name).toBe(`Karton ${RUN}`);

    await sql(`update product_value_overrides set value = ?::jsonb where product_id = ? and attribute_key = 'name'`, [
      JSON.stringify({ v: `Inna ${RUN}` }),
      drill.id,
    ]);
    await sql(`update product_packaging_unit_scope_overrides set value = ?::jsonb where packaging_unit_id = ?`, [
      JSON.stringify({ v: `Pudło ${RUN}` }),
      unitId,
    ]);
    const again = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: BUYER, headers: on('pl_b2b_vip') });
    expect(again.statusCode, again.body).toBe(200);
    expect(lineName(again.json(), drill.id)).toBe(`${VIP_PL} (Karton ${RUN})`);
    await sql(`update product_value_overrides set value = ?::jsonb where product_id = ? and attribute_key = 'name'`, [
      JSON.stringify({ v: VIP_PL }),
      drill.id,
    ]);
    await sql(`update product_packaging_unit_scope_overrides set value = ?::jsonb where packaging_unit_id = ?`, [
      JSON.stringify({ v: `Karton ${RUN}` }),
      unitId,
    ]);
  });

  it('snapshots the Global names for a Polish request on a channel without the translation (US3 #1)', async () => {
    const res = await create('pl_retail', [{ productId: drill.id, quantity: 1, packagingUnitId: unitId }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(lineName(res.json(), drill.id)).toBe(`${GLOBAL} (Carton ${RUN})`);
  });

  it('names the product of a minimum refusal at the request (C, L)', async () => {
    const vip = await create('pl_b2b_vip', [{ productId: bolt.id, quantity: 5 }]);
    expect(vip.statusCode, vip.body).toBe(422);
    expect((vip.json() as { error: { details: Record<string, unknown> } }).error.details).toMatchObject({
      productName: `Śruba ${RUN}`,
    });
    const retail = await create('pl_retail', [{ productId: bolt.id, quantity: 5 }]);
    expect(retail.statusCode, retail.body).toBe(422);
    expect((retail.json() as { error: { details: Record<string, unknown> } }).error.details).toMatchObject({
      productName: `Bolt ${RUN}`,
    });
  });

  // Owner decision after C1 (2026-11-03, tasks.md): an empty packaging-unit name override at C or
  // C×L does not blank the request's snapshot — the line keeps the unit's Global name.
  it('keeps the Global packaging-unit name on the snapshot where the override at C or C×L is empty', async () => {
    const em = h.em();
    const emptyAtChannel = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Box C ${RUN}`, baseQuantity: 3 });
    const emptyAtLanguage = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Box CL ${RUN}`, baseQuantity: 2 });
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
      const res = await create('pl_b2b_vip', [{ productId: drill.id, quantity: 1, packagingUnitId }]);
      expect(res.statusCode, res.body).toBe(201);
      expect(lineName(res.json(), drill.id), packagingUnitId).toBe(`${VIP_PL} (${globalName})`);
      const id = (res.json() as { data: { id: string } }).data.id;
      const unitRow = (await sql(
        `select packaging_unit_name from quote_request_items where quote_request_id = ? and product_id = ?`,
        [id, drill.id],
      )) as Array<{ packaging_unit_name: string | null }>;
      expect(unitRow[0]?.packaging_unit_name, packagingUnitId).toBe(globalName);
    }
  });
});
