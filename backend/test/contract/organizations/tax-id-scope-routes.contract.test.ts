import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, adminTaxIdScopeResponseSchema, type TaxIdScope } from '@endora-commerce/contracts';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * `specs/177-tax-id-scope/` T032 (FR-017; `contracts/tax-id-scope.md` §3) —
 * `GET` / `PUT /api/v1/admin/organizations/tax-id-scope`.
 *
 * Only an **unscoped** administrator holding
 * `organizations:manage-tax-id-scope` reads or changes the scope: the code
 * alone is not enough for a sales representative, whose reach is a subset of
 * the installation the scope governs (D-260's idiom). The 409 shape is the
 * Command's (`tax-id-scope-command.test.ts`); here it is the envelope.
 */
describe('/api/v1/admin/organizations/tax-id-scope', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);
  const SCOPED = `stub-taxscope-rep-${stamp}`;
  const WITHOUT = `stub-taxscope-without-${stamp}`;
  let initial: TaxIdScope;
  let repRolePermissions: string[] | null = null;

  const URL = '/api/v1/admin/organizations/tax-id-scope';

  const request = (method: 'GET' | 'PUT', session: string | null, payload?: object) =>
    h.app.inject({
      method,
      url: URL,
      ...(session ? { cookies: { b2b_session: session } } : {}),
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // A sales representative — the scoped role — granted the code itself.
    let rep = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (rep) {
      repRolePermissions = [...rep.permissions];
      rep.permissions = [...new Set([...rep.permissions, 'organizations:manage-tax-id-scope'])];
    } else {
      rep = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['organizations:manage-tax-id-scope'],
      });
    }
    const without = em.create(AdminRole, {
      code: `taxscope_without_${stamp}`,
      name: `Tax scope without ${stamp}`,
      permissions: ['customers:manage', 'customers:read'],
    });
    await em.persistAndFlush([rep, without]);
    const user = (role: AdminRole, tag: string) =>
      em.create(AdminUser, {
        email: `taxscope-${tag}-${stamp}@p.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'Tax',
        lastName: tag,
      });
    const repUser = user(rep, 'rep');
    const withoutUser = user(without, 'without');
    await em.persistAndFlush([repUser, withoutUser]);
    ADMIN_COOKIES[SCOPED] = { adminUserId: repUser.id };
    ADMIN_COOKIES[WITHOUT] = { adminUserId: withoutUser.id };

    const res = await request('GET', 'stub-admin-session');
    initial = (res.json() as { data: { scope: TaxIdScope } }).data.scope;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[SCOPED];
    delete ADMIN_COOKIES[WITHOUT];
    const em = h.em();
    const rep = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (rep && repRolePermissions) {
      rep.permissions = repRolePermissions;
      await em.flush();
    }
    await teardownBackendServer(h);
  });

  it('answers 401 without a session', async () => {
    expect((await request('GET', null)).statusCode).toBe(401);
    expect((await request('PUT', null, { scope: 'global' })).statusCode).toBe(401);
  });

  it('answers 403 to an administrator without organizations:manage-tax-id-scope', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const res = await request(method, WITHOUT, method === 'PUT' ? { scope: initial } : undefined);
      expect(res.statusCode, `${method} ${res.body}`).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
    }
  });

  it('answers 403 to a scoped administrator holding the code', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const res = await request(method, SCOPED, method === 'PUT' ? { scope: initial } : undefined);
      expect(res.statusCode, `${method} ${res.body}`).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
    }
  });

  it('GET answers the scope, who set it, the shared count and the enforcement', async () => {
    const res = await request('GET', 'stub-admin-session');
    expect(res.statusCode, res.body).toBe(200);
    const body = adminTaxIdScopeResponseSchema.parse(res.json());
    expect(body.data.scope).toBe(initial);
    expect(body.data.enforcement).toBe('consistent');
    expect(body.data.sharedTaxIdCount).toBeGreaterThanOrEqual(0);
  });

  it('PUT changes the scope and answers the GET shape; PUT back restores it', async () => {
    const target: TaxIdScope = initial === 'global' ? 'per-tree-root' : 'global';
    const changed = await request('PUT', 'stub-admin-session', { scope: target });
    expect(changed.statusCode, changed.body).toBe(200);
    const body = adminTaxIdScopeResponseSchema.parse(changed.json());
    expect(body.data).toMatchObject({ scope: target, enforcement: 'consistent' });

    const restored = await request('PUT', 'stub-admin-session', { scope: initial });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(adminTaxIdScopeResponseSchema.parse(restored.json()).data.scope).toBe(initial);
  });

  it('PUT refuses an unknown scope with 400', async () => {
    const res = await request('PUT', 'stub-admin-session', { scope: 'per-branch' });
    expect(res.statusCode).toBe(400);
  });

  it('PUT to global over a shared tax ID answers 409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES with its details', async () => {
    if (initial === 'global') {
      expect((await request('PUT', 'stub-admin-session', { scope: 'per-tree-root' })).statusCode).toBe(200);
    }
    const taxId = `TS${stamp}SHARED`;
    const em = h.em();
    const root = randomUUID();
    const branch = randomUUID();
    const insert = `insert into "organizations"
        ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at")
      values (?, ?, ?, 'active', 'vat_payer', false, '{}'::jsonb, ?, ?, now(), now())`;
    await em.execute(insert, [root, 'Scope route root', taxId, null, `/${root}/`]);
    await em.execute(insert, [branch, 'Scope route branch', taxId, root, `/${root}/${branch}/`]);
    try {
      const res = await request('PUT', 'stub-admin-session', { scope: 'global' });
      expect(res.statusCode, res.body).toBe(409);
      const error = (res.json() as {
        error: { code: string; message: string; details: { code: string; sharedTaxIdCount: number; examples: unknown[] } };
      }).error;
      // FR-015a — the sentence keyed by `details.code` says the sharing cannot
      // be resolved from the admin, and suggests no remedy the admin lacks.
      expect(error.message).toMatch(/cannot be resolved from the admin/);
      expect(error.message).not.toMatch(/give each|remove the extra/i);
      expect(error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES);
      expect(error.details.code).toBe('shared_tax_ids');
      expect(error.details.sharedTaxIdCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(error.details.examples)).toBe(true);
    } finally {
      await em.execute('delete from "organizations" where "id" = ?', [branch]);
      await em.execute('delete from "organizations" where "id" = ?', [root]);
      const back = await request('PUT', 'stub-admin-session', { scope: initial });
      expect(back.statusCode, back.body).toBe(200);
    }
  });
});
