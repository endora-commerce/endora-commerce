import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Regression: a parent category's `productCount` must roll up the distinct
 * products of its whole subtree (self + descendants), not just the products
 * assigned directly to it. The catalog root would otherwise show 0 on the
 * storefront because products are assigned to its leaf categories.
 *
 * Seed (us1-catalog) `widgets` tree:
 *   widgets (root)      ← exampleC assigned directly
 *     small-widgets     ← exampleSimple, exampleB
 *     large-widgets     ← exampleC
 *
 * Distinct subtree count for the root = {simple, B, exampleC} = 3 (exampleC is
 * in both the root and large-widgets but counts once).
 */
interface CategoryShape {
  slug: string;
  productCount: number;
  children: CategoryShape[];
}

function findBySlug(nodes: CategoryShape[], slug: string): CategoryShape | undefined {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const found = findBySlug(n.children, slug);
    if (found) return found;
  }
  return undefined;
}

describe('GET /api/v1/catalog/categories — subtree product counts', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rolls up distinct descendant products into the parent count', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/categories',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: CategoryShape[] };

    const root = findBySlug(body.data, 'widgets');
    const small = findBySlug(body.data, 'small-widgets');
    const large = findBySlug(body.data, 'large-widgets');

    expect(small?.productCount).toBe(2);
    expect(large?.productCount).toBe(1);
    // Root rolls up its own direct product plus both children, de-duplicated.
    expect(root?.productCount).toBe(3);
  });
});
