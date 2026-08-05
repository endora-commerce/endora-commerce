import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';

/**
 * T019 (feature 068) — deactivating a category removes it from every
 * customer-facing read while leaving it in the admin tree.
 *
 * The seeded fixture gives `small-widgets` (a child of `widgets`) holding the
 * two seeded products, published in `pl_retail`. Toggling `isActive` must:
 *
 *   (a) drop it from the public category tree;
 *   (b) make `filter[category]=small-widgets` yield an empty product set;
 *   (c) drop it from the channel sitemap;
 *   (d) re-index every product in its subtree (data-model.md §11 "side effects
 *       on toggle" — otherwise Meilisearch keeps serving the stale
 *       `categorySlugs` value as a PLP filter);
 *   (e) leave it listed by the admin API, because an administrator must be
 *       able to find what they can re-enable.
 */

interface PublicCategoryNode {
  id: string;
  slug: string;
  children: PublicCategoryNode[];
}

interface AdminCategoryShape {
  id: string;
  slug: string;
  isActive: boolean;
}

const ADMIN = { b2b_session: 'stub-admin-session' };
const RETAIL = 'pl_retail';
const TARGET_SLUG = 'small-widgets';

function flatten(nodes: PublicCategoryNode[]): PublicCategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

describe('category activation — customer-facing reads (T019)', () => {
  let h: BackendServerHandle;
  let targetId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const rows = await adminCategories();
    const target = rows.find((c) => c.slug === TARGET_SLUG);
    if (!target) throw new Error(`fixture category "${TARGET_SLUG}" missing`);
    targetId = target.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function adminCategories(): Promise<AdminCategoryShape[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: AdminCategoryShape[] }).data;
  }

  async function publicTreeSlugs(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/categories',
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.statusCode).toBe(200);
    return flatten((res.json() as { data: PublicCategoryNode[] }).data).map((n) => n.slug);
  }

  async function productsInCategory(slug: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?filter[category]=${slug}`,
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
  }

  async function sitemap(): Promise<string> {
    const regenerated = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: ADMIN,
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(regenerated.statusCode).toBe(200);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/sitemap.xml',
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  async function setActive(isActive: boolean): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${targetId}`,
      cookies: ADMIN,
      payload: { isActive },
    });
    expect(res.statusCode).toBe(200);
  }

  it('is visible everywhere while active (baseline)', async () => {
    expect(await publicTreeSlugs()).toContain(TARGET_SLUG);
    expect((await productsInCategory(TARGET_SLUG)).length).toBeGreaterThan(0);
    expect(await sitemap()).toContain(`/c/${TARGET_SLUG}`);
  });

  it('re-indexes every product in the subtree when the flag toggles', async () => {
    const spy = vi.spyOn(h.search.indexer, 'upsertProduct').mockResolvedValue([]);
    try {
      await setActive(false);
      const reindexed = spy.mock.calls.map(([, productId]) => productId);
      expect(reindexed).toContain(SEED_PRODUCT_101_ID);
      expect(reindexed).toContain(SEED_PRODUCT_102_ID);
    } finally {
      spy.mockRestore();
    }
  });

  it('disappears from the public category tree once inactive', async () => {
    expect(await publicTreeSlugs()).not.toContain(TARGET_SLUG);
  });

  it('yields an empty product set for filter[category] once inactive', async () => {
    expect(await productsInCategory(TARGET_SLUG)).toEqual([]);
  });

  it('disappears from the sitemap once inactive', async () => {
    expect(await sitemap()).not.toContain(`/c/${TARGET_SLUG}`);
  });

  it('is still returned by the admin category list once inactive', async () => {
    const row = (await adminCategories()).find((c) => c.id === targetId);
    expect(row).toBeDefined();
    expect(row?.isActive).toBe(false);
  });

  it('comes back everywhere when re-activated', async () => {
    await setActive(true);
    expect(await publicTreeSlugs()).toContain(TARGET_SLUG);
    expect((await productsInCategory(TARGET_SLUG)).length).toBeGreaterThan(0);
    expect(await sitemap()).toContain(`/c/${TARGET_SLUG}`);
  });
});
