import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * Feature 170 (owner decision 2026-11-03, `contracts/import-profiles-and-csv.md` §1) — the
 * channel × language targets an import profile may name, served by `import_export` itself behind
 * `catalog:write` (the delivery-methods precedent), so an operator who may edit profiles may pick
 * targets without `sales_channels:read`. Each channel answers its id, code and languages, and
 * nothing else; `catalog:read` alone is refused; with the module off the route is absent.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const URL = '/api/v1/admin/import-export/channel-targets';

describe('170 — import profile channel targets [contract]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const READER = `stub-ct-catalog-reader-${run}`;
  const WRITER = `stub-ct-catalog-writer-${run}`;

  async function actor(cookie: string, permissions: string[]): Promise<void> {
    const em = h.em();
    const role = em.create(AdminRole, { code: `ct_${cookie.slice(-14)}`.replace(/-/g, '_'), name: cookie, permissions });
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `${cookie}@import-export.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Channel',
      lastName: 'Targets',
    });
    await em.persistAndFlush(admin);
    ADMIN_COOKIES[cookie] = { adminUserId: admin.id };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await actor(READER, ['catalog:read']);
    await actor(WRITER, ['catalog:write']);
  });

  afterAll(async () => {
    if (!h) return;
    await teardownBackendServer(h);
  });

  it('answers every channel with its id, code and languages only — to catalog:write alone', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL, cookies: { b2b_session: WRITER } });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Array<Record<string, unknown>> }).data;
    const channels = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string; code: string; languages: string[]; default_language: string }>>(
        `select id, code, languages, default_language from sales_channels order by code asc`,
      );
    expect(data.map((c) => c.code)).toEqual(channels.map((c) => c.code));
    for (const entry of data) {
      expect(Object.keys(entry).sort()).toEqual(['code', 'id', 'languages']);
      const row = channels.find((c) => c.id === entry.id)!;
      // The channel's languages with its default first when the list omits it (`toScopeChannel`).
      expect(entry.languages).toContain(row.default_language);
      for (const code of row.languages) expect(entry.languages).toContain(code);
    }
  });

  it('refuses an admin holding catalog:read alone', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL, cookies: { b2b_session: READER } });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('is absent while import_export is off, on each axis', async () => {
    await expectModuleAbsent(h, 'import_export', { routes: [{ url: URL, cookies: ADMIN }] });
  });
});
