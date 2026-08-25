import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Language } from '../../helpers/package-entities.js';

/**
 * T238 — admin language CRUD. The "at most one default" invariant is
 * enforced by a partial unique index; setDefault runs the demote+promote
 * pair in one transaction.
 *
 * Tests use ephemeral codes (`xa-XA`, `xb-XB`, ...) so they do not depend
 * on the bootstrap rows being present and do not race with tests in other
 * files that flip the default.
 */

describe('Admin language CRUD', () => {
  let h: BackendServerHandle;
  let originalDefaultCode: string;
  const ephemeralCodes: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const def = await h.em().findOne(Language, { isDefault: true });
    if (!def) throw new Error('precondition: no default language seeded');
    originalDefaultCode = def.code;
  });

  afterEach(async () => {
    // If a test promoted an ephemeral row to default, restore the original
    // before deletion so the partial unique index stays satisfied.
    if (ephemeralCodes.length > 0) {
      const conn = h.em().getConnection();
      await conn.execute('update languages set is_default = false');
      await conn.execute('update languages set is_default = true where code = ?', [
        originalDefaultCode,
      ]);
      await h.em().nativeDelete(Language, { code: { $in: ephemeralCodes } });
      ephemeralCodes.length = 0;
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upsert creates a language and a follow-up call edits in place', async () => {
    ephemeralCodes.push('xa-XA');

    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/languages/xa-XA',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Test language' },
    });
    expect(create.statusCode).toBe(200);
    expect((create.json() as { data: { code: string } }).data.code).toBe('xa-XA');

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/languages/xa-XA',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Test language v2', sortOrder: 5 },
    });
    expect(update.statusCode).toBe(200);
    const body = update.json() as { data: { label: string; sortOrder: number } };
    expect(body.data.label).toBe('Test language v2');
    expect(body.data.sortOrder).toBe(5);
  });

  it('setDefault demotes the prior default atomically', async () => {
    ephemeralCodes.push('xb-XB');
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/languages/xb-XB',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Default candidate' },
    });

    const setRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/languages/xb-XB/default',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(setRes.statusCode).toBe(200);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/languages',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as {
      data: Array<{ code: string; isDefault: boolean }>;
    };
    const defaults = body.data.filter((l) => l.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe('xb-XB');
  });

  it('refuses to delete the default language', async () => {
    // Whichever language is currently default — query the API first.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/languages',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ code: string; isDefault: boolean }> };
    const def = body.data.find((l) => l.isDefault);
    if (!def) {
      throw new Error('precondition violated: no default language configured');
    }

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/languages/${encodeURIComponent(def.code)}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects activating a default flag on an inactive language', async () => {
    ephemeralCodes.push('xc-XC');
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/languages/xc-XC',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { label: 'Inactive', isActive: false },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/languages/xc-XC/default',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
  });
});
