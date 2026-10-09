import { describe, expect, it } from 'vitest';

import {
  PERMISSIONLESS_ADMIN_ROUTES,
  REGISTRAR_MOUNTS,
  findPermissionlessRouteDefects,
  inventoryBareGuardSites,
  readPermissionlessRoutes,
  routeKeyOf,
  scanPermissionlessRoutes,
  type PermissionlessRouteEntry,
  type RegistrarMount,
} from '../../helpers/permissionless-admin-routes.js';

/**
 * Issue #141 — an admin route that checks no permission is on a list, with the
 * reason, or it is a defect.
 *
 * The rule and the list are in `test/helpers/permissionless-admin-routes.ts`.
 * This file is the proofs that the rule can go red — one per defect it names
 * and one per route spelling that once got past it, each entering where a real
 * run enters, as source text — and then the live sweep over this build's own
 * routes.
 *
 * It is the repository's test and no one module's: the routes it reads are
 * every module's and the platform's own.
 */

const FILE = 'packages/modules/example/src/backend/routes.admin.ts';

/** Every fixture is a Fastify route file; the import is what marks it as one. */
const HEADER = "import type { FastifyInstance } from 'fastify';\n";

function defectsOf(
  text: string,
  allowed: Record<string, PermissionlessRouteEntry> = {},
  options: { files?: Record<string, string>; mounts?: Record<string, RegistrarMount> } = {},
): string[] {
  const sources = new Map<string, string>([[FILE, HEADER + text]]);
  for (const [file, body] of Object.entries(options.files ?? {})) sources.set(file, HEADER + body);
  return findPermissionlessRouteDefects(scanPermissionlessRoutes({ sources }, options.mounts ?? {}), allowed);
}

const SESSION: PermissionlessRouteEntry = { guard: 'session', reason: 'fixture' };
const unlisted = (key: string) => expect.stringContaining(`[unlisted] ${key} `);

describe('permissionless admin routes — the rule (issue #141)', () => {
  it('passes a route that checks a permission code', () => {
    expect(
      defectsOf("app.post('/api/v1/admin/i18n/reload', { preHandler: deps.requireAdmin('settings:write') }, h);"),
    ).toEqual([]);
  });

  it('refuses a bare requireAdmin() route that is not on the list', () => {
    expect(
      defectsOf("app.post('/api/v1/admin/i18n/reload', { preHandler: deps.requireAdmin() }, async () => ({}));"),
    ).toEqual([unlisted('POST /api/v1/admin/i18n/reload')]);
  });

  it('refuses an admin route with no preHandler at all that is not on the list', () => {
    expect(defectsOf("app.post('/api/v1/admin/things/purge', async () => ({}));")).toEqual([
      unlisted('POST /api/v1/admin/things/purge'),
    ]);
  });

  it('accepts a listed route, and tells a session guard from none', () => {
    const text = "app.get('/api/v1/admin/me', { preHandler: requireAdmin() }, h);";
    expect(defectsOf(text, { 'GET /api/v1/admin/me': SESSION })).toEqual([]);

    const changed = defectsOf(text, { 'GET /api/v1/admin/me': { guard: 'none', reason: 'fixture' } });
    expect(changed).toEqual([expect.stringContaining('[guard-changed] GET /api/v1/admin/me')]);
  });

  it('refuses an entry whose route has since been given a permission, or is gone', () => {
    const gated = defectsOf("app.get('/api/v1/admin/me', { preHandler: requireAdmin('x:read') }, h);", {
      'GET /api/v1/admin/me': SESSION,
    });
    expect(gated).toEqual([expect.stringContaining('[stale-entry] GET /api/v1/admin/me')]);

    const gone = defectsOf('export const nothing = 1;', { 'GET /api/v1/admin/me': SESSION });
    expect(gone).toEqual([expect.stringContaining('[stale-entry] GET /api/v1/admin/me')]);
  });

  it('refuses a gate it cannot read rather than counting it as gated', () => {
    expect(defectsOf("app.get('/api/v1/admin/things', { preHandler: deps.gate }, h);")).toEqual([
      expect.stringContaining('[unreadable-gate] GET /api/v1/admin/things'),
    ]);
  });

  it('reads a local factory that forwards its literal to the guard, and only that', () => {
    const route = "app.get('/api/v1/admin/customers/:id', { preHandler: forCustomer('customers:read') }, h);";

    // `customers`' shape: the permission, then a check on the id.
    const forwarding = 'const forCustomer = (permission: string) => [requireAdmin(permission), requireCustomerId];';
    expect(defectsOf(`${forwarding}\n${route}`)).toEqual([]);

    // A factory that drops its argument checks nothing, whatever it is handed.
    const dropping = 'const forCustomer = (permission: string) => [requireCustomerId];';
    expect(defectsOf(`${dropping}\n${route}`)).toEqual([
      expect.stringContaining('[unreadable-gate] GET /api/v1/admin/customers/:id'),
    ]);

    // And one that opens the session without it is a bare guard, counted as one.
    const bare = 'const forCustomer = (permission: string) => [requireAdmin(), requireCustomerId];';
    const defects = defectsOf(`${bare}\n${route}`);
    expect(defects).toContainEqual(expect.stringContaining('[unreadable-gate] GET /api/v1/admin/customers/:id'));
    expect(defects).toContainEqual(expect.stringContaining(`[unaccounted-guard] ${FILE} holds 1 bare`));

    // A code that is not a literal at the registration is not read.
    const computed = "app.get('/api/v1/admin/customers/:id', { preHandler: forCustomer(code) }, h);";
    expect(defectsOf(`${forwarding}\n${computed}`)).toEqual([
      expect.stringContaining('[unreadable-gate] GET /api/v1/admin/customers/:id'),
    ]);
  });

  it('does not read a guard call in a comment as a call', () => {
    expect(defectsOf('// preHandler: requireAdmin()\nexport const nothing = 1;')).toEqual([]);
  });
});

