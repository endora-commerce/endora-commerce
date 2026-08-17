import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Issue #174 — quick-order type-ahead is scoped to the resolved sales channel
 * (Constitution XII).
 *
 * `quick_order/routes.ts` used to answer this endpoint from a hand-written
 * knex `select` against `catalog`'s `products` table, filtering on
 * `status = 'active'` and nothing else. A signed-in buyer shopping `pl_retail`
 * therefore got back **every active product on the platform**, including ones
 * bound only to a channel they have no access to — SKU, slug, name and status,
 * enough to then quote or order them by id.
 *
 * The remedy is `catalogQuickSearchPort`: `catalog` owns the predicate, and it
 * applies the same `sales_channel_products` membership filter its own public
 * listing applies (`CatalogQueryService.filterByChannel`).
 *
 * Read this test as a pair. The first case is the defect and fails against the
 * knex query; the second is the restoration, and would pass either way — which
 * is exactly why the first one has to exist.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const SKU = 'QO-VIP-ONLY-0001';

async function search(
  h: BackendServerHandle,
  q: string,
  channelCode: string,
): Promise<Array<{ productId: string; sku: string }>> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}`,
    headers: { 'x-sales-channel': channelCode },
    cookies: COOKIE,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Array<{ productId: string; sku: string }> }).data;
}

describe('GET /api/v1/quick-order/search — sales-channel scoping', () => {
  let h: BackendServerHandle;
  let vipOnlyProductId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const vip = await em.findOne(SalesChannel, { code: 'pl_b2b_vip' });
    expect(vip, 'the harness seeds pl_b2b_vip').not.toBeNull();

    // Bound to `pl_b2b_vip` and to nothing else. The seeded products are all in
    // both channels, so a channel assertion over them cannot fail.
    const product = em.create(Product, {
      sku: SKU,
      slug: 'qo-vip-only-0001',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'VIP-only quick-order probe' },
      description: { 'en-US': 'Bound to pl_b2b_vip only.' },
      visibility: 'public',
      attributeValues: { defaultPrice: 10 },
    });
    await em.persistAndFlush(product);
    vipOnlyProductId = product.id;

    await em
      .getConnection()
      .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
        vip!.id,
        product.id,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('does not disclose a product bound only to another channel', async () => {
    const results = await search(h, SKU, 'pl_retail');
    expect(
      results.map((r) => r.productId),
      'a buyer shopping pl_retail must not see a pl_b2b_vip-only product in type-ahead',
    ).not.toContain(vipOnlyProductId);
  });

  it('discloses it on the channel it is bound to', async () => {
    const results = await search(h, SKU, 'pl_b2b_vip');
    expect(results.map((r) => r.productId)).toContain(vipOnlyProductId);
  });

  it('still finds a product bound to the channel being shopped', async () => {
    // The restoration half: scoping must narrow, not empty, the result set.
    const results = await search(h, 'EXAMPLE-SIMPLE', 'pl_retail');
    expect(results.map((r) => r.sku)).toContain('EXAMPLE-SIMPLE-001');
  });
});
