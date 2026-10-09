import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Issue #141 — the two instance-wide i18n routes check a permission.
 *
 * `POST /api/v1/admin/i18n/reload` re-reads every module's translation bundles
 * for the whole instance and `GET /api/v1/admin/i18n/coverage` reports on all
 * of them. Both were `requireAdmin()` with no code, so any administrator
 * session opened them — including one whose account holds no role, which every
 * permission-checking route refuses by name.
 *
 * They sit behind the codes the screen that calls them already requires: the
 * only caller of the reload is the cache screen under Settings, which is
 * `settings:write`, and the coverage report is the read beside it.
 */
describe('the i18n reload and coverage routes require a settings permission', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const NO_ROLE = `stub-i18n-no-role-${stamp}`;
  const READER = `stub-i18n-settings-reader-${stamp}`;
  const WRITER = `stub-i18n-settings-writer-${stamp}`;
  /** Seeded by the harness: a role holding `orders:read` and nothing else. */
  const OTHER_ROLE = 'stub-restricted-admin-session';
  const PLATFORM_ADMIN = 'stub-admin-session';

  const RELOAD = { method: 'POST', url: '/api/v1/admin/i18n/reload' } as const;
  const COVERAGE = { method: 'GET', url: '/api/v1/admin/i18n/coverage' } as const;

  async function call(
    route: typeof RELOAD | typeof COVERAGE,
    session: string | null,
  ): Promise<{ status: number; code: string | undefined }> {
    const res = await h.app.inject({
      ...route,
      ...(route.method === 'POST' ? { payload: {} } : {}),
      ...(session === null ? {} : { cookies: { b2b_session: session } }),
    });
    const body = res.json() as { error?: { code?: string } };
    return { status: res.statusCode, code: body.error?.code };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    async function admin(label: string, permissions: readonly string[] | null): Promise<string> {
      let adminRoleId: string | undefined;
      if (permissions !== null) {
        const role = em.create(AdminRole, {
          code: `i18n_${label}_${stamp}`,
          name: `i18n ${label}`,
          permissions: [...permissions],
        });
        await em.persistAndFlush(role);
        adminRoleId = role.id;
      }
      // Written straight to the table: the admin surface refuses to create an
      // account without a role, and an instance upgraded from an earlier
      // release may still hold one.
      const account = em.create(AdminUser, {
        email: `i18n-${label}-${stamp}@audit.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'I18n',
        lastName: label,
        ...(adminRoleId === undefined ? {} : { adminRoleId }),
      });
      await em.persistAndFlush(account);
      return account.id;
    }

    ADMIN_COOKIES[NO_ROLE] = { adminUserId: await admin('none', null) };
    ADMIN_COOKIES[READER] = { adminUserId: await admin('reader', ['settings:read']) };
    ADMIN_COOKIES[WRITER] = { adminUserId: await admin('writer', ['settings:write']) };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[NO_ROLE];
    delete ADMIN_COOKIES[READER];
    delete ADMIN_COOKIES[WRITER];
    await teardownBackendServer(h);
  });

  for (const route of [RELOAD, COVERAGE]) {
    describe(`${route.method} ${route.url}`, () => {
      it('answers 401 without an administrator session', async () => {
        expect(await call(route, null)).toEqual({ status: 401, code: ERROR_CODES.UNAUTHORIZED });
      });

      it('refuses an administrator whose account holds no role, by name', async () => {
        expect(await call(route, NO_ROLE)).toEqual({
          status: 403,
          code: ERROR_CODES.ADMIN_ROLE_REQUIRED,
        });
      });

      it('refuses an administrator whose role lacks the permission', async () => {
        expect(await call(route, OTHER_ROLE)).toEqual({ status: 403, code: ERROR_CODES.FORBIDDEN });
      });

      it('answers a platform administrator', async () => {
        expect((await call(route, PLATFORM_ADMIN)).status).toBe(200);
      });
    });
  }

  it('opens the coverage report on settings:read and the reload on settings:write, and not the other way round', async () => {
    // The codes are opaque strings: holding the write code does not imply the
    // read one, which is why the cache screen's own route carries the write
    // code for its listing too.
    expect((await call(COVERAGE, READER)).status).toBe(200);
    expect(await call(RELOAD, READER)).toEqual({ status: 403, code: ERROR_CODES.FORBIDDEN });

    expect((await call(RELOAD, WRITER)).status).toBe(200);
    expect(await call(COVERAGE, WRITER)).toEqual({ status: 403, code: ERROR_CODES.FORBIDDEN });
  });

  describe('what stays open to any administrator session', () => {
    // The routes the shell boots from and the caller's own account. An account
    // without a role has to get far enough to be told that it has none.
    const SESSION_ONLY = [
      '/api/v1/admin/me',
      '/api/v1/admin/module-presence',
      '/api/v1/admin/i18n/bundles?language=en',
      '/api/v1/admin/account/mfa/status',
    ];

    for (const url of SESSION_ONLY) {
      it(`GET ${url} still answers an administrator with no role`, async () => {
        const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: NO_ROLE } });
        expect(res.statusCode).toBe(200);
      });
    }
  });
});
