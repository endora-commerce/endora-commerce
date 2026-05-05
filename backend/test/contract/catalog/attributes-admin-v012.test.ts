import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T015 — Admin attribute CRUD contract for the new flags +
 * the by-flag picker endpoint + delete-while-in-use guards.
 *
 * Covers `contracts/attributes-admin.contract.md`:
 *   - POST accepts the four new behavioural flags + `filterPosition`
 *     + `labelDefault` and round-trips them on read.
 *   - POST accepts `valueType: 'select'` (paired with rich `options`).
 *   - GET /:idOrKey returns the rich payload.
 *   - GET /by-flag returns the picker shape.
 *   - DELETE refuses while the attribute is part of an Attribute Set
 *     or carries product values.
 *   - PATCH accepts the four new flags.
 */
describe('Admin Attributes contract — feature 012 flags + select + delete (T015)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('POST round-trips the four new flags + filterPosition + labelDefault', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'gear_ratio_v012',
        label: { 'en-US': 'Gear ratio', 'pl-PL': 'Przełożenie' },
        labelDefault: 'Gear ratio',
        type: 'number',
        isSearchable: true,
        isFilterable: true,
        isVariantAxis: false,
        isComparable: true,
        isRequired: true,
        isPromoRule: true,
        filterPosition: 30,
        isVisibleOnProductPage: true,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      key: 'gear_ratio_v012',
      labelDefault: 'Gear ratio',
      isSearchable: true,
      isFilterable: true,
      isComparable: true,
      isRequired: true,
      isPromoRule: true,
      filterPosition: 30,
      isVisibleOnProductPage: true,
    });
  });

  it('POST accepts valueType=select with inline options[] and persists labels', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'material_v012',
        label: { 'en-US': 'Material' },
        labelDefault: 'Material',
        type: 'select',
        isSearchable: true,
        isFilterable: true,
        isVariantAxis: false,
        options: [
          { value: 'steel', labelDefault: 'Steel', isDefault: true },
          { value: 'brass', labelDefault: 'Brass', label: { 'pl-PL': 'Mosiądz' } },
        ],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('GET /:idOrKey returns the rich payload by key', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/gear_ratio_v012',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { key: string; filterPosition: number } };
    expect(body.data.key).toBe('gear_ratio_v012');
    expect(body.data.filterPosition).toBe(30);
  });

  it('GET /by-flag returns the picker payload for isPromoRule', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ key: string }> } };
    const keys = body.data.items.map((i) => i.key);
    expect(keys).toContain('gear_ratio_v012');
  });

  it('GET /by-flag rejects an unknown flag with 400', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/by-flag?flag=isBogus',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH widens to accept the four new flags', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material_v012',
      payload: {
        isPromoRule: true,
        filterPosition: 5,
        isVisibleOnProductPage: true,
        labelDefault: 'Material (renamed)',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      isPromoRule: true,
      filterPosition: 5,
      isVisibleOnProductPage: true,
      labelDefault: 'Material (renamed)',
    });
  });

  it('DELETE refuses while the attribute is in an Attribute Set', async () => {
    // The seed attaches `color`, `material`, `internal_sku_notes`,
    // `certification` to the Default Attribute Set (set up by
    // test/helpers/seed-catalog). A plain delete on `color` should be
    // refused while the bridge row exists.
    const res = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/catalog/attributes/color',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE succeeds for a fresh attribute that is not on any set or product', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'temp_to_delete_v012',
        label: { 'en-US': 'Temp' },
        labelDefault: 'Temp',
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/catalog/attributes/temp_to_delete_v012',
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });
});
