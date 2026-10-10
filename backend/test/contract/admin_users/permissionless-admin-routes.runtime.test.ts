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
 * ## Guards run before validation, so every route is asked
 *
 * Until the platform moved a route's guards ahead of its schema
 * (`packages/platform/src/http/guards-before-validation.ts`), a route with a
 * required body or query answered `400 VALIDATION_FAILED` to an empty request
 * whoever sent it — 184 of the 720 routes mounted here — and this file could
 * say nothing about those. Now the probe, which is an empty request and so
 * still fails every one of those schemas, is refused by the guard first. That
 * is held here as a property of its own: **no admin route answers a caller
 * without a session anything but `401`**, and the role-less administrator is
 * refused by name on every route that is not on the list.
 *
 * ## What it cannot see, stated rather than implied
 *
 *  - **A request the body parser refuses.** Parsing precedes every guard, so
 *    malformed JSON, an unsupported media type or a body over the limit is
 *    answered `400`/`415`/`413` to anybody. The probe sends no body.
 *  - **A second guard that abstains on the probe.** A route may ask for a
 *    further permission only when the request names a particular kind of
 *    object; the probe names none, so only the route's first gate is asked.
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

function codeOf(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
}

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
    const notRefusedAnonymously: string[] = [];
    for (const route of mounted) {
      const request = { method: route.method as 'GET', url: route.url };
      const anonymous = await h.app.inject(request);
      if (anonymous.statusCode !== 401 || codeOf(anonymous.body) !== ERROR_CODES.UNAUTHORIZED) {
        notRefusedAnonymously.push(`${route.key} -> ${anonymous.statusCode} ${codeOf(anonymous.body) ?? ''}`);
      }
      const roleless = await h.app.inject({ ...request, cookies: { b2b_session: NO_ROLE } });
      if (roleless.statusCode === 403 && codeOf(roleless.body) === ERROR_CODES.ADMIN_ROLE_REQUIRED) {
        refusedByName.push(route.key);
      } else {
        open.push(route.key);
      }
    }

    // A probe that reached no guard at all would agree with anything.
    expect(refusedByName.length).toBeGreaterThan(0);

    // No tolerance for a `400`: the guard answers before the schema does, so a
    // route that describes its request shape to a caller without a session is
    // a route whose guard is not where the platform can move it.
    expect(
      notRefusedAnonymously.filter(
        (line) => PERMISSIONLESS_ADMIN_ROUTES[line.split(' -> ')[0]!]?.guard !== 'none',
      ),
      'admin routes that answered a caller without a session something other than 401',
    ).toEqual([]);

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
        `open=${open.length} not-401-anonymously=${notRefusedAnonymously.length} static=${known.size} ` +
        `not-mounted=${[...known].filter((key) => !mountedKeys.has(key)).length}`,
    );
  }, 600_000);
  /**
   * The ordering itself, on one route of each kind, with the three callers the
   * sweep above does not send: an administrator whose role lacks the code, one
   * whose role holds it, and the platform administrator. `POST
   * /api/v1/admin/orders` is `orders:write` with a required body; `GET
   * /api/v1/admin/orders` is `orders:read` with a validated query; the
   * restricted administrator the harness seeds holds `orders:read` alone.
   */
  describe('a refusal is answered before the request is validated', () => {
    const INVALID_BODY = { customerAccountId: 'not-a-uuid' };
    const withoutRequestId = (body: string): unknown => {
      const parsed = JSON.parse(body) as { error?: Record<string, unknown> };
      if (parsed.error) delete parsed.error['requestId'];
      return parsed;
    };

    it('no session: 401 on an invalid body, the same answer a route with no schema gives', async () => {
      for (const language of ['en', 'pl']) {
        const headers = { 'accept-language': language };
        const plain = await h.app.inject({ method: 'GET', url: '/api/v1/admin/customer-groups', headers });
        const invalid = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders',
          headers,
          payload: INVALID_BODY,
        });
        expect(plain.statusCode).toBe(401);
        expect(invalid.statusCode).toBe(401);
        expect(codeOf(invalid.body)).toBe(ERROR_CODES.UNAUTHORIZED);
        expect(withoutRequestId(invalid.body), language).toEqual(withoutRequestId(plain.body));
        expect(invalid.headers['content-language']).toBe(plain.headers['content-language']);
        expect(JSON.parse(invalid.body).error).not.toHaveProperty('details');
      }
    });

    it('an administrator with no role: ADMIN_ROLE_REQUIRED on an invalid body, in the same words', async () => {
      const cookies = { b2b_session: NO_ROLE };
      for (const language of ['en', 'pl']) {
        const headers = { 'accept-language': language };
        const plain = await h.app.inject({ method: 'GET', url: '/api/v1/admin/customer-groups', headers, cookies });
        const invalid = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders',
          headers,
          cookies,
          payload: INVALID_BODY,
        });
        expect(invalid.statusCode).toBe(403);
        expect(codeOf(invalid.body)).toBe(ERROR_CODES.ADMIN_ROLE_REQUIRED);
        expect(withoutRequestId(invalid.body), language).toEqual(withoutRequestId(plain.body));
      }
    });

    it('a role without the permission: 403 FORBIDDEN on an invalid body, not 400', async () => {
      const cookies = { b2b_session: 'stub-restricted-admin-session' };
      const invalid = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies,
        payload: INVALID_BODY,
      });
      expect(invalid.statusCode).toBe(403);
      expect(codeOf(invalid.body)).toBe(ERROR_CODES.FORBIDDEN);
      expect(JSON.parse(invalid.body).error).not.toHaveProperty('details');

      // The same account, on the route its role does open, is validated.
      const permitted = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders?paymentStatus=not-a-status',
        cookies,
      });
      expect(permitted.statusCode).toBe(400);
      expect(codeOf(permitted.body)).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('a route with two guards: the second one refuses an invalid body too, 403 and not 400', async () => {
      // `POST …/crm/opportunities/:id/attachments` asks for `crm:write`, then
      // `assets.read`. An account holding only the first passes one guard and
      // is refused by the next — which must also happen before the schema.
      const roleCode = `crm_writer_${Date.now()}`;
      const role = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/admin-roles/${roleCode}`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { code: roleCode, name: 'CRM writer', permissions: ['crm:write'] },
      });
      expect(role.statusCode).toBe(200);
      const em = h.em();
      const account = em.create(AdminUser, {
        email: `crm-writer-${Date.now()}@audit.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Crm',
        lastName: 'Writer',
        adminRoleId: (role.json() as { data: { id: string } }).data.id,
        status: 'active',
      });
      await em.persistAndFlush(account);
      const cookie = `stub-runtime-crm-writer-${Date.now()}`;
      ADMIN_COOKIES[cookie] = { adminUserId: account.id };
      try {
        const request = {
          method: 'POST' as const,
          url: `/api/v1/admin/crm/opportunities/${NIL_ID}/attachments`,
          payload: { assetId: 'not-a-uuid' },
        };
        const refused = await h.app.inject({ ...request, cookies: { b2b_session: cookie } });
        expect(refused.statusCode).toBe(403);
        expect(codeOf(refused.body)).toBe(ERROR_CODES.FORBIDDEN);

        // It is the second guard that refused: on a route asking for
        // `crm:write` alone, the same account reaches the validator.
        const firstGuardPasses = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/crm/opportunities',
          cookies: { b2b_session: cookie },
          payload: {},
        });
        expect(firstGuardPasses.statusCode).toBe(400);
        expect(codeOf(firstGuardPasses.body)).toBe(ERROR_CODES.VALIDATION_FAILED);

        // The same request from an account holding both codes is the validator's.
        const validated = await h.app.inject({ ...request, cookies: { b2b_session: 'stub-admin-session' } });
        expect(validated.statusCode).toBe(400);
        expect(codeOf(validated.body)).toBe(ERROR_CODES.VALIDATION_FAILED);
      } finally {
        delete ADMIN_COOKIES[cookie];
      }
    });

    it('an authorised administrator is still answered by the validator, in the shape it always had', async () => {
      const invalid = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: INVALID_BODY,
      });
      expect(invalid.statusCode).toBe(400);
      // Recorded from the server as it answered before the guards moved.
      expect(withoutRequestId(invalid.body)).toEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request failed validation.',
          details: [
            { path: 'customerAccountId', issue: 'Invalid UUID' },
            { path: 'salesChannelId', issue: 'Invalid input: expected string, received undefined' },
            { path: 'items', issue: 'Invalid input: expected array, received undefined' },
            { path: 'deliveryMethodId', issue: 'Invalid input: expected string, received undefined' },
            { path: 'paymentMethodId', issue: 'Invalid input: expected string, received undefined' },
          ],
        },
      });
    });
  });
});
