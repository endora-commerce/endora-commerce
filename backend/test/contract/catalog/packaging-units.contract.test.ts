import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 043 — Contract test for product packaging-unit admin CRUD.
 *
 *   GET    /api/v1/admin/catalog/products/:productId/packaging-units
 *   POST   …/packaging-units
 *   PATCH  …/packaging-units/:unitId
 *   DELETE …/packaging-units/:unitId
 *   PATCH  …/packaging-units/reorder
 */
describe('Admin packaging units contract (043)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProduct(suffix: string, type = 'simple'): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `PKG-${suffix}`,
        type,
        name: { 'en-US': `Packaging parent ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  function base(productId: string): string {
    return `/api/v1/admin/catalog/products/${productId}/packaging-units`;
  }

  it('creates, lists, updates, and deletes packaging units', async () => {
    const productId = await createProduct(`crud-${Date.now()}`);

    const created = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: 'Paleta', baseQuantity: 480, isDefault: true },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const unit = (created.json() as { data: { id: string; name: string; baseQuantity: number; isDefault: boolean; position: number } }).data;
    expect(unit.name).toBe('Paleta');
    expect(unit.baseQuantity).toBe(480);
    expect(unit.isDefault).toBe(true);

    const second = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: 'Karton', baseQuantity: 24 },
      cookies: adminCookie,
    });
    expect(second.statusCode).toBe(201);
    const karton = (second.json() as { data: { id: string } }).data;

    const list = await h.app.inject({ method: 'GET', url: base(productId), cookies: adminCookie });
    expect(list.statusCode).toBe(200);
    const units = (list.json() as { data: Array<{ name: string }> }).data;
    expect(units.map((u) => u.name)).toEqual(['Paleta', 'Karton']);

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/${karton.id}`,
      payload: { baseQuantity: 48 },
      cookies: adminCookie,
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { data: { baseQuantity: number } }).data.baseQuantity).toBe(48);

    const reordered = await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/reorder`,
      payload: { orderedIds: [karton.id, unit.id] },
      cookies: adminCookie,
    });
    expect(reordered.statusCode).toBe(200);
    expect((reordered.json() as { data: Array<{ name: string }> }).data.map((u) => u.name)).toEqual([
      'Karton',
      'Paleta',
    ]);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `${base(productId)}/${karton.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('setting a new default clears the previous default', async () => {
    const productId = await createProduct(`default-${Date.now()}`);
    const a = (await (await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'A', baseQuantity: 10, isDefault: true }, cookies: adminCookie })).json() as { data: { id: string } }).data;
    const b = (await (await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'B', baseQuantity: 20 }, cookies: adminCookie })).json() as { data: { id: string } }).data;
    await h.app.inject({ method: 'PATCH', url: `${base(productId)}/${b.id}`, payload: { isDefault: true }, cookies: adminCookie });

    const list = (await (await h.app.inject({ method: 'GET', url: base(productId), cookies: adminCookie })).json() as { data: Array<{ id: string; isDefault: boolean }> }).data;
    expect(list.find((u) => u.id === a.id)?.isDefault).toBe(false);
    expect(list.find((u) => u.id === b.id)?.isDefault).toBe(true);
  });

  it('rejects invalid quantity, duplicate name, and ineligible product type', async () => {
    const productId = await createProduct(`val-${Date.now()}`);

    const zero = await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'Zero', baseQuantity: 0 }, cookies: adminCookie });
    expect(zero.statusCode).toBe(400);

    const blank = await h.app.inject({ method: 'POST', url: base(productId), payload: { name: '   ', baseQuantity: 5 }, cookies: adminCookie });
    expect(blank.statusCode).toBe(400);

    const fractional = await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'Frac', baseQuantity: 1.5 }, cookies: adminCookie });
    expect(fractional.statusCode).toBe(400);

    await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'Paleta', baseQuantity: 480 }, cookies: adminCookie });
    const dup = await h.app.inject({ method: 'POST', url: base(productId), payload: { name: 'Paleta', baseQuantity: 100 }, cookies: adminCookie });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PACKAGING_UNIT_NAME_CONFLICT);

    const groupedId = await createProduct(`grp-${Date.now()}`, 'grouped');
    const notSupported = await h.app.inject({ method: 'POST', url: base(groupedId), payload: { name: 'Paleta', baseQuantity: 480 }, cookies: adminCookie });
    expect(notSupported.statusCode).toBe(422);
    expect((notSupported.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE);
  });

  it('404s for unknown product or unit', async () => {
    const unknownProduct = '00000000-0000-4000-8000-000000000000';
    const res = await h.app.inject({ method: 'GET', url: base(unknownProduct), cookies: adminCookie });
    expect(res.statusCode).toBe(404);

    const productId = await createProduct(`nf-${Date.now()}`);
    const unknownUnit = await h.app.inject({ method: 'DELETE', url: `${base(productId)}/00000000-0000-4000-8000-000000000001`, cookies: adminCookie });
    expect(unknownUnit.statusCode).toBe(404);
  });
});
