import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * T020 / FR-002, FR-005, FR-006 — preferred-language persistence
 * round-trip. Sets via PATCH, reads via the session bootstrap (the
 * `/api/v1/admin/me` endpoint that the SPA hits on mount), confirms
 * the field surfaces in the user payload. Exercises the real DB
 * column added by migration 040.
 */
describe('AdminUser.preferredLanguage persistence', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setLang(pref: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      headers: { cookie: 'b2b_session=stub-admin-session' },
      payload: { preferredLanguage: pref },
    });
    expect(res.statusCode).toBe(200);
  }

  async function readMe(): Promise<{
    preferredLanguage: string | null;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: { cookie: 'b2b_session=stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const env = res.json() as { data: { adminUser: { preferredLanguage: string | null } } };
    return { preferredLanguage: env.data.adminUser.preferredLanguage };
  }

  async function readDb(): Promise<string | null> {
    const em = h.em();
    const row = await em.findOne(AdminUser, { id: TEST_ADMIN_ID });
    return row?.preferredLanguage ?? null;
  }

  it('PATCH pl → /admin/me reflects pl → DB stores pl', async () => {
    await setLang('pl');
    const me = await readMe();
    expect(me.preferredLanguage).toBe('pl');
    expect(await readDb()).toBe('pl');
  });

  it('PATCH en → /admin/me reflects en → DB stores en', async () => {
    await setLang('en');
    const me = await readMe();
    expect(me.preferredLanguage).toBe('en');
    expect(await readDb()).toBe('en');
  });

  it('PATCH null → /admin/me reflects null → DB stores null (no preference)', async () => {
    await setLang('pl');
    expect(await readDb()).toBe('pl');
    await setLang(null);
    const me = await readMe();
    expect(me.preferredLanguage).toBeNull();
    expect(await readDb()).toBeNull();
  });

  it('the persisted value survives a service restart (simulated by re-reading from a fresh em)', async () => {
    await setLang('pl');
    // Fork a fresh EM to simulate a new request — the previous one's
    // identity map could otherwise mask a missing flush.
    const fresh = h.orm.em.fork();
    const row = await fresh.findOne(AdminUser, { id: TEST_ADMIN_ID });
    expect(row?.preferredLanguage).toBe('pl');
  });
});
