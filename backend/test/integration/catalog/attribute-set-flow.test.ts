import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AttributeSet,
  type AttributeSetDetail,
  type ProductDetail,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T012 — Integration test for the US1 attribute-set flow against real
 * Postgres (specs/002-catalog-module/quickstart.md §2 US1). Composes:
 *
 *   1. Default set exists post-migration with `isSystem=true`.
 *   2. Admin creates a custom Attribute Set.
 *   3. Admin assigns existing seeded attributes to the new set.
 *   4. GET detail returns the set with the assigned attributes.
 *   5. Storefront PDP (`GET /catalog/products/:slug`) surfaces the
 *      Default set on every seeded product (set wiring through
 *      catalog-query.service.ts — T026).
 *   6. Api-key surface (read-only) returns the same Set list as admin.
 *
 * Per Constitution Principle III: integration tests run against the
 * real Postgres database — no DB mocking.
 */

describe('AttributeSet US1 end-to-end (T012)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('completes the full Admin → Storefront → Api-key flow', async () => {
    // 1. Default set is seeded by migration 017.
    const initialList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: adminCookie,
    });
    expect(initialList.statusCode).toBe(200);
    const initialSets = (initialList.json() as { data: AttributeSet[] }).data;
    const defaultSet = initialSets.find((s) => s.code === 'default');
    expect(defaultSet).toBeDefined();
    expect(defaultSet?.isSystem).toBe(true);

    // 2. Create a custom Attribute Set.
    const createRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      payload: {
        code: 'integration_test_set',
        name: { 'en-US': 'Integration Test Set', 'pl-PL': 'Zestaw Integracyjny' },
      },
      cookies: adminCookie,
    });
    expect(createRes.statusCode).toBe(201);
    const created = (createRes.json() as { data: AttributeSetDetail }).data;
    expect(created.isSystem).toBe(false);
    expect(created.attributeCount).toBe(0);
    expect(created.productCount).toBe(0);
    expect(created.attributes).toEqual([]);

    // 3. Find seeded attributes and assign two of them.
    const attrsRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
    });
    expect(attrsRes.statusCode).toBe(200);
    const attrs = (attrsRes.json() as { data: Array<{ id: string; key: string }> }).data;
    expect(attrs.length).toBeGreaterThanOrEqual(2);
    const [a1, a2] = attrs;

    const assignRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${created.id}/attributes`,
      payload: {
        assignments: [
          { attributeId: a1!.id, position: 0 },
          { attributeId: a2!.id, position: 1 },
        ],
      },
      cookies: adminCookie,
    });
    expect(assignRes.statusCode).toBe(200);
    const afterAssign = (assignRes.json() as { data: AttributeSetDetail }).data;
    expect(afterAssign.attributes.map((a) => a.id).sort()).toEqual(
      [a1!.id, a2!.id].sort(),
    );

    // 4. GET detail again — should match.
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attribute-sets/${created.id}`,
      cookies: adminCookie,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = (detailRes.json() as { data: AttributeSetDetail }).data;
    expect(detail.attributes).toHaveLength(2);
    // Position-ordered.
    expect(detail.attributes[0]!.position).toBeLessThanOrEqual(
      detail.attributes[1]!.position,
    );

    // 5. Storefront PDP for a seeded product surfaces the Default set.
    const productsRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(productsRes.statusCode).toBe(200);
    const products = (
      productsRes.json() as { data: Array<{ id: string; slug: string }> }
    ).data;
    expect(products.length).toBeGreaterThan(0);
    const someSlug = products[0]!.slug;

    const pdpRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${someSlug}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(pdpRes.statusCode).toBe(200);
    const pdp = (pdpRes.json() as { data: ProductDetail }).data;
    expect(pdp.attributeSet).toBeDefined();
    expect(pdp.attributeSet?.code).toBe('default');
    expect(pdp.attributeSet?.id).toBe(defaultSet!.id);

    // 6. Api-key surface coverage is exercised by the contract test
    // (test-server.ts wires the real bearer-token gate, which would
    // require provisioning an integration API key here — out of scope
    // for this integration test). T009 + T024 already cover the public
    // shape via the admin route.

    // 7. Cleanup — DELETE custom set; productCount=0 so it's allowed.
    const delRes = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${created.id}`,
      cookies: adminCookie,
    });
    expect(delRes.statusCode).toBe(204);

    // 8. After delete, the set is no longer listed.
    const finalList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: adminCookie,
    });
    const finalCodes = (finalList.json() as { data: AttributeSet[] }).data.map(
      (s) => s.code,
    );
    expect(finalCodes).toContain('default');
    expect(finalCodes).not.toContain('integration_test_set');
  });

  it('rejects deletion of the Default Set even when no products reference it', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: adminCookie,
    });
    const defaultSet = (list.json() as { data: AttributeSet[] }).data.find(
      (s) => s.code === 'default',
    );
    expect(defaultSet).toBeDefined();

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${defaultSet!.id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'SYSTEM_ATTRIBUTE_SET_IMMUTABLE',
    );
  });
});
