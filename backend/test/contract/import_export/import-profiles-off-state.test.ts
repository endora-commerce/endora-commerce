import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T089; Constitution XVII,
 * `contracts/import-profiles-and-csv.md` §5) — `import_export` off: every profile route answers
 * the module-disabled refusal like the rest of the module, the admin resolves the module (its
 * Import profiles section and palette actions) as absent, and the profiles are kept — they are
 * back, unchanged, when the module is switched on again.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/import-export/profiles';

describe('172 — import profiles while import_export is off [contract]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  let profileId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      cookies: ADMIN,
      payload: {
        name: `Off ${run}`,
        entity: 'products',
        sourceLanguageForGlobal: null,
        localeMapping: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: randomUUID(), languageCode: 'pl-PL' }] }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    profileId = (created.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    if (!h) return;
    await h.em().getConnection().execute(`delete from import_profiles where name like ?`, [`Off % ${run}`]);
    await h.em().getConnection().execute(`delete from import_profiles where id = ?`, [profileId]);
    await teardownBackendServer(h);
  });

  it('refuses every profile route and resolves the admin surface as absent, on each axis', async () => {
    await expectModuleAbsent(h, 'import_export', {
      routes: [
        { url: BASE, cookies: ADMIN },
        { url: `${BASE}/${profileId}`, cookies: ADMIN },
        {
          method: 'POST',
          url: BASE,
          cookies: ADMIN,
          payload: { name: `Off create ${run}`, entity: 'products', sourceLanguageForGlobal: null, localeMapping: [] },
        },
        // Unknown ids for the two writes: each probe also runs before and after the flip, and must
        // not change the profile the second test reads back.
        { method: 'PATCH', url: `${BASE}/${randomUUID()}`, cookies: ADMIN, payload: { sourceLanguageForGlobal: 'en_US' } },
        { method: 'DELETE', url: `${BASE}/${randomUUID()}`, cookies: ADMIN },
      ],
      adminPresence: { cookies: ADMIN },
    });
  });

  it('keeps the profiles while off and serves them again, unchanged, when switched back on', async () => {
    await withModuleOff('import_export', 'deactivated', async () => {
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string; source_language_for_global: string | null }>>(
          `select id, source_language_for_global from import_profiles where id = ?`,
          [profileId],
        );
      expect(rows).toHaveLength(1);
    });
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${profileId}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { name: string; sourceLanguageForGlobal: string | null } }).data).toMatchObject({
      name: `Off ${run}`,
      sourceLanguageForGlobal: null,
    });
  });
});