/**
 * Each of these is a way of writing a permissionless admin route that the first
 * version of this sweep reported as nothing at all (found by independent review
 * of the pull request that introduced it). The four that name a live route were
 * invisible in the tree, not only in a fixture.
 */
describe('permissionless admin routes — spellings that used to pass unread', () => {
  it('a path held in a const — `app.get(base, …)` (transactional_emails)', () => {
    const text = [
      "const base = '/api/v1/admin/transactional-emails';",
      'app.get(base, async () => ({}));',
      'app.get(`${base}/:code`, { preHandler: requireAdmin() }, async () => ({}));',
    ].join('\n');
    expect(defectsOf(text)).toEqual([
      unlisted('GET /api/v1/admin/transactional-emails'),
      unlisted('GET /api/v1/admin/transactional-emails/:code'),
    ]);
    // …and gated, the same spelling is read as gated.
    expect(
      defectsOf(
        "const base = '/api/v1/admin/transactional-emails';\napp.get(base, { preHandler: requireAdmin('t:read') }, async () => ({}));",
      ),
    ).toEqual([]);
  });

  it('a path that is a parameter of a local helper — `patchRoute(url, …)` (organizations)', () => {
    const helper = (options: string): string =>
      [
        'const patchRoute = (url: string, kind: string): void => {',
        `  app.patch(url, ${options}async () => ({ kind }));`,
        '};',
        "patchRoute('/api/v1/admin/organizations/:id/restrictions/payment-methods', 'payment_method');",
        "patchRoute('/api/v1/admin/organizations/:id/restrictions/delivery-methods', 'delivery_method');",
        "patchRoute('/api/v1/admin/organizations/:id/restrictions/warehouses', 'warehouse');",
      ].join('\n');

    expect(defectsOf(helper(''))).toEqual([
      unlisted('PATCH /api/v1/admin/organizations/:id/restrictions/delivery-methods'),
      unlisted('PATCH /api/v1/admin/organizations/:id/restrictions/payment-methods'),
      unlisted('PATCH /api/v1/admin/organizations/:id/restrictions/warehouses'),
    ]);
    expect(defectsOf(helper("{ preHandler: requireAdmin('customers:manage') }, "))).toEqual([]);
  });

  it('the full declaration — `app.route({ method, url, handler })`', () => {
    expect(
      defectsOf("app.route({ method: 'GET', url: '/api/v1/admin/things', handler: async () => ({}) });"),
    ).toEqual([unlisted('GET /api/v1/admin/things')]);
    expect(
      defectsOf(
        "app.route({ method: ['PUT', 'PATCH'], url: '/api/v1/admin/things', preHandler: requireAdmin(), handler: h });",
      ),
    ).toEqual([unlisted('PATCH /api/v1/admin/things'), unlisted('PUT /api/v1/admin/things')]);
    expect(
      defectsOf(
        "app.route({ method: 'GET', url: '/api/v1/admin/things', preHandler: requireAdmin('t:read'), handler: h });",
      ),
    ).toEqual([]);
  });

  it('the verbs nobody had typed yet — `.all` and `.head`', () => {
    expect(defectsOf("app.all('/api/v1/admin/things', async () => ({}));")).toEqual([
      unlisted('ALL /api/v1/admin/things'),
    ]);
    expect(
      defectsOf("app.head('/api/v1/admin/things', { preHandler: requireAdmin() }, async () => ({}));"),
    ).toEqual([unlisted('HEAD /api/v1/admin/things')]);
  });

  it('a concatenated path and a split prefix', () => {
    expect(defectsOf("app.get('/api/v1/admin' + '/things', async () => ({}));")).toEqual([
      unlisted('GET /api/v1/admin/things'),
    ]);
    const split = [
      "const API = '/api/v1';",
      'const ADMIN = `${API}/admin`;',
      'app.get(`${ADMIN}/things`, async () => ({}));',
    ].join('\n');
    expect(defectsOf(split)).toEqual([unlisted('GET /api/v1/admin/things')]);
  });

  it('a path nothing in the file resolves is unread, not absent', () => {
    expect(
      defectsOf("app.get(pathFor('things'), { preHandler: requireAdmin('t:read') }, async () => ({}));"),
    ).toEqual([
      expect.stringContaining(`[unreadable-path] ${FILE}:2 registers a route at \`pathFor('things')\``),
    ]);
    // …unless what was read already shows it is not an admin path.
    expect(defectsOf('app.get(`/api/v1/auth/${surface}/providers`, async () => ({}));')).toEqual([]);
    // A `Map` read and an HTTP client call are not registrations.
    expect(defectsOf('const a = rows.get(key); await client.post(url, body); cache.delete(key, true);')).toEqual([]);
  });

  it('a plugin registered under an admin prefix', () => {
    const text =
      "await app.register(async (child) => { child.get('/things', async () => ({})); }, { prefix: '/api/v1/admin/x' });";
    expect(defectsOf(text)).toEqual([expect.stringContaining(`[prefixed-plugin] ${FILE}:2`)]);
    expect(defectsOf('await app.register(plugin, { prefix: mountPoint });')).toEqual([
      expect.stringContaining('[prefixed-plugin]'),
    ]);
    // A prefix that is plainly elsewhere is nobody's business here.
    expect(defectsOf("await app.register(plugin, { prefix: '/api/v1/storefront/x' });")).toEqual([]);
  });

  it("an empty permission code — `requireAdmin('')` checks nothing at runtime", () => {
    const text = "app.post('/api/v1/admin/things/purge', { preHandler: requireAdmin('') }, h);";
    expect(defectsOf(text)).toEqual([unlisted('POST /api/v1/admin/things/purge')]);
    // Listed, it is one bare guard in place — the count sees it as one too.
    expect(defectsOf(text, { 'POST /api/v1/admin/things/purge': SESSION })).toEqual([]);
  });

  describe('a registrar mounted under a prefix it is handed (mfa)', () => {
    const REGISTRAR = 'packages/modules/example/src/backend/routes.self-service.ts';
    const PLUGIN = 'packages/modules/example/src/backend/plugin.ts';
    const mounts: Record<string, RegistrarMount> = {
      [REGISTRAR]: {
        registrar: 'registerSelfService',
        mountedIn: PLUGIN,
        pathParameter: 'pathPrefix',
        guardParameter: 'requireGuard',
        reason: 'fixture',
      },
    };
    const registrar = (extra = ''): string =>
      [
        'export async function registerSelfService(app: FastifyInstance, deps: Deps) {',
        '  const { pathPrefix, requireGuard } = deps;',
        '  app.get(`${pathPrefix}/status`, { preHandler: requireGuard }, async () => ({}));',
        extra,
        '}',
      ].join('\n');
    const plugin = (adminGuard: string): string =>
      [
        "await registerSelfService(app, { pathPrefix: '/api/v1/account/mfa', requireGuard: requireCustomer });",
        `await registerSelfService(app, { pathPrefix: '/api/v1/admin/account/mfa', requireGuard: ${adminGuard} });`,
      ].join('\n');
    const run = (
      registrarText: string,
      pluginText: string,
      allowed: Record<string, PermissionlessRouteEntry>,
    ): string[] =>
      defectsOf('export const nothing = 1;', allowed, {
        files: { [REGISTRAR]: registrarText, [PLUGIN]: pluginText },
        mounts,
      });
    const STATUS = { 'GET /api/v1/admin/account/mfa/status': SESSION };

    it('names the routes the admin mount opens, and holds them to the list', () => {
      expect(run(registrar(), plugin('requireAdmin()'), {})).toEqual([
        unlisted('GET /api/v1/admin/account/mfa/status'),
      ]);
      expect(run(registrar(), plugin('requireAdmin()'), STATUS)).toEqual([]);
    });

    it('reports a route added to the registrar by name', () => {
      const added = registrar('  app.post(`${pathPrefix}/wipe`, { preHandler: requireGuard }, async () => ({}));');
      expect(run(added, plugin('requireAdmin()'), STATUS)).toEqual([
        unlisted('POST /api/v1/admin/account/mfa/wipe'),
      ]);
    });

    it('reads a coded guard at the mount as a code, and retires the entries', () => {
      expect(run(registrar(), plugin("requireAdmin('mfa:self')"), {})).toEqual([]);
      expect(run(registrar(), plugin("requireAdmin('mfa:self')"), STATUS)).toEqual([
        expect.stringContaining('[stale-entry] GET /api/v1/admin/account/mfa/status'),
      ]);
    });

    it('without the declaration, the routes are unread and the guard unaccounted', () => {
      const defects = defectsOf('export const nothing = 1;', {}, {
        files: { [REGISTRAR]: registrar(), [PLUGIN]: plugin('requireAdmin()') },
      });
      expect(defects).toContainEqual(expect.stringContaining(`[unreadable-path] ${REGISTRAR}:4`));
      expect(defects).toContainEqual(expect.stringContaining(`[unaccounted-guard] ${PLUGIN} holds 1 bare`));
    });

    it('refuses a declaration whose mount it cannot read', () => {
      const computed =
        'await registerSelfService(app, { pathPrefix: prefixFor(subject), requireGuard: requireAdmin() });';
      expect(run(registrar(), computed, {})).toContainEqual(
        expect.stringContaining(`[unreadable-mount] ${PLUGIN}:2 calls registerSelfService without a literal`),
      );
    });
  });
});

