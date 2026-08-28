import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Category } from '../../helpers/package-entities.js';
import { CatalogQueryService } from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Regression guard for `CatalogQueryService.expandCategoryProductIds`, the
 * cross-module port feature 067's feed criteria compiler walks the category
 * tree with.
 *
 * The walk is a breadth-first descent over `parent_category_id`. Re-parenting
 * refuses to create a cycle, but that guard is itself written to tolerate
 * *pre-existing* cycles ("defensive guard against pre-existing cycles" in
 * `category-admin.service.ts`), so corrupted data can reach this method. An
 * unguarded descent then never terminates: it re-queries the same level for
 * ever and accumulates descendants without bound, hanging the request or the
 * feed worker that called it.
 *
 * A cycle cannot be produced through the admin API by design, so this writes
 * one directly — which is exactly the state the method has to survive.
 */
describe('expandCategoryProductIds — cyclic category data', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('terminates on a parent chain that loops back on itself', async () => {
    const em = h.orm.em.fork();
    const suffix = randomUUID().slice(0, 8);

    // a → b → c → a. Persisted with the cycle closed in a second flush,
    // because the first insert cannot reference a row that does not exist yet.
    const a = em.create(Category, { name: { en: 'A' }, slug: `cycle-a-${suffix}` });
    const b = em.create(Category, { name: { en: 'B' }, slug: `cycle-b-${suffix}` });
    const c = em.create(Category, { name: { en: 'C' }, slug: `cycle-c-${suffix}` });
    await em.persistAndFlush([a, b, c]);

    b.parentCategoryId = a.id;
    c.parentCategoryId = b.id;
    a.parentCategoryId = c.id;
    await em.flush();

    const service = new CatalogQueryService(
      () => h.orm.em.fork(),
      undefined,
      undefined,
      undefined,
      undefined,
      h.assetRead,
      h.salesChannels.membershipService,
    );

    // The assertion that matters is that this resolves at all. A hang fails
    // the test through vitest's own timeout rather than through an
    // expectation, so the timeout is deliberately far below the default.
    const result = await service.expandCategoryProductIds([a.id]);

    expect(result.has(a.id)).toBe(true);
    // No products are attached, so the set is empty — the point is that the
    // walk visited each node once instead of spinning.
    expect(result.get(a.id)?.size).toBe(0);
  }, 15_000);

  it('still returns an entry for a category id that does not exist', async () => {
    const service = new CatalogQueryService(
      () => h.orm.em.fork(),
      undefined,
      undefined,
      undefined,
      undefined,
      h.assetRead,
      h.salesChannels.membershipService,
    );
    const missing = randomUUID();

    const result = await service.expandCategoryProductIds([missing]);

    // Documented contract: unknown ids come back as empty sets rather than
    // being dropped, so a criterion naming a deleted category narrows to
    // nothing instead of silently disappearing.
    expect(result.get(missing)).toEqual(new Set());
  });
});
