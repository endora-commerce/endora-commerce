import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Organization } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES, TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Feature 154 — an Organization's sales channels, managed from its own detail
 * page (`specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §2, US5).
 *
 * `GET` answers the assignment and every channel it may hold, so the panel needs
 * no `sales_channels:read`; `PUT` replaces the whole set as the Command
 * `organization.sales_channels.set` (`specs/186-aggregate-ports/` R-16.1): one
 * transaction holding the kernel membership writer's audit row per membership
 * added or removed with the acting administrator, beside the Command's own
 * `organization` entry, and the access cache dropped after the commit so the
 * Organization's very next request is decided on the new set.
 */
describe('admin Organization sales channels', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const READER = `stub-orgsc-reader-${stamp}`;
  const MANAGER = `stub-orgsc-manager-${stamp}`;
  const OTHER = `stub-orgsc-other-${stamp}`;
  let orgId: string;
  let defaultId: string;
  let channelA: string;
  let channelB: string;
  let inactiveId: string;

  const url = (id: string): string => `/api/v1/admin/organizations/${id}/sales-channels`;

  async function get(id: string, session = 'stub-admin-session') {
    return h.app.inject({ method: 'GET', url: url(id), cookies: { b2b_session: session } });
  }

  async function put(id: string, salesChannelIds: unknown, session = 'stub-admin-session') {
    return h.app.inject({
      method: 'PUT',
      url: url(id),
      cookies: { b2b_session: session },
      payload: { salesChannelIds },
    });
  }

  async function membershipAuditRows(): Promise<AuditLogEntry[]> {
    const em = h.em();
    em.clear();
    const rows = await em.find(
      AuditLogEntry,
      { action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED, objectType: 'sales_channel_membership' },
      { orderBy: { actedAt: 'asc' } },
    );
    return rows.filter((row) => row.objectId.endsWith(`:organization:${orgId}`));
  }

  /** The Command's own entries for the Organization (R-16.1). */
  async function organizationEntries(): Promise<AuditLogEntry[]> {
    const em = h.em();
    em.clear();
    return em.find(
      AuditLogEntry,
      { action: 'organization.sales_channels.set', objectType: 'organization', objectId: orgId },
      { orderBy: { actedAt: 'asc' } },
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    async function admin(label: string, permissions: readonly string[]): Promise<string> {
      const role = em.create(AdminRole, {
        code: `orgsc_${label}_${stamp}`,
        name: `orgsc ${label}`,
        permissions: [...permissions],
      });
      await em.persist(role).flush();
      const account = em.create(AdminUser, {
        email: `orgsc-${label}-${stamp}@example.test`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Org',
        lastName: label,
        adminRoleId: role.id,
      });
      await em.persist(account).flush();
      return account.id;
    }
    ADMIN_COOKIES[READER] = { adminUserId: await admin('reader', ['customers:read']) };
    ADMIN_COOKIES[MANAGER] = { adminUserId: await admin('manager', ['customers:manage']) };
    ADMIN_COOKIES[OTHER] = { adminUserId: await admin('other', ['orders:read']) };

    const make = (code: string, active = true): SalesChannel =>
      em.create(SalesChannel, {
        code,
        name: { en: code },
        defaultLanguage: 'en',
        languages: ['en'],
        defaultCurrency: 'PLN',
        currencies: ['PLN'],
        active,
      });
    const a = make(`orgsc-a-${stamp}`);
    const b = make(`orgsc-b-${stamp}`);
    const inactive = make(`orgsc-off-${stamp}`, false);
    await em.persist([a, b, inactive]).flush();
    channelA = a.id;
    channelB = b.id;
    inactiveId = inactive.id;
    defaultId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;

    const org = em.create(Organization, {
      name: 'Org Channels Co',
      taxId: `PL154C${stamp}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Kanałowa 1', city: 'Warszawa', postalCode: '00-154', country: 'PL' },
    });
    await em.persist(org).flush();
    orgId = org.id;
    await assignOrganizationChannels(h, orgId, [a.code]);
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[READER];
    delete ADMIN_COOKIES[MANAGER];
    delete ADMIN_COOKIES[OTHER];
    await teardownBackendServer(h);
  });

  describe('GET', () => {
    it('answers the assignment and every channel, inactive and default marked', async () => {
      const res = await get(orgId);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          organizationId: string;
          assignedSalesChannelIds: string[];
          options: Array<{ id: string; code: string; active: boolean; systemDefault: boolean }>;
        };
      };
      expect(body.data.organizationId).toBe(orgId);
      expect(body.data.assignedSalesChannelIds).toEqual([channelA]);
      const byId = new Map(body.data.options.map((o) => [o.id, o]));
      expect(byId.get(channelA)?.active).toBe(true);
      expect(byId.get(inactiveId)?.active).toBe(false);
      expect(byId.get(defaultId)?.systemDefault).toBe(true);
      expect(byId.get(channelA)?.systemDefault).toBe(false);
    });

    it('opens with customers:read or customers:manage, and refuses anything else', async () => {
      expect((await get(orgId, READER)).statusCode).toBe(200);
      expect((await get(orgId, MANAGER)).statusCode).toBe(200);
      expect((await get(orgId, OTHER)).statusCode).toBe(403);
      const anonymous = await h.app.inject({ method: 'GET', url: url(orgId) });
      expect(anonymous.statusCode).toBe(401);
    });

    it('answers 404 for an unknown Organization', async () => {
      const res = await get('00000000-0000-4000-8000-00000000dead');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT', () => {
    it('is refused without customers:manage', async () => {
      const res = await put(orgId, [channelA, channelB], READER);
      expect(res.statusCode).toBe(403);
      expect((await get(orgId)).json().data.assignedSalesChannelIds).toEqual([channelA]);
    });

    it('answers 404 for an unknown or deleted Organization', async () => {
      expect((await put('00000000-0000-4000-8000-00000000dead', [channelA])).statusCode).toBe(404);
      const em = h.em();
      const gone = em.create(Organization, {
        name: 'Gone Co',
        taxId: `PL154D${stamp}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'x', city: 'y', postalCode: '00-000', country: 'PL' },
        deletedAt: new Date(),
      });
      await em.persist(gone).flush();
      expect((await put(gone.id, [channelA])).statusCode).toBe(404);
    });

    it('refuses an empty set and leaves the assignment as it was', async () => {
      const res = await put(orgId, []);
      expect([400, 422]).toContain(res.statusCode);
      expect(res.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((await get(orgId)).json().data.assignedSalesChannelIds).toEqual([channelA]);
    });

    it('refuses an id that names no channel with 422 and the offending path', async () => {
      const res = await put(orgId, [channelA, '00000000-0000-4000-8000-00000000beef']);
      expect(res.statusCode).toBe(422);
      const error = res.json().error as { code: string; details: Array<{ path: string }> };
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(error.details.map((d) => d.path)).toEqual(['salesChannelIds.1']);
      expect((await get(orgId)).json().data.assignedSalesChannelIds).toEqual([channelA]);
    });

    it('replaces the whole set, audits each change with the admin, and drops the access cache', async () => {
      // Warm the cache the access rule reads, so a write that did not drop it
      // would leave the Organization decided on its old set.
      expect([...(await h.salesChannels.accessPolicy.permittedChannelIds(orgId))]).toEqual([
        channelA,
      ]);
      const auditBefore = (await membershipAuditRows()).length;
      const commandBefore = (await organizationEntries()).length;

      const res = await put(orgId, [channelB, inactiveId], MANAGER);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { assignedSalesChannelIds: string[] } };
      expect([...body.data.assignedSalesChannelIds].sort()).toEqual([channelB, inactiveId].sort());

      const permitted = await h.salesChannels.accessPolicy.permittedChannelIds(orgId);
      expect([...permitted].sort()).toEqual([channelB, inactiveId].sort());

      const rows = (await membershipAuditRows()).slice(auditBefore);
      expect(rows).toHaveLength(3);
      const ops = rows
        .map((row) => {
          const after = row.stateAfter as { channelId: string; op: string };
          return `${after.op}:${after.channelId}`;
        })
        .sort();
      expect(ops).toEqual(
        [`remove:${channelA}`, `add:${channelB}`, `add:${inactiveId}`].sort(),
      );
      for (const row of rows) {
        expect(row.actorAdminUserId).toBe(ADMIN_COOKIES[MANAGER]!.adminUserId);
      }

      // The Command's one entry, ids only, beside the membership trail.
      const commandRows = (await organizationEntries()).slice(commandBefore);
      expect(commandRows).toHaveLength(1);
      expect(commandRows[0]).toMatchObject({
        actorAdminUserId: ADMIN_COOKIES[MANAGER]!.adminUserId,
        stateBefore: { salesChannelIds: [channelA] },
        stateAfter: { salesChannelIds: [channelB, inactiveId].sort() },
      });
    });

    it('is idempotent: the same set again changes and audits nothing', async () => {
      const auditBefore = (await membershipAuditRows()).length;
      const commandBefore = (await organizationEntries()).length;
      const res = await put(orgId, [inactiveId, channelB]);
      expect(res.statusCode).toBe(200);
      expect((await membershipAuditRows()).length).toBe(auditBefore);
      expect((await organizationEntries()).length).toBe(commandBefore);
    });

    it('records the platform administrator as the actor too', async () => {
      const auditBefore = (await membershipAuditRows()).length;
      expect((await put(orgId, [channelA])).statusCode).toBe(200);
      const rows = (await membershipAuditRows()).slice(auditBefore);
      expect(rows.length).toBe(3);
      for (const row of rows) expect(row.actorAdminUserId).toBe(TEST_ADMIN_ID);
    });
  });
});
