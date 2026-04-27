import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Currency } from '../../../src/modules/currencies/entities/currency.entity.js';

/**
 * T238 — admin currency CRUD. Mirrors the language test surface; tests
 * use ephemeral ISO-4217-shaped codes (`XAA`, `XBB`, …) so they do not
 * depend on bootstrap rows.
 */

describe('Admin currency CRUD', () => {
  let h: BackendServerHandle;
  let originalDefaultCode: string;
  const ephemeralCodes: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const def = await h.em().findOne(Currency, { isDefault: true });
    if (!def) throw new Error('precondition: no default currency seeded');
    originalDefaultCode = def.code;
  });

  afterEach(async () => {
    if (ephemeralCodes.length > 0) {
      const conn = h.em().getConnection();
      await conn.execute('update currencies set is_default = false');
      await conn.execute('update currencies set is_default = true where code = ?', [
        originalDefaultCode,
      ]);
      await h.em().nativeDelete(Currency, { code: { $in: ephemeralCodes } });
      ephemeralCodes.length = 0;
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts and edits a currency in place', async () => {
    ephemeralCodes.push('XAA');
    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/currencies/XAA',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Test currency', symbol: 'X' },
    });
    expect(create.statusCode).toBe(200);

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/currencies/XAA',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Test currency v2', symbol: 'X' },
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { data: { label: string } }).data.label).toBe('Test currency v2');
  });

  it('setDefault demotes the prior default atomically', async () => {
    ephemeralCodes.push('XBB');
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/currencies/XBB',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Default candidate', symbol: 'B' },
    });
    const setRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/currencies/XBB/default',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(setRes.statusCode).toBe(200);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/currencies',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ code: string; isDefault: boolean }> };
    const defaults = body.data.filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe('XBB');
  });

  it('refuses to delete the default currency', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/currencies',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ code: string; isDefault: boolean }> };
    const def = body.data.find((c) => c.isDefault);
    if (!def) {
      throw new Error('precondition violated: no default currency configured');
    }
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/currencies/${def.code}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
  });
});
