import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import {
  PERMISSIONLESS_ADMIN_ROUTES,
  readPermissionlessRoutes,
  routeKeyOf,
} from '../../helpers/permissionless-admin-routes.js';

/**
 * Issue #141 — the permissionless admin routes, asked of the running server.
 *
 * `test/unit/kernel/permissionless-admin-routes.test.ts` reads route
 * registrations out of source text. It runs on every pull request and it is a
 * reader: a route mounted some way it does not parse is a route it does not
 * know exists. This file is the second enumeration, independent of the first —
 * it composes the application, takes the route table Fastify built (the
 * OpenAPI document, filled by an `onRoute` hook installed before any module
 * mounts) and calls every `/api/v1/admin/**` route twice: with no session, and
 * as an administrator whose account holds no role.
 *
 * Three things are held:
 *
 *  1. **Every mounted admin route is one the static reader read.** This is the
 *     half that covers a prefixed plugin, a route file outside the module
 *     layout, or a spelling nobody has written yet.
 *  2. **A route the role-less administrator is not refused on by name is on
 *     the list.** `ADMIN_ROLE_REQUIRED` is what every permission check answers
 *     such an account, so anything else means no permission was checked.
 *  3. **Every listed route really is open**, so the list cannot hold an entry
 *     the server contradicts.
 *
 * ## What it cannot see, stated rather than implied
 *
 *  - **A route whose schema refuses the probe before its guard runs.** Fastify
 *    validates before `preHandler`, so a route with a required body or query
 *    answers `400` to an empty request whoever sends it — about a quarter of
 *    the admin surface. For those this file proves only that the route is
 *    known to the static reader, which is what decides them.
 *  - **A route this harness does not mount** ({@link NOT_MOUNTED_BY_THE_HARNESS}).
 *  - **A pull request.** No pull-request check runs the contract tree; the
 *    static sweep is the guard at that point and this is the audit behind it.
 */

/**
 * Admin routes the static reader finds and this harness does not serve, with
 * why. Two-way, so the blind spot is a named one and cannot widen unnoticed.
 */
const NOT_MOUNTED_BY_THE_HARNESS: Readonly<Record<string, string>> = {
  'GET /api/v1/admin/modules':
    'The module list is served only when a lifecycle orchestrator is contributed, and this ' +
    'harness contributes none (`test/helpers/test-server.ts`). The static reader has it as ' +
    '`platform.modules.read`.',
};

const NIL_ID = '00000000-0000-4000-8000-00000000dead';

describe('permissionless admin routes, at runtime (issue #141)', () => {
  let h: BackendServerHandle;
  const NO_ROLE = `stub-runtime-no-role-${Date.now()}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // Written straight to the table: the admin surface refuses to create an
    // account without a role.
    const account = em.create(AdminUser, {
      email: `runtime-no-role-${Date.now()}@audit.local`,
      passwordHash: 'x'.repeat(60),
      firstName: 'No',
      lastName: 'Role',
    });
    await em.persistAndFlush(account);
    ADMIN_COOKIES[NO_ROLE] = { adminUserId: account.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[NO_ROLE];
    await teardownBackendServer(h);
  });

  it('every mounted admin route is known to the static reader, and only listed ones answer without a permission', async () => {
    const document = (await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json' })).json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const mounted: Array<{ key: string; method: string; url: string }> = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/v1/admin/')) continue;
      for (const method of Object.keys(methods)) {
        mounted.push({
          key: `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`,
          method: method.toUpperCase(),
          url: path.replace(/\{[^}]+\}/g, NIL_ID),
        });
      }
    }
    expect(mounted.length).toBeGreaterThan(0);

    const scan = await readPermissionlessRoutes();
    const known = new Set(scan.routes.map(routeKeyOf));
    const mountedKeys = new Set(mounted.map((route) => route.key));

    // 1 — the two route tables.
    expect(
      mounted.filter((route) => !known.has(route.key)).map((route) => route.key),
      'mounted admin routes the static reader did not read',
    ).toEqual([]);
    expect(
      [...known].filter((key) => !mountedKeys.has(key)).sort(),
      'admin routes the static reader found and this harness does not mount',
    ).toEqual(Object.keys(NOT_MOUNTED_BY_THE_HARNESS).sort());

    // 2 and 3 — what the server answers.
    const open: string[] = [];
    const refusedByName: string[] = [];
    const validatedFirst: string[] = [];
    for (const route of mounted) {
      const request = { method: route.method as 'GET', url: route.url };
      const anonymous = await h.app.inject(request);
      const codeOf = (body: string): string | undefined => {
        try {
          return (JSON.parse(body) as { error?: { code?: string } }).error?.code;
        } catch {
          return undefined;
        }
      };
      if (anonymous.statusCode === 400 && codeOf(anonymous.body) === ERROR_CODES.VALIDATION_FAILED) {
        validatedFirst.push(route.key);
        continue;
      }
      const roleless = await h.app.inject({ ...request, cookies: { b2b_session: NO_ROLE } });
      if (roleless.statusCode === 403 && codeOf(roleless.body) === ERROR_CODES.ADMIN_ROLE_REQUIRED) {
        refusedByName.push(route.key);
      } else {
        open.push(route.key);
      }
    }

    // A probe that reached no guard at all would agree with anything.
    expect(refusedByName.length).toBeGreaterThan(validatedFirst.length);

    const listed = new Set(Object.keys(PERMISSIONLESS_ADMIN_ROUTES));
    expect(
      open.filter((key) => !listed.has(key)).sort(),
      'routes that answered an administrator with no role and are not on the list',
    ).toEqual([]);
    expect(
      refusedByName.filter((key) => listed.has(key)).sort(),
      'listed routes the server refuses an administrator with no role on',
    ).toEqual([]);

    // eslint-disable-next-line no-console -- the read size of a sweep is part of its result.
    console.log(
      `[permissionless-admin-routes:runtime] mounted=${mounted.length} refused-by-name=${refusedByName.length} ` +
        `open=${open.length} validated-first=${validatedFirst.length} static=${known.size} ` +
        `not-mounted=${[...known].filter((key) => !mountedKeys.has(key)).length}`,
    );
  }, 600_000);
});
