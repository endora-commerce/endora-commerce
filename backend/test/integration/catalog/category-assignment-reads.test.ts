import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogCategoryReadPort } from '@endora-commerce/contracts';
import { Category } from '../../helpers/package-entities.js';
import { Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The two assignment reads `catalog` publishes for `pim_ergonode` (feature 075,
 * D-87 drain).
 *
 * `listProductIdsInCategory` and `countLiveProductsByCategory` are transcribed
 * from statements `pim_ergonode` used to run itself — one to find the products
 * of a category the source tree dropped, one to count the products behind each
 * row of the category-mapping screen. Both named `product_categories`, and the
 * count also named `products`, which is why moving them mattered: raw SQL names
 * no import specifier, so both kept answering after an operator switched
 * `catalog` off.
 *
 * Transcription is the risk, so both filters are asserted rather than assumed:
 * the count drops a soft-deleted product and the id list does not, and neither
 * reaches into a child category.
 */
describe('catalog — the category assignment reads its neighbours read [integration]', () => {
  let h: BackendServerHandle;
  let parentId: string;
  let childId: string;
  let liveProductId: string;
  let deletedProductId: string;

  function port(): CatalogCategoryReadPort {
    return (
      h.container.cradle as unknown as { catalogCategoryReadPort: CatalogCategoryReadPort }
    ).catalogCategoryReadPort;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const suffix = randomUUID().slice(0, 8);

    const parent = em.create(Category, {
      slug: `assign-parent-${suffix}`,
      name: { 'en-US': 'Parent' },
      sortOrder: 0,
      isActive: true,
    });
    const child = em.create(Category, {
      slug: `assign-child-${suffix}`,
      name: { 'en-US': 'Child' },
      sortOrder: 0,
      isActive: true,
    });
    await em.persistAndFlush([parent, child]);
    child.parentCategoryId = parent.id;
    await em.flush();
    parentId = parent.id;
    childId = child.id;

    // The attribute set of a seeded product, so these three are shaped like the
    // catalogue's own rows rather than pointing at a set nothing else uses.
    const attributeSetId = (await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID }))
      .attributeSetId;
    const live = em.create(Product, {
      sku: `ASSIGN-LIVE-${suffix}`,
      slug: `assign-live-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Live' },
      description: {},
      visibility: 'public',
      attributeSetId,
    });
    const deleted = em.create(Product, {
      sku: `ASSIGN-DEAD-${suffix}`,
      slug: `assign-dead-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Soft-deleted' },
      description: {},
      visibility: 'public',
      attributeSetId,
      deletedAt: new Date(),
    });
    const inChild = em.create(Product, {
      sku: `ASSIGN-CHILD-${suffix}`,
      slug: `assign-child-product-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'In the child' },
      description: {},
      visibility: 'public',
      attributeSetId,
    });
    await em.persistAndFlush([live, deleted, inChild]);
    liveProductId = live.id;
    deletedProductId = deleted.id;

    // The bridge table has no entity class, which is exactly why the two
    // neighbours wrote SQL against it and why the port exists.
    for (const [productId, categoryId] of [
      [live.id, parentId],
      [deleted.id, parentId],
      [inChild.id, childId],
    ] as const) {
      await em
        .getConnection()
        .execute('insert into "product_categories" ("product_id", "category_id") values (?, ?)', [
          productId,
          categoryId,
        ]);
    }
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists the products of the category itself, not of its children', async () => {
    const ids = await port().listProductIdsInCategory(parentId);
    expect([...ids].sort()).toEqual([liveProductId, deletedProductId].sort());
  });

  it('lists a soft-deleted product too, because the assignment is the fact asked about', async () => {
    // Structural on purpose: the caller is detaching products from a category
    // that left the source tree, and it wants the row gone whatever state the
    // product is in.
    expect(await port().listProductIdsInCategory(parentId)).toContain(deletedProductId);
  });

  it('counts only live products, and omits a category with none', async () => {
    const counts = await port().countLiveProductsByCategory([parentId, childId, randomUUID()]);
    const byCategory = new Map(counts.map((row) => [row.categoryId, row.productCount]));
    // Two rows are assigned to the parent and one of them is soft-deleted: a
    // deleted product is not in the category any more in any sense an operator
    // means, which is the filter the caller this replaced had written into its
    // own join.
    expect(byCategory.get(parentId)).toBe(1);
    expect(byCategory.get(childId)).toBe(1);
    // A category nothing points at is absent rather than zero, so the caller
    // decides what it renders as.
    expect(counts).toHaveLength(2);
  });

  it('answers an empty id list without asking the database', async () => {
    expect(await port().countLiveProductsByCategory([])).toEqual([]);
  });
});
