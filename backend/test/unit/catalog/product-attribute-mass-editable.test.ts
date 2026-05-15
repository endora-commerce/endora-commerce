import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T022 — `massEditable` flag on Attribute.
 *
 * Foundational unit/contract coverage:
 *   - default is false on create when omitted
 *   - persists when sent on create
 *   - partial PATCH flips it without disturbing other fields
 *   - round-trip via GET reflects the persisted value
 */
describe('Feature 022 — Attribute.massEditable', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createAttribute(payload: Record<string, unknown>): Promise<{
    id: string;
    massEditable: boolean;
  }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; massEditable: boolean } }).data;
  }

  it('defaults massEditable to false when omitted on create', async () => {
    const data = await createAttribute({
      key: 'mass_ed_default',
      label: { 'en-US': 'Default flag' },
      labelDefault: 'Default flag',
      valueType: 'string',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    });
    expect(data.massEditable).toBe(false);
  });

  it('persists massEditable=true when supplied on create', async () => {
    const data = await createAttribute({
      key: 'mass_ed_true',
      label: { 'en-US': 'Editable' },
      labelDefault: 'Editable',
      valueType: 'string',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
      massEditable: true,
    });
    expect(data.massEditable).toBe(true);
  });

  it('PATCH { massEditable: false } flips the flag without touching other fields', async () => {
    const created = await createAttribute({
      key: 'mass_ed_flip',
      label: { 'en-US': 'Flip me', 'pl-PL': 'Przełącz' },
      labelDefault: 'Flip me',
      valueType: 'string',
      isSearchable: true,
      isFilterable: true,
      isVariantAxis: false,
      massEditable: true,
    });

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${created.id}`,
      payload: { massEditable: false },
      cookies: adminCookie,
    });
    expect(patch.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attributes/${created.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      data: {
        massEditable: boolean;
        isSearchable: boolean;
        isFilterable: boolean;
        label: Record<string, string>;
      };
    };
    expect(body.data.massEditable).toBe(false);
    // Untouched fields preserved.
    expect(body.data.isSearchable).toBe(true);
    expect(body.data.isFilterable).toBe(true);
    expect(body.data.label['en-US']).toBe('Flip me');
    expect(body.data.label['pl-PL']).toBe('Przełącz');
  });
});
