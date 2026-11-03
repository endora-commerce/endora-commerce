import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T054; FR-030, FR-031) — an operator's
 * stock alert has no channel, so it names the product by its **Global** name, never by a channel
 * or channel × language translation (`contracts/readers.md` §1, inventory = G for operator alerts).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
/** The warehouse `seedUs2Commerce` stocks (`backend/test/helpers/seed-commerce.ts`). */
const SEED_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

describe('170 — inventory alerts name products by their Global name [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  const GLOBAL = `Drill X ${RUN}`;
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    drill = await createMinimumProduct(em, { sku: `S170-IN-${RUN}`, nameEn: GLOBAL, namePl: GLOBAL, channelIds: [vipId] });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel', channelId: vipId }, value: `Drill X Pro ${RUN}` },
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: `Wiertarka X Pro ${RUN}` },
    ]);
    await sql(`update products set manage_stock = true, low_stock_threshold = 5 where id = ?`, [drill.id]);
    await sql(
      `insert into stock_levels (id, product_id, warehouse_id, on_hand, reserved, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 2, 0, now(), now())`,
      [drill.id, SEED_WAREHOUSE_ID],
    );
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from stock_levels where product_id = ?`, [drill.id]);
    await clearValueOverrides(h.em(), [drill.id]);
    await teardownBackendServer(h);
  });

  it('the low-stock list names the product by its Global name', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/inventory/low-stock', cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { items: Array<{ productId: string; productName: string }> }).items.find(
      (i) => i.productId === drill.id,
    );
    expect(row?.productName).toBe(GLOBAL);
  });

  // Blocked (reported to the coordinator): `availability_notifications` stores no channel and no
  // language, so "the subscription's channel and language" (readers.md §1) has no source. It needs
  // a data-model entry and an inventory migration before the e-mail can read `effectiveTexts`.
  it.todo("the back-in-stock e-mail names the product at the subscription's channel and language");
});
