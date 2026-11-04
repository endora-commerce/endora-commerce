import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, importProfileSchema } from '@endora-commerce/contracts';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T078; FR-048,
 * `contracts/import-profiles-and-csv.md` §1) — the import-profile routes: CRUD, every route on
 * `catalog:write` (a `catalog:read` admin is refused each one), one audit entry per Command,
 * `409 IMPORT_PROFILE_NAME_TAKEN` (case-insensitive) and `404 IMPORT_PROFILE_NOT_FOUND`.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/import-export/profiles';

describe('172 — import profiles [contract]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const READER = `stub-ip-catalog-reader-${run}`;
  const channelId = randomUUID();

  const audits = (action: string, objectId: string) =>
    h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select id from audit_log_entries where action = ? and object_id = ?`, [action, objectId]);

  const body = (name: string) => ({
    name,
    entity: 'products',
    sourceLanguageForGlobal: 'en_US',
    localeMapping: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId, languageCode: 'pl-PL' }] }],
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const role = em.create(AdminRole, { code: `ip_reader_${run}`, name: `ip reader ${run}`, permissions: ['catalog:read'] });
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `ip-reader-${run}@import-export.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Import',
      lastName: 'Reader',
    });
    await em.persistAndFlush(admin);
    ADMIN_COOKIES[READER] = { adminUserId: admin.id };
  });

  afterAll(async () => {
    if (!h) return;
    await h.em().getConnection().execute(`delete from import_profiles where name ilike ?`, [`%${run}%`]);
    await teardownBackendServer(h);
  });

  it('creates, lists, reads, updates and deletes a profile — one audit entry per Command', async () => {
    const created = await h.app.inject({ method: 'POST', url: BASE, cookies: ADMIN, payload: body(`Akeneo ${run}`) });
    expect(created.statusCode, created.body).toBe(201);
    const profile = importProfileSchema.parse((created.json() as { data: unknown }).data);
    expect(profile).toMatchObject({ name: `Akeneo ${run}`, entity: 'products', sourceLanguageForGlobal: 'en_US' });
    expect(profile.localeMapping).toEqual(body('x').localeMapping);
    expect(await audits('import_profile.create', profile.id)).toHaveLength(1);

    const list = await h.app.inject({ method: 'GET', url: `${BASE}?entity=products`, cookies: ADMIN });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((p) => p.id)).toContain(profile.id);

    const one = await h.app.inject({ method: 'GET', url: `${BASE}/${profile.id}`, cookies: ADMIN });
    expect(one.statusCode, one.body).toBe(200);
    expect((one.json() as { data: { id: string } }).data.id).toBe(profile.id);

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `${BASE}/${profile.id}`,
      cookies: ADMIN,
      payload: { sourceLanguageForGlobal: null },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as { data: { sourceLanguageForGlobal: unknown; name: string } }).data).toMatchObject({
      sourceLanguageForGlobal: null,
      name: `Akeneo ${run}`,
    });
    expect(await audits('import_profile.update', profile.id)).toHaveLength(1);

    const deleted = await h.app.inject({ method: 'DELETE', url: `${BASE}/${profile.id}`, cookies: ADMIN });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(await audits('import_profile.delete', profile.id)).toHaveLength(1);
    const gone = await h.app.inject({ method: 'GET', url: `${BASE}/${profile.id}`, cookies: ADMIN });
    expect(gone.statusCode).toBe(404);
  });

  it('refuses a name another profile holds, case-insensitively (IMPORT_PROFILE_NAME_TAKEN)', async () => {
    const first = await h.app.inject({ method: 'POST', url: BASE, cookies: ADMIN, payload: body(`Pimcore ${run}`) });
    expect(first.statusCode, first.body).toBe(201);
    const taken = await h.app.inject({ method: 'POST', url: BASE, cookies: ADMIN, payload: body(`PIMCORE ${run}`) });
    expect(taken.statusCode, taken.body).toBe(409);
    expect((taken.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
      code: ERROR_CODES.IMPORT_PROFILE_NAME_TAKEN,
      details: { name: `PIMCORE ${run}` },
    });

    const other = await h.app.inject({ method: 'POST', url: BASE, cookies: ADMIN, payload: body(`Unopim ${run}`) });
    expect(other.statusCode, other.body).toBe(201);
    const otherId = (other.json() as { data: { id: string } }).data.id;
    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `${BASE}/${otherId}`,
      cookies: ADMIN,
      payload: { name: `pimcore ${run}` },
    });
    expect(renamed.statusCode, renamed.body).toBe(409);
    expect((renamed.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.IMPORT_PROFILE_NAME_TAKEN);
  });

  it('answers IMPORT_PROFILE_NOT_FOUND for an unknown id on read, update and delete', async () => {
    const id = randomUUID();
    for (const [method, payload] of [
      ['GET', undefined],
      ['PATCH', { name: `Ghost ${run}` }],
      ['DELETE', undefined],
    ] as const) {
      const res = await h.app.inject({ method, url: `${BASE}/${id}`, cookies: ADMIN, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${res.body}`).toBe(404);
      expect((res.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
        code: ERROR_CODES.IMPORT_PROFILE_NOT_FOUND,
        details: { profileId: id },
      });
    }
  });

  it('refuses an invalid mapping (a duplicate source locale and channel) with VALIDATION_FAILED', async () => {
    const entry = body('x').localeMapping[0]!;
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      cookies: ADMIN,
      payload: { ...body(`Dup ${run}`), localeMapping: [entry, { ...entry, sourceLocale: 'pl-pl' }] },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a catalog:read admin on every profile route (catalog:write)', async () => {
    const created = await h.app.inject({ method: 'POST', url: BASE, cookies: ADMIN, payload: body(`Gate ${run}`) });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    const cookies = { b2b_session: READER };
    for (const [method, url, payload] of [
      ['GET', BASE, undefined],
      ['GET', `${BASE}/${id}`, undefined],
      ['POST', BASE, body(`Reader ${run}`)],
      ['PATCH', `${BASE}/${id}`, { name: `Reader ${run}` }],
      ['DELETE', `${BASE}/${id}`, undefined],
    ] as const) {
      const res = await h.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url} ${res.body}`).toBe(403);
    }
    const still = await h.app.inject({ method: 'GET', url: `${BASE}/${id}`, cookies: ADMIN });
    expect(still.statusCode).toBe(200);
  });
});
