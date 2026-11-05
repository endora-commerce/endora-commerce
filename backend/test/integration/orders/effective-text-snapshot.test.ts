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
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/` T051; FR-030, FR-032, US3 #1, #3) — an
 * order line snapshots its product's name, and its packaging unit's, at the order's (channel,
 * language) along C×L → C → Global, and keeps both when the overrides change afterwards. A
 * Polish order on another channel gets the Global strings.
 *
 * Supersedes the 163 `carts/packaging-unit-name-snapshot` order case, which wrote the retired
 * `nameTranslations` map.
 */

/** The warehouse `seedUs2Commerce` stocks (`backend/test/helpers/seed-commerce.ts`). */
const SEED_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
const BUYER = { b2b_session: 'stub-customer-session' };
type Code = 'pl_retail' | 'pl_b2b_vip';
const on = (code: Code): Record<string, string> => ({ 'x-sales-channel': code, 'accept-language': 'pl-PL' });

describe('174 — order line snapshots at the order (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  let unitId = '';
  let vipId = '';
  const GLOBAL = `Drill X ${RUN}`;
  const VIP_PL = `Wiertarka X Pro ${RUN}`;

  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);
  const completeActiveBaskets = () =>
    sql(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);

  async function placeOn(code: Code): Promise<{ product_snapshot: { name: string }; packaging_unit_snapshot: { name: string } | null }> {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: on(code),
      payload: { productId: drill.id, quantity: 1, packagingUnitId: unitId },
    });
    expect(added.statusCode, added.body).toBeLessThan(300);
    const placed = await whenOrderCreatedSettled(h, async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER,
        headers: on(code),
        payload: {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data;
    });
    const rows = (await sql(
      `select product_snapshot, packaging_unit_snapshot from order_items where order_id = ? and product_id = ?`,
      [placed.id, drill.id],
    )) as Array<{ product_snapshot: { name: string }; packaging_unit_snapshot: { name: string } | null }>;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    const retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    drill = await createMinimumProduct(em, {
      sku: `S170-OR-${RUN}`,
      nameEn: GLOBAL,
      namePl: GLOBAL,
      channelIds: [vipId, retailId],
    });
    unitId = await createMinimumPackagingUnit(em, { productId: drill.id, name: `Carton ${RUN}`, baseQuantity: 6 });
    const cl = { level: 'channel_language' as const, channelId: vipId, languageCode: 'pl-PL' };
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: cl, value: VIP_PL },
      { field: `packagingUnit:${unitId}:name`, scope: cl, value: `Karton ${RUN}` },
    ]);
    await sql(
      `insert into stock_levels (id, product_id, warehouse_id, on_hand, reserved, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 1000, 0, now(), now())`,
      [drill.id, SEED_WAREHOUSE_ID],
    );
  });

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await clearValueOverrides(h.em(), [drill.id]);
    await sql(`delete from product_packaging_unit_scope_overrides where product_id = ?`, [drill.id]);
    await sql(`delete from stock_levels where product_id = ?`, [drill.id]);
    await teardownBackendServer(h);
  });

  it('snapshots the C×L names on their channel and keeps them after the overrides change (US3 #3)', async () => {
    const row = await placeOn('pl_b2b_vip');
    expect(row.product_snapshot.name).toBe(`${VIP_PL} (Karton ${RUN})`);
    expect(row.packaging_unit_snapshot?.name).toBe(`Karton ${RUN}`);

    await sql(`update product_value_overrides set value = ?::jsonb where product_id = ? and attribute_key = 'name'`, [
      JSON.stringify({ v: `Inna ${RUN}` }),
      drill.id,
    ]);
    const again = (await sql(
      `select product_snapshot from order_items where product_id = ? order by created_at`,
      [drill.id],
    )) as Array<{ product_snapshot: { name: string } }>;
    expect(again[0]!.product_snapshot.name).toBe(`${VIP_PL} (Karton ${RUN})`);
    await sql(`update product_value_overrides set value = ?::jsonb where product_id = ? and attribute_key = 'name'`, [
      JSON.stringify({ v: VIP_PL }),
      drill.id,
    ]);
  });

  it('snapshots the Global names for a Polish order on a channel without the translation (US3 #1)', async () => {
    const row = await placeOn('pl_retail');
    expect(row.product_snapshot.name).toBe(`${GLOBAL} (Carton ${RUN})`);
    expect(row.packaging_unit_snapshot?.name).toBe(`Carton ${RUN}`);
  });
});
