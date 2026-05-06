import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Integration test for the role-based gates (T096 / FR-025 / SC-008).
 *
 * Verifies:
 *   - a session bound to the seeded `blog_manager` role gets 200 on
 *     `/api/v1/admin/blog/*` and 403 on every other admin module's
 *     surface (CMS, catalog, etc.);
 *   - a session bound to the seeded `content_manager` role additionally
 *     gets 200 on `/api/v1/admin/cms/*`;
 *   - the seeded roles cannot be deleted (T095 / 409 ADMIN_ROLE_PROTECTED).
 *
 * The stub session cookies + AdminUsers are wired in
 * `test/helpers/seed-admins.ts` and `test/helpers/test-actors.ts`.
 */
describe('blog role gates + seeded-role protection (T095 + T096)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('Blog Manager can hit /api/v1/admin/blog/* but is refused on /api/v1/admin/cms/*', async () => {
    const cookie = { b2b_session: 'stub-blog-manager-session' };
    const blogList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/blog/posts',
      cookies: cookie,
    });
    expect(blogList.statusCode).toBe(200);

    const cmsList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages',
      cookies: cookie,
    });
    expect([401, 403]).toContain(cmsList.statusCode);
  });

  it('Content Manager can hit /api/v1/admin/blog/* and /api/v1/admin/cms/*', async () => {
    const cookie = { b2b_session: 'stub-content-manager-session' };
    const blogList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/blog/posts',
      cookies: cookie,
    });
    expect(blogList.statusCode).toBe(200);

    const cmsList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages',
      cookies: cookie,
    });
    expect(cmsList.statusCode).toBe(200);
  });

  it('the seeded blog_manager role cannot be deleted (ADMIN_ROLE_PROTECTED)', async () => {
    const conn = h.em().getConnection();
    const rows = (await conn.execute(
      `select id::text as id from admin_roles where code = 'blog_manager' limit 1`,
    )) as Array<{ id: string }>;
    expect(rows[0]).toBeTruthy();
    const roleId = rows[0]!.id;

    // Detach any users mapping to this role, otherwise IN_USE fires
    // before PROTECTED.
    await conn.execute(
      `update admin_users set admin_role_id = (select id from admin_roles where code = 'platform_admin' limit 1) where admin_role_id = ?`,
      [roleId],
    );

    const adminCookie = { b2b_session: 'stub-admin-session' };
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ADMIN_ROLE_PROTECTED,
    );
  });

  it('the seeded content_manager role cannot be deleted (ADMIN_ROLE_PROTECTED)', async () => {
    const conn = h.em().getConnection();
    const rows = (await conn.execute(
      `select id::text as id from admin_roles where code = 'content_manager' limit 1`,
    )) as Array<{ id: string }>;
    const roleId = rows[0]!.id;
    await conn.execute(
      `update admin_users set admin_role_id = (select id from admin_roles where code = 'platform_admin' limit 1) where admin_role_id = ?`,
      [roleId],
    );

    const adminCookie = { b2b_session: 'stub-admin-session' };
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ADMIN_ROLE_PROTECTED,
    );
  });
});
