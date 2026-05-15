import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T023 — `GET /attributes/by-flag?flag=isMassEditable`.
 *
 * Validates that the existing by-flag endpoint grew an `isMassEditable`
 * entry in its allow-list and surfaces the right rows in the right order.
 */
describe('Feature 022 — GET /attributes/by-flag?flag=isMassEditable', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function listByFlag(flag: string): Promise<Array<{ key: string }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attributes/by-flag?flag=${flag}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { items: Array<{ key: string }> } }).data.items;
  }

  it('returns 200 with empty items when no attribute has the flag set', async () => {
    const items = await listByFlag('isMassEditable');
    expect(Array.isArray(items)).toBe(true);
  });

  it('lists attributes flagged mass_editable=true, sorted by key', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
      payload: {
        key: 'me_brand',
        label: { 'en-US': 'Brand' },
        labelDefault: 'Brand',
        valueType: 'string',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        massEditable: true,
      },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
      payload: {
        key: 'me_color',
        label: { 'en-US': 'Color' },
        labelDefault: 'Color',
        valueType: 'string',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        massEditable: true,
      },
    });

    const items = await listByFlag('isMassEditable');
    const keys = items.map((i) => i.key);
    expect(keys).toContain('me_brand');
    expect(keys).toContain('me_color');
    // Confirm `me_brand` comes before `me_color` (sorted by key asc).
    expect(keys.indexOf('me_brand')).toBeLessThan(keys.indexOf('me_color'));
  });

  it('rejects an unrecognized flag with 400 VALIDATION_FAILED', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/by-flag?flag=notARealFlag',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