describe('permissionless admin routes — this build (issue #141)', async () => {
  const scan = await readPermissionlessRoutes();

  it('read the admin route table, and the two instance-wide i18n routes are gated', () => {
    // A sweep that read nothing would report every entry stale; say so directly
    // rather than leave it to be inferred from a page of failures.
    expect(scan.files).toBeGreaterThan(0);
    expect(scan.routes.length).toBeGreaterThan(0);

    const clausesOf = (key: string) => scan.routes.find((route) => routeKeyOf(route) === key)?.clauses;
    expect(clausesOf('POST /api/v1/admin/i18n/reload')).toEqual([['settings:write']]);
    expect(clausesOf('GET /api/v1/admin/i18n/coverage')).toEqual([['settings:read']]);
  });

  it('reads the four live routes whose path is not a literal at the registration', () => {
    const clausesOf = (key: string) => scan.routes.find((route) => routeKeyOf(route) === key)?.clauses;
    expect(clausesOf('GET /api/v1/admin/transactional-emails')).toEqual([['transactional_emails:read']]);
    for (const tail of ['payment-methods', 'delivery-methods', 'warehouses']) {
      expect(clausesOf(`PATCH /api/v1/admin/organizations/:id/restrictions/${tail}`)).toEqual([
        ['customers:manage'],
      ]);
    }
  });

  it('sees every bare guard call the permission inventory sees, file by file', async () => {
    // Two readers of one population: the inventory's is a tokenising scan and
    // the one here walks the syntax tree. If this one goes blind to a file, the
    // inventory still names it.
    const inventory = await inventoryBareGuardSites();
    expect(inventory.size).toBeGreaterThan(0);
    for (const [file, count] of inventory) {
      expect(scan.bareGuardSites.get(file) ?? 0, file).toBe(count);
    }
  });

  it('every route without a permission code is on the list, with a reason, and nothing was left unread', () => {
    expect(findPermissionlessRouteDefects(scan)).toEqual([]);
    for (const [key, entry] of Object.entries(PERMISSIONLESS_ADMIN_ROUTES)) {
      expect(entry.reason.length, key).toBeGreaterThan(20);
    }
    for (const [file, entry] of Object.entries(REGISTRAR_MOUNTS)) {
      expect(entry.reason.length, file).toBeGreaterThan(20);
    }
  });
});
