import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';

/**
 * Feature 011 / US7 — Display-mode override + storefront mode endpoints (T078).
 *
 * Covers:
 *   - GET    /api/v1/admin/pricing/display-mode-overrides
 *   - GET    /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId
 *   - PUT    /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId
 *   - GET    /api/v1/storefront/pricing/display-mode/:productId
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Display-mode endpoints (feature 011 US7)', () => {
  let h: BackendServerHandle;
  let organizationId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'US7 Contract Org',
      taxId: `US7C-${Date.now() % 10_000_000}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'X', city: 'X', postalCode: 'X', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(`truncate table "price_display_mode_overrides" cascade`);
  });

  it('PUT upserts a Product-level override and returns the row', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'none' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { scope: string; targetId: string; mode: string };
    };
    expect(body.data.scope).toBe('product');
    expect(body.data.targetId).toBe(SEED_PRODUCT_101_ID);
    expect(body.data.mode).toBe('none');
  });

  it('PUT with mode=inherit deletes the override (204 with no body)', async () => {
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'gross_only' },
    });
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'inherit' },
    });
    expect(res.statusCode).toBe(204);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
    });
    expect(get.statusCode).toBe(404);
  });

  it('PUT refuses an override targeting a non-existent row (400)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/pricing/display-mode-overrides/product/00000000-0000-4000-8000-000000ffff00',
      cookies: ADMIN_COOKIE,
      payload: { mode: 'none' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET list returns every override, optionally filtered by scope', async () => {
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'gross_only' },
    });
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/organization/${organizationId}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'both' },
    });

    const all = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/display-mode-overrides',
      cookies: ADMIN_COOKIE,
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as { data: { items: unknown[] } };
    expect(allBody.data.items).toHaveLength(2);

    const onlyProduct = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/display-mode-overrides?scope=product',
      cookies: ADMIN_COOKIE,
    });
    expect(onlyProduct.statusCode).toBe(200);
    const productBody = onlyProduct.json() as {
      data: { items: Array<{ scope: string }> };
    };
    expect(productBody.data.items).toHaveLength(1);
    expect(productBody.data.items[0]?.scope).toBe('product');
  });

  it('GET storefront /display-mode/:productId returns the resolved mode', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/pricing/display-mode/${SEED_PRODUCT_101_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { displayMode: string } };
    // No override + no settings change → manifest default `gross_only`.
    expect(body.data.displayMode).toBe('gross_only');
  });

  it('GET storefront /display-mode/:productId honours a Product override', async () => {
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`,
      cookies: ADMIN_COOKIE,
      payload: { mode: 'none' },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/pricing/display-mode/${SEED_PRODUCT_101_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { displayMode: string } };
    expect(body.data.displayMode).toBe('none');
  });

  it('GET storefront /display-mode/:productId returns 404 for unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/pricing/display-mode/00000000-0000-4000-8000-000000ffff99',
    });
    expect(res.statusCode).toBe(404);
  });
});
