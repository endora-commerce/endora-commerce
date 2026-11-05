import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES, type CatalogPackagingPort } from '@endora-commerce/contracts';
import type { HttpError } from '@endora-commerce/platform/http';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 155, Phase 5 (T029) — `minOrderUnits` on packaging units
 * (`specs/155-catalog-order-constraints/contracts/catalog-api.md` §3).
 *
 * The admin routes accept, clear and echo it and still refuse an unknown key;
 * the audit carries it; and `CatalogPackagingPort` — which in-process callers
 * such as `pim_pimcore` reach with no route schema in front of it — keeps
 * working without the key and refuses an out-of-range value in the service
 * (FR-002, threat F5).
 */
describe('155 — packaging-unit minOrderUnits [contract]', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `PKG-MOU-${RUN}-${suffix}`,
        type: 'simple',
        name: `Packaging minimum ${RUN} ${suffix}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const base = (productId: string): string =>
    `/api/v1/admin/catalog/products/${productId}/packaging-units`;

  const port = (): CatalogPackagingPort =>
    h.container.resolve<CatalogPackagingPort>('packagingUnitService');

  type UnitBody = { data: { id: string; minOrderUnits?: number | null } };

  it('creates without the key (null), with it, updates, clears, and lists it', async () => {
    const productId = await createProduct('crud');

    const plain = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Karton ${RUN}`, baseQuantity: 24 },
      cookies: adminCookie,
    });
    expect(plain.statusCode).toBe(201);
    expect((plain.json() as UnitBody).data.minOrderUnits).toBeNull();

    const withMin = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Paleta ${RUN}`, baseQuantity: 480, minOrderUnits: 2 },
      cookies: adminCookie,
    });
    expect(withMin.statusCode).toBe(201);
    const unit = (withMin.json() as UnitBody).data;
    expect(unit.minOrderUnits).toBe(2);

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/${unit.id}`,
      payload: { minOrderUnits: 1_000_000 },
      cookies: adminCookie,
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as UnitBody).data.minOrderUnits).toBe(1_000_000);

    const cleared = await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/${unit.id}`,
      payload: { minOrderUnits: null },
      cookies: adminCookie,
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as UnitBody).data.minOrderUnits).toBeNull();

    const list = await h.app.inject({ method: 'GET', url: base(productId), cookies: adminCookie });
    const units = (list.json() as { data: Array<{ id: string; minOrderUnits?: number | null }> }).data;
    expect(units.every((u) => u.minOrderUnits === null)).toBe(true);
  });

  it.each([0, 1_000_001])('refuses minOrderUnits %s through the route with 400', async (value) => {
    const productId = await createProduct(`route-range-${value}`);
    const created = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Range ${RUN}`, baseQuantity: 10, minOrderUnits: value },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(400);
    expect((created.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    const ok = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Range ok ${RUN}`, baseQuantity: 10 },
      cookies: adminCookie,
    });
    const unitId = (ok.json() as UnitBody).data.id;
    const updated = await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/${unitId}`,
      payload: { minOrderUnits: value },
      cookies: adminCookie,
    });
    expect(updated.statusCode).toBe(400);
  });

  it('still refuses an unknown key (the admin schemas stay strict)', async () => {
    const productId = await createProduct('strict');
    const res = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Strict ${RUN}`, baseQuantity: 10, minOrderUnits: 2, minimumUnits: 3 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('audits minOrderUnits in before/after (FR-005)', async () => {
    const productId = await createProduct('audit');
    const created = await h.app.inject({
      method: 'POST',
      url: base(productId),
      payload: { name: `Audit ${RUN}`, baseQuantity: 12, minOrderUnits: 3 },
      cookies: adminCookie,
    });
    const unitId = (created.json() as UnitBody).data.id;
    await h.app.inject({
      method: 'PATCH',
      url: `${base(productId)}/${unitId}`,
      payload: { minOrderUnits: 5 },
      cookies: adminCookie,
    });

    // The Command's row (`objectType: 'packaging_unit'`) — since feature 163 (FR-080) the
    // only one: the route no longer writes a bare `product_packaging_unit` row beside it.
    const createRows = await h
      .em()
      .find(AuditLogEntry, { action: 'packaging_unit.create', objectType: 'packaging_unit', objectId: unitId });
    expect(createRows).toHaveLength(1);
    expect(createRows[0]!.stateAfter).toMatchObject({ minOrderUnits: 3 });

    const updateRows = await h
      .em()
      .find(AuditLogEntry, { action: 'packaging_unit.update', objectType: 'packaging_unit', objectId: unitId });
    expect(updateRows).toHaveLength(1);
    expect(updateRows[0]!.stateBefore).toMatchObject({ minOrderUnits: 3 });
    expect(updateRows[0]!.stateAfter).toMatchObject({ minOrderUnits: 5 });
  });

  describe('CatalogPackagingPort (in-process callers, no route schema)', () => {
    it('creates a unit without the key — the pim_pimcore shape (FR-002)', async () => {
      const productId = await createProduct('port-plain');
      const dto = await port().create(productId, { name: `Port ${RUN}`, baseQuantity: 6 });
      expect(dto.minOrderUnits).toBeNull();
      const updated = await port().update(productId, dto.id, { baseQuantity: 8 });
      expect(updated.baseQuantity).toBe(8);
      expect(updated.minOrderUnits).toBeNull();
    });

    it.each([0, 1_000_001, 1.5])(
      'refuses minOrderUnits %s on create and update with 422 VALIDATION_FAILED [F5]',
      async (value) => {
        const productId = await createProduct(`port-range-${String(value).replace('.', '_')}`);
        const refusedCreate = await port()
          .create(productId, { name: `Port bad ${RUN}`, baseQuantity: 6, minOrderUnits: value })
          .then(
            () => null,
            (err: unknown) => err,
          );
        expect(refusedCreate).toMatchObject({ name: 'HttpError' });
        expect((refusedCreate as HttpError).statusCode).toBe(422);
        expect((refusedCreate as HttpError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
        expect((refusedCreate as HttpError).details).toMatchObject({ field: 'minOrderUnits' });
        expect(await port().list(productId)).toEqual([]);

        const dto = await port().create(productId, { name: `Port good ${RUN}`, baseQuantity: 6, minOrderUnits: 2 });
        const refusedUpdate = await port()
          .update(productId, dto.id, { minOrderUnits: value })
          .then(
            () => null,
            (err: unknown) => err,
          );
        expect(refusedUpdate).toMatchObject({ name: 'HttpError' });
        expect((refusedUpdate as HttpError).statusCode).toBe(422);
        expect((refusedUpdate as HttpError).details).toMatchObject({ field: 'minOrderUnits' });
        const [after] = await port().list(productId);
        expect(after?.minOrderUnits).toBe(2);
      },
    );
  });
});
