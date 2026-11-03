import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminProductVariantsResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 161 (Checkpoint 5 review) — an admin read of a product's variants,
 * `GET /api/v1/admin/catalog/products/:id/variants` (`catalog:read`).
 *
 * The price-book grid expands a product line to every variant the catalogue
 * holds (FR-009). The storefront's product read, which the catalogue's own
 * editor borrowed for its variants list, is the **buyer's** view: a product
 * outside the request's sales channel answers `404`, archived or not — since
 * spec 163 (FR-005, O-3) the archived product's `410` is answered only where
 * the product would otherwise be available, and both fixtures sit in the
 * system-default channel only, never in CH1. Both are asserted below, so the finding that ruled it out stays on
 * record; the admin read answers every variant of both.
 */
describe('admin product variants read (161)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const admin = { b2b_session: 'stub-admin-session' };
  let unpublished: string;
  let inactive: string;

  async function configurable(suffix: string, variants: readonly string[]): Promise<string> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: admin,
      payload: {
        sku: `VR-${suffix}`,
        type: 'configurable',
        name: `Variant read ${suffix}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    for (const sku of variants) {
      const variant = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${id}/variants`,
        cookies: admin,
        payload: { sku, variantAttributeValues: { color: sku.endsWith('R') ? 'red' : 'blue' } },
      });
      expect(variant.statusCode, variant.body).toBe(201);
    }
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    // Created through the admin API and bound to no sales channel.
    unpublished = await configurable('U', ['VR-U-R', 'VR-U-B']);
    inactive = await configurable('I', ['VR-I-R', 'VR-I-B']);
    // Spec 163 — archiving is its own action; a status write no longer archives.
    const archived = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${inactive}/archive`,
      cookies: admin,
    });
    expect(archived.statusCode, archived.body).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const publicRead = (id: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${id}`, cookies: admin, headers: { 'x-sales-channel': f.channels.CH1.code } });
  const adminRead = (id: string, cookies: Record<string, string> = admin) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${id}/variants`, cookies });

  it('the storefront read is the buyer’s view: it hides both products', async () => {
    expect((await publicRead(unpublished)).statusCode).toBe(404);
    // Archived, but not a member of CH1: the absent product's 404, never the 410 (spec 163, O-3).
    expect((await publicRead(inactive)).statusCode).toBe(404);
  });

  it('answers every variant of a product outside the channel and of an inactive one', async () => {
    for (const [id, skus] of [
      [unpublished, ['VR-U-B', 'VR-U-R']],
      [inactive, ['VR-I-B', 'VR-I-R']],
    ] as const) {
      const res = await adminRead(id);
      expect(res.statusCode, res.body).toBe(200);
      const body = adminProductVariantsResponseSchema.parse(res.json());
      expect(body.data.map((v) => v.sku)).toEqual(skus);
      expect(body.data.every((v) => v.parentProductId === id)).toBe(true);
    }
  });

  it('answers an unknown product 404 and refuses a caller without catalog:read', async () => {
    expect((await adminRead('00000000-0000-4000-8000-0000001619ee')).statusCode).toBe(404);
    expect((await adminRead(unpublished, {})).statusCode).toBe(401);
  });
});
