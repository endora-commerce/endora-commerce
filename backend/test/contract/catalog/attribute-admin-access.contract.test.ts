import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAttributeResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-036, SD-2, T039) — a
 * product attribute is a custom-field definition the catalogue manages through
 * the apply seam, so its admin access travels on the catalogue's own attribute
 * API: stored on create and update, answered on every read, and a required
 * attribute that is not editable is refused.
 */
describe('Admin attribute — admin access (feature 175)', () => {
  let h: BackendServerHandle;
  const key = `admin_access_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
  const requiredKey = `admin_access_req_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const k of [key, requiredKey]) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/attributes/${k}`, ...admin });
    }
    await teardownBackendServer(h);
  });

  const accessOf = (body: unknown): string | undefined =>
    adminAttributeResponseSchema.parse((body as { data: unknown }).data).adminAccess;

  const create = (k: string, extra: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      ...admin,
      payload: {
        key: k,
        label: { 'en-US': k },
        labelDefault: k,
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        ...extra,
      },
    });

  it('stores the level on create and update and answers it on read and list', async () => {
    const created = await create(key, { adminAccess: 'read' });
    expect(created.statusCode).toBe(201);
    expect(accessOf(created.json())).toBe('read');

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/attributes/${key}`, ...admin });
    expect(accessOf(read.json())).toBe('read');

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attributes', ...admin });
    const row = (list.json() as { data: Array<{ key: string }> }).data.find((a) => a.key === key);
    expect(accessOf({ data: row })).toBe('read');

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${key}`,
      ...admin,
      payload: { adminAccess: 'hidden' },
    });
    expect(updated.statusCode).toBe(200);
    expect(accessOf(updated.json())).toBe('hidden');
  });

  it('answers `edit` for an attribute created without a level', async () => {
    const created = await create(requiredKey, { isRequired: true });
    expect(created.statusCode).toBe(201);
    expect(accessOf(created.json())).toBe('edit');
  });

  it('refuses a required attribute that is not editable in the admin (SD-2)', async () => {
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${requiredKey}`,
      ...admin,
      payload: { adminAccess: 'read' },
    });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(refused.statusCode).toBeLessThan(500);

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/attributes/${requiredKey}`, ...admin });
    expect(accessOf(read.json())).toBe('edit');
  });
});
