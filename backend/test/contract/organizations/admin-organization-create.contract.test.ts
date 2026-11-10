import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Organization } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Feature 154 — an operator creates a customer Organization and chooses its
 * sales channels (`specs/154-sales-channel-access/contracts/admin-api-and-ui.md`
 * §3, US5).
 *
 * The Organization and its channel assignment are written in **one**
 * transaction, through the Command `organization.create`: an Organization with
 * no channel may shop nowhere, so a create whose assignment failed must leave
 * nothing behind rather than an Organization locked out of every store.
 */
describe('POST /api/v1/admin/organizations', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);
  const READER = `stub-orgcreate-reader-${stamp}`;
  const MANAGER = `stub-orgcreate-manager-${stamp}`;
  let channelA: string;
  let channelB: string;
  let seq = 0;

  const taxId = (): string => `PL154N${stamp}${(seq++).toString().padStart(2, '0')}`;

  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: `Created Co ${stamp}`,
      taxId: taxId(),
      registeredAddress: {
        street: 'ul. Nowa 1',
        city: 'Kraków',
        postalCode: '30-001',
        country: 'PL',
      },
      salesChannelIds: [channelA],
      ...overrides,
    };
  }

  async function post(payload: Record<string, unknown>, session = 'stub-admin-session') {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: session },
      payload,
    });
  }

  async function channelsOf(organizationId: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${organizationId}/sales-channels`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    return [...(res.json() as { data: { assignedSalesChannelIds: string[] } }).data.assignedSalesChannelIds].sort();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    async function admin(label: string, permissions: readonly string[]): Promise<string> {
      const role = em.create(AdminRole, {
        code: `orgcreate_${label}_${stamp}`,
        name: `orgcreate ${label}`,
        permissions: [...permissions],
      });
      await em.persistAndFlush(role);
      const account = em.create(AdminUser, {
        email: `orgcreate-${label}-${stamp}@example.test`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Org',
        lastName: label,
        adminRoleId: role.id,
      });
      await em.persistAndFlush(account);
      return account.id;
    }
    ADMIN_COOKIES[READER] = { adminUserId: await admin('reader', ['customers:read']) };
    ADMIN_COOKIES[MANAGER] = { adminUserId: await admin('manager', ['customers:manage']) };

    const make = (code: string): SalesChannel =>
      em.create(SalesChannel, {
        code,
        name: { en: code },
        defaultLanguage: 'en',
        languages: ['en'],
        defaultCurrency: 'PLN',
        currencies: ['PLN'],
      });
    const a = make(`orgcreate-a-${stamp}`);
    const b = make(`orgcreate-b-${stamp}`);
    await em.persistAndFlush([a, b]);
    channelA = a.id;
    channelB = b.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[READER];
    delete ADMIN_COOKIES[MANAGER];
    await teardownBackendServer(h);
  });

  it('offers the channel options the form chooses from, the default marked', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/sales-channel-options',
      cookies: { b2b_session: MANAGER },
    });
    expect(res.statusCode).toBe(200);
    const options = (res.json() as {
      data: Array<{ id: string; active: boolean; systemDefault: boolean }>;
    }).data;
    expect(options.map((o) => o.id)).toEqual(expect.arrayContaining([channelA, channelB]));
    expect(options.filter((o) => o.systemDefault)).toHaveLength(1);
    const refused = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/sales-channel-options',
      cookies: { b2b_session: READER },
    });
    expect(refused.statusCode).toBe(403);
  });

  it('is refused without customers:manage', async () => {
    const payload = body();
    const res = await post(payload, READER);
    expect(res.statusCode).toBe(403);
    const anonymous = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      payload,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(await h.em().fork().findOne(Organization, { taxId: payload['taxId'] as string })).toBeNull();
  });

  it('creates the Organization with exactly the selected channels, audited as organization.create', async () => {
    const payload = body({ salesChannelIds: [channelA, channelB] });
    const res = await post(payload, MANAGER);
    expect(res.statusCode).toBe(201);
    const created = (res.json() as {
      data: { id: string; name: string; taxId: string; status: string; isPersonal: boolean };
    }).data;
    expect(created.taxId).toBe(payload['taxId']);
    expect(created.status).toBe('active');
    expect(created.isPersonal).toBe(false);
    expect(await channelsOf(created.id)).toEqual([channelA, channelB].sort());

    const em = h.em().fork();
    const rows = await em.find(AuditLogEntry, {
      action: 'organization.create',
      objectType: 'organization',
      objectId: created.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorAdminUserId).toBe(ADMIN_COOKIES[MANAGER]!.adminUserId);
    expect(rows[0]!.stateBefore ?? null).toBeNull();
    expect(rows[0]!.stateAfter).toMatchObject({
      name: payload['name'],
      taxId: payload['taxId'],
      status: 'active',
      salesChannelIds: [channelA, channelB].sort(),
    });
  });

  // `specs/177-tax-id-scope/` T041d (D-290 / OD-11) — stored normalised, and a
  // second spelling of one tax ID is the same tax ID.
  it('stores the tax ID normalised and refuses another spelling of it', async () => {
    const digits = `${stamp}77`;
    const res = await post(body({ taxId: `pl ${digits.slice(0, 3)}-${digits.slice(3)}` }));
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { data: { taxId: string } }).data.taxId).toBe(`PL${digits}`);
    const again = await post(body({ taxId: `PL-${digits}` }));
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
  });

  it('may start an Organization pending verification', async () => {
    const res = await post(body({ status: 'pending_verification' }));
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { status: string } }).data.status).toBe('pending_verification');
  });

  it('validates the body', async () => {
    for (const payload of [
      body({ name: '' }),
      body({ taxId: '1' }),
      body({ salesChannelIds: [] }),
      body({ salesChannelIds: [channelA, channelA] }),
      body({ status: 'blocked' }),
      body({ registeredAddress: { street: 'x', city: 'y', postalCode: '1', country: 'POL' } }),
    ]) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
    const noChannels = body();
    delete noChannels['salesChannelIds'];
    expect((await post(noChannels)).statusCode).toBe(400);
  });

  it('refuses a channel id that names no channel, and creates nothing', async () => {
    const payload = body({ salesChannelIds: [channelA, '00000000-0000-4000-8000-00000000beef'] });
    const res = await post(payload);
    expect(res.statusCode).toBe(422);
    const error = res.json().error as { code: string; details: Array<{ path: string }> };
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details.map((d) => d.path)).toEqual(['salesChannelIds.1']);
    expect(await h.em().fork().findOne(Organization, { taxId: payload['taxId'] as string })).toBeNull();
  });

  it('refuses a tax id that is already registered, as registration does', async () => {
    const payload = body();
    expect((await post(payload)).statusCode).toBe(201);
    const again = await post({ ...payload, name: 'Someone else' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
  });

  it('rolls the Organization back when its channels cannot be assigned', async () => {
    vi.spyOn(h.salesChannels.membershipService, 'replaceChannelsForEntity').mockRejectedValueOnce(
      new Error('assignment failed'),
    );
    const payload = body();
    const res = await post(payload);
    expect(res.statusCode).toBe(500);
    const em = h.em().fork();
    expect(await em.findOne(Organization, { taxId: payload['taxId'] as string })).toBeNull();
    const audited = await em.find(AuditLogEntry, { action: 'organization.create' });
    expect(
      audited.filter((row) => (row.stateAfter as { taxId?: string } | null)?.taxId === payload['taxId']),
    ).toHaveLength(0);
  });

  /**
   * `specs/177-tax-id-scope/` T034 (FR-018, FR-019; `contracts/tax-id-scope.md`
   * §5, §6) — a branch created under its head office, and which tax IDs each
   * scope lets it carry. The scope-specific cases set the scope themselves
   * through the route and put back the one they found, after giving their
   * branches tax IDs of their own: `global`'s constraint cannot return over a
   * shared one.
   */
  describe('parentId and the tax-ID scope', () => {
    const SCOPED = `stub-orgcreate-rep-${stamp}`;
    let repRolePermissions: string[] | null = null;
    let initialScope: 'global' | 'per-tree-root';
    const sharing: string[] = [];

    const putScope = async (scope: 'global' | 'per-tree-root') => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/organizations/tax-id-scope',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { scope },
      });
      expect(res.statusCode, res.body).toBe(200);
    };

    const created = (res: { json(): unknown }) =>
      (res.json() as { data: { id: string; parentId: string | null; path: string; taxId: string } }).data;

    beforeAll(async () => {
      const em = h.em();
      let rep = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (rep) {
        repRolePermissions = [...rep.permissions];
        rep.permissions = [...new Set([...rep.permissions, 'customers:manage'])];
      } else {
        rep = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: ['customers:manage'] });
      }
      await em.persistAndFlush(rep);
      const user = em.create(AdminUser, {
        email: `orgcreate-rep-${stamp}@example.test`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Org',
        lastName: 'Rep',
        adminRoleId: rep.id,
      });
      await em.persistAndFlush(user);
      ADMIN_COOKIES[SCOPED] = { adminUserId: user.id };
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/organizations/tax-id-scope',
        cookies: { b2b_session: 'stub-admin-session' },
      });
      initialScope = (res.json() as { data: { scope: 'global' | 'per-tree-root' } }).data.scope;
    });

    afterEach(async () => {
      if (sharing.length > 0) {
        await h.em().execute(
          `update "organizations" set "tax_id" = 'R' || upper(substr(replace("id"::text, '-', ''), 1, 31))
            where "id" = any(?::uuid[])`,
          [`{${sharing.join(',')}}`],
        );
        sharing.length = 0;
      }
      await putScope(initialScope);
    });

    afterAll(async () => {
      delete ADMIN_COOKIES[SCOPED];
      const em = h.em();
      const rep = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (rep && repRolePermissions) {
        rep.permissions = repRolePermissions;
        await em.flush();
      }
    });

    it('creates a branch under the parent, with the parent path, audited with parentId', async () => {
      const parent = created(await post(body()));
      const res = await post(body({ parentId: parent.id }));
      expect(res.statusCode, res.body).toBe(201);
      const child = created(res);
      expect(child.parentId).toBe(parent.id);
      expect(child.path).toBe(`${parent.path}${child.id}/`);
      const [entry] = await h.em().fork().find(AuditLogEntry, { action: 'organization.create', objectId: child.id });
      expect(entry!.stateAfter).toMatchObject({ parentId: parent.id });
    });

    it('refuses a parent from a scoped administrator, and an unknown parent', async () => {
      const parent = created(await post(body()));
      const scoped = await post(body({ parentId: parent.id }), SCOPED);
      expect(scoped.statusCode, scoped.body).toBe(403);
      expect(scoped.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
      const unknown = await post(body({ parentId: '00000000-0000-4000-8000-00000000dead' }));
      expect(unknown.statusCode).toBe(404);
    });

    it('global: a tax ID held anywhere is refused, under the holder too', async () => {
      await putScope('global');
      const holder = created(await post(body()));
      for (const extra of [{}, { parentId: holder.id }]) {
        const res = await post(body({ taxId: holder.taxId, ...extra }));
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
      }
    });

    it('per-tree-root: the tree may share its tax ID; a new root or another tree may not', async () => {
      await putScope('per-tree-root');
      const head = created(await post(body()));
      const branchRes = await post(body({ taxId: head.taxId, parentId: head.id }));
      expect(branchRes.statusCode, branchRes.body).toBe(201);
      const branch = created(branchRes);
      sharing.push(branch.id);
      // Deeper in the same tree, too.
      const deeper = await post(body({ taxId: head.taxId, parentId: branch.id }));
      expect(deeper.statusCode, deeper.body).toBe(201);
      sharing.push(created(deeper).id);

      const asRoot = await post(body({ taxId: head.taxId }));
      expect(asRoot.statusCode, asRoot.body).toBe(409);
      expect(asRoot.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
      const elsewhere = created(await post(body()));
      const otherTree = await post(body({ taxId: head.taxId, parentId: elsewhere.id }));
      expect(otherTree.statusCode, otherTree.body).toBe(409);
      expect(otherTree.json().error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
    });
  });
});
