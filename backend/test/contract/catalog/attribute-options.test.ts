import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T033 — Attribute option-list CRUD contract (US4).
 *
 * Covers `contracts/attribute-options.contract.md`:
 *   - GET /attributes/:attributeId/options — list ordered.
 *   - POST /attributes/:attributeId/options — append; structured
 *     errors for duplicate value, default ambiguity, invalid value.
 *   - PATCH /attributes/:attributeId/options/:optionId — partial
 *     update; value is immutable.
 *   - DELETE /attributes/:attributeId/options/:optionId — refused
 *     with 409 option_in_use when products carry the value.
 */
describe('Admin Attribute Options contract — feature 012 (T033)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  let attributeId: string;
  let optionId: string;

  it('creates a select-style attribute as the test fixture', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'finish_v012',
        label: { 'en-US': 'Finish' },
        labelDefault: 'Finish',
        type: 'select',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
        options: [{ value: 'matte', labelDefault: 'Matte', isDefault: true }],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string } };
    attributeId = body.data.id;
  });

  it('GET options returns the seeded matte option', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: Array<{ id: string; value: string; isDefault: boolean }> };
    };
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    const matte = body.data.items.find((i) => i.value === 'matte');
    expect(matte?.isDefault).toBe(true);
  });

  it('POST appends a new option with auto-incremented sortOrder', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      payload: { value: 'gloss', labelDefault: 'Gloss', label: { 'pl-PL': 'Połysk' } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; value: string; sortOrder: number } };
    expect(body.data.value).toBe('gloss');
    expect(body.data.sortOrder).toBeGreaterThan(0);
    optionId = body.data.id;
  });

  it('POST refuses a duplicate value with 409', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      payload: { value: 'gloss', labelDefault: 'Gloss again' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST refuses a second isDefault on a select attribute', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      payload: { value: 'satin', labelDefault: 'Satin', isDefault: true },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST refuses an invalid option value (regex)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      payload: { value: 'NotValid!', labelDefault: 'NV' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH updates the option labels', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options/${optionId}`,
      payload: { labelDefault: 'High Gloss', sortOrder: 99 },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { labelDefault: string; sortOrder: number } };
    expect(body.data.labelDefault).toBe('High Gloss');
    expect(body.data.sortOrder).toBe(99);
  });

  it('DELETE removes an option that no product carries', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options/${optionId}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(204);
  });
});
