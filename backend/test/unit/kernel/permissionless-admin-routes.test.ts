import { describe, expect, it } from 'vitest';

import {
  HANDED_ON_SESSION_GUARDS,
  PERMISSIONLESS_ADMIN_ROUTES,
  findPermissionlessRouteDefects,
  inventoryBareGuardSites,
  readPermissionlessRoutes,
  routeKeyOf,
  scanPermissionlessRoutes,
  type HandedOnGuardEntry,
  type PermissionlessRouteEntry,
} from '../../helpers/permissionless-admin-routes.js';

/**
 * Issue #141 — an admin route that checks no permission is on a list, with the
 * reason, or it is a defect.
 *
 * The rule and both lists are in `test/helpers/permissionless-admin-routes.ts`.
 * This file is the proofs that the rule can go red — one per defect it names,
 * each entering where a real run enters, as source text — and then the live
 * sweep over this build's own routes.
 *
 * It is the repository's test and no one module's: the routes it reads are
 * every module's and the platform's own.
 */

const FILE = 'packages/modules/example/src/backend/routes.admin.ts';

function defectsOf(
  text: string,
  allowed: Record<string, PermissionlessRouteEntry> = {},
  handedOn: Record<string, HandedOnGuardEntry> = {},
  file = FILE,
): string[] {
  return findPermissionlessRouteDefects(
    scanPermissionlessRoutes({ sources: new Map([[file, text]]) }),
    allowed,
    handedOn,
  );
}

const SESSION: PermissionlessRouteEntry = { guard: 'session', reason: 'fixture' };

describe('permissionless admin routes — the rule (issue #141)', () => {
  it('passes a route that checks a permission code', () => {
    expect(
      defectsOf("app.post('/api/v1/admin/i18n/reload', { preHandler: deps.requireAdmin('settings:write') }, h);"),
    ).toEqual([]);
  });

  it('refuses a bare requireAdmin() route that is not on the list', () => {
    const defects = defectsOf(
      "app.post('/api/v1/admin/i18n/reload', { preHandler: deps.requireAdmin() }, async () => ({}));",
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]).toContain('[unlisted] POST /api/v1/admin/i18n/reload');
  });

  it('refuses an admin route with no preHandler at all that is not on the list', () => {
    const defects = defectsOf("app.post('/api/v1/admin/things/purge', async () => ({}));");
    expect(defects).toHaveLength(1);
    expect(defects[0]).toContain('[unlisted] POST /api/v1/admin/things/purge');
  });

  it('accepts a listed route, and tells a session guard from none', () => {
    const text = "app.get('/api/v1/admin/me', { preHandler: requireAdmin() }, h);";
    expect(defectsOf(text, { 'GET /api/v1/admin/me': SESSION })).toEqual([]);

    const changed = defectsOf(text, { 'GET /api/v1/admin/me': { guard: 'none', reason: 'fixture' } });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('[guard-changed] GET /api/v1/admin/me');
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
    const defects = defectsOf("app.get('/api/v1/admin/things', { preHandler: deps.gate }, h);");
    expect(defects).toEqual([expect.stringContaining('[unreadable-gate] GET /api/v1/admin/things')]);
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

  it('refuses a bare guard handed to a registrar, whose routes carry no readable path', () => {
    // `mfa`'s shape: the route's URL is a parameter, so no route record exists
    // and only the guard call says that something was opened.
    const text = [
      'await registerSelfService(app, {',
      "  pathPrefix: '/api/v1/admin/account/mfa',",
      '  requireGuard: requireAdmin(),',
      '});',
    ].join('\n');
    const defects = defectsOf(text);
    expect(defects).toEqual([expect.stringContaining(`[unaccounted-guard] ${FILE} holds 1 bare`)]);

    const declared = { [FILE]: { sites: 1, opens: ['GET /api/v1/admin/account/mfa/status'], reason: 'fixture' } };
    expect(defectsOf(text, {}, declared)).toEqual([]);
  });

  it('refuses a handed-on declaration that no longer matches the calls in the file', () => {
    const declared = { [FILE]: { sites: 1, opens: [], reason: 'fixture' } };
    expect(defectsOf('export const nothing = 1;', {}, declared)).toEqual([
      expect.stringContaining(`[unaccounted-guard] ${FILE} holds 0 bare`),
    ]);
  });

  it('does not read a guard call in a comment as a call', () => {
    expect(defectsOf('// preHandler: requireAdmin()\nexport const nothing = 1;')).toEqual([]);
  });
});

describe('permissionless admin routes — this build (issue #141)', async () => {
  const scan = await readPermissionlessRoutes();

  it('read the admin route table, and the two instance-wide i18n routes are gated', () => {
    // A sweep that read nothing would report every entry stale; say so directly
    // rather than leave it to be inferred from eight failures.
    expect(scan.files).toBeGreaterThan(0);
    expect(scan.routes.length).toBeGreaterThan(0);

    const clausesOf = (key: string) => scan.routes.find((route) => routeKeyOf(route) === key)?.clauses;
    expect(clausesOf('POST /api/v1/admin/i18n/reload')).toEqual([['settings:write']]);
    expect(clausesOf('GET /api/v1/admin/i18n/coverage')).toEqual([['settings:read']]);
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

  it('every route without a permission code is on the list, with a reason, and no entry is stale', () => {
    expect(findPermissionlessRouteDefects(scan)).toEqual([]);
    for (const [key, entry] of Object.entries(PERMISSIONLESS_ADMIN_ROUTES)) {
      expect(entry.reason.length, key).toBeGreaterThan(20);
    }
    for (const [file, entry] of Object.entries(HANDED_ON_SESSION_GUARDS)) {
      expect(entry.reason.length, file).toBeGreaterThan(20);
      expect(entry.opens.length, file).toBeGreaterThan(0);
    }
  });
});
