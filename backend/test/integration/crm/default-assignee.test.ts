import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CRM_EVENTS,
  OpportunityDetailResponseSchema,
  OpportunityListResponseSchema,
  type OpportunityAssignedEvent,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  assignCrmSalesRep,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * Who an Opportunity is assigned to (User Story 3;
 * `specs/143-crm-sales-opportunities/research.md` R-9), against the real
 * `organizations` Sales Rep assignments.
 *
 * The default applies only when the request does not say: an explicit assignee
 * and an explicit "nobody" are both honoured. **Visibility is not by
 * assignee** — it is the tenant scope's — so a Sales Rep sees every
 * Opportunity of the Organizations they reach, whoever holds it.
 */
describe('crm assignment — the default assignee, reassignment, and the assignee filters', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let older: Seeded;
  let newer: Seeded;
  let inactive: Seeded;
  const seeded: Seeded[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { payload?: unknown; cookies?: Record<string, string> } = {},
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies: options.cookies ?? CRM_ADMIN,
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });

  const detail = async (id: string, cookies?: Record<string, string>) =>
    OpportunityDetailResponseSchema.parse(
      (await call('GET', `/opportunities/${id}`, cookies ? { cookies } : {})).json(),
    ).data;

  const listIds = async (query: string, cookies?: Record<string, string>) => {
    const response = await call('GET', `/opportunities${query}`, cookies ? { cookies } : {});
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json()).data.map((row) => row.id);
  };

  const organization = (label: string) => seedCrmOrganization(h.em(), label);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    older = await seedCrmAdmin(h.em(), 'older', ['crm:read', 'crm:write', 'orders:read']);
    newer = await seedCrmAdmin(h.em(), 'newer', ['crm:read', 'crm:write', 'orders:read']);
    inactive = await seedCrmAdmin(h.em(), 'inactive', ['crm:read', 'crm:write']);
    seeded.push(older, newer, inactive);
    const em = h.em();
    const row = await em.findOneOrFail(AdminUser, { id: inactive.adminUserId }, { filters: false });
    row.status = 'inactive';
    await em.flush();
  });

  afterAll(async () => {
    for (const admin of seeded) admin.undo();
    await teardownBackendServer(h);
  });

  describe('the default at creation', () => {
    it('is the only Sales Rep assigned to the Organization', async () => {
      const organizationId = await organization('One rep');
      await assignCrmSalesRep(h.em(), organizationId, older.adminUserId);
      const created = await createCrmOpportunity(h, { organizationId });
      expect((await detail(created.id)).assignee).toMatchObject({ id: older.adminUserId, active: true });
    });

    it('is the creator when the creator is one of several assigned Sales Reps', async () => {
      const organizationId = await organization('Creator among reps');
      await assignCrmSalesRep(h.em(), organizationId, older.adminUserId, new Date('2026-01-01T00:00:00Z'));
      await assignCrmSalesRep(h.em(), organizationId, newer.adminUserId, new Date('2026-06-01T00:00:00Z'));
      const created = await createCrmOpportunity(h, { organizationId }, newer.cookies);
      expect((await detail(created.id)).assignee?.id).toBe(newer.adminUserId);
    });

    it('is the longest-standing assigned Sales Rep when somebody else creates it', async () => {
      const organizationId = await organization('Somebody else creates');
      // Written newest first, so the answer cannot be "the first row read".
      await assignCrmSalesRep(h.em(), organizationId, newer.adminUserId, new Date('2026-06-01T00:00:00Z'));
      await assignCrmSalesRep(h.em(), organizationId, older.adminUserId, new Date('2026-01-01T00:00:00Z'));
      const created = await createCrmOpportunity(h, { organizationId });
      expect((await detail(created.id)).assignee?.id).toBe(older.adminUserId);
    });

    it('skips an assigned Sales Rep who is no longer active', async () => {
      const organizationId = await organization('Inactive rep');
      await assignCrmSalesRep(h.em(), organizationId, inactive.adminUserId, new Date('2026-01-01T00:00:00Z'));
      await assignCrmSalesRep(h.em(), organizationId, newer.adminUserId, new Date('2026-06-01T00:00:00Z'));
      const created = await createCrmOpportunity(h, { organizationId });
      expect((await detail(created.id)).assignee?.id).toBe(newer.adminUserId);
    });

    it('is nobody when the Organization has no assigned Sales Rep', async () => {
      const organizationId = await organization('No rep');
      const created = await createCrmOpportunity(h, { organizationId });
      expect((await detail(created.id)).assignee).toBeNull();
    });

    it('does not apply when the request names an assignee, or names nobody', async () => {
      const organizationId = await organization('Explicit');
      await assignCrmSalesRep(h.em(), organizationId, older.adminUserId);
      const explicit = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: newer.adminUserId });
      expect((await detail(explicit.id)).assignee?.id).toBe(newer.adminUserId);
      const nobody = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: null });
      expect((await detail(nobody.id)).assignee).toBeNull();
    });

    it('refuses an inactive or unknown assignee — 422 CRM_ASSIGNEE_INVALID', async () => {
      const organizationId = await organization('Refused on create');
      for (const assignedAdminUserId of [inactive.adminUserId, '00000000-0000-4000-8000-00000000dead']) {
        const response = await call('POST', '/opportunities', {
          payload: { title: 'x', organizationId, currency: 'PLN', assignedAdminUserId },
        });
        expect(response.statusCode, response.body).toBe(422);
        expect(response.json().error.code).toBe('CRM_ASSIGNEE_INVALID');
      }
      expect(await listIds(`?organizationId=${organizationId}`)).toEqual([]);
    });
  });

  describe('POST /opportunities/:id/assign', () => {
    it('reassigns, records it in the history, and announces it once with the previous assignee', async () => {
      const organizationId = await organization('Reassign');
      await assignCrmSalesRep(h.em(), organizationId, older.adminUserId);
      const created = await createCrmOpportunity(h, { organizationId });

      const events: OpportunityAssignedEvent[] = [];
      const off = h.eventBus.on(CRM_EVENTS.ASSIGNED, (payload: unknown) => {
        const event = payload as OpportunityAssignedEvent;
        if (event.opportunityId === created.id) events.push(event);
      });
      try {
        const response = await call('POST', `/opportunities/${created.id}/assign`, {
          payload: { adminUserId: newer.adminUserId },
        });
        expect(response.statusCode, response.body).toBe(200);
        const body = OpportunityDetailResponseSchema.parse(response.json()).data;
        expect(body.assignee).toMatchObject({ id: newer.adminUserId, active: true });
        expect(body.version).toBe(created.version + 1);
      } finally {
        off();
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        opportunityId: created.id,
        organizationId,
        assignedAdminUserId: newer.adminUserId,
        previousAdminUserId: older.adminUserId,
      });

      const audit = await h.auditLogService.query({ action: 'crm.opportunity.assign', objectId: created.id });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        objectType: 'crm_opportunity',
        stateBefore: { assignedAdminUserId: older.adminUserId },
        stateAfter: { assignedAdminUserId: newer.adminUserId },
      });
    });

    it('unassigns with null', async () => {
      const organizationId = await organization('Unassign');
      const created = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: older.adminUserId });
      const response = await call('POST', `/opportunities/${created.id}/assign`, { payload: { adminUserId: null } });
      expect(response.statusCode, response.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(response.json()).data.assignee).toBeNull();
    });

    it('writes nothing when the assignee is already the one named', async () => {
      const organizationId = await organization('Same assignee');
      const created = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: older.adminUserId });
      const response = await call('POST', `/opportunities/${created.id}/assign`, {
        payload: { adminUserId: older.adminUserId },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(response.json()).data.version).toBe(created.version);
      expect(await h.auditLogService.query({ action: 'crm.opportunity.assign', objectId: created.id })).toEqual([]);
    });

    it('refuses an inactive user and an unknown one — 422 CRM_ASSIGNEE_INVALID, nothing written', async () => {
      const organizationId = await organization('Refused');
      const created = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: older.adminUserId });
      for (const adminUserId of [inactive.adminUserId, '00000000-0000-4000-8000-00000000dead']) {
        const response = await call('POST', `/opportunities/${created.id}/assign`, { payload: { adminUserId } });
        expect(response.statusCode, response.body).toBe(422);
        expect(response.json().error.code).toBe('CRM_ASSIGNEE_INVALID');
      }
      expect((await detail(created.id)).assignee?.id).toBe(older.adminUserId);
    });

    it('is gated crm:write and answers 404 for an Opportunity that does not exist', async () => {
      const viewer = await seedCrmAdmin(h.em(), 'assign-viewer', ['crm:read']);
      seeded.push(viewer);
      const created = await createCrmOpportunity(h, { organizationId: await organization('Gate') });
      const refused = await call('POST', `/opportunities/${created.id}/assign`, {
        payload: { adminUserId: null },
        cookies: viewer.cookies,
      });
      expect(refused.statusCode, refused.body).toBe(403);
      const missing = await call('POST', '/opportunities/00000000-0000-4000-8000-00000000dead/assign', {
        payload: { adminUserId: null },
      });
      expect(missing.statusCode, missing.body).toBe(404);
      expect(missing.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });

    it('refuses the same on PATCH, which may also change the assignee', async () => {
      const created = await createCrmOpportunity(h, { organizationId: await organization('Patch') });
      const refused = await call('PATCH', `/opportunities/${created.id}`, {
        payload: { assignedAdminUserId: inactive.adminUserId },
      });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('CRM_ASSIGNEE_INVALID');
    });
  });

  describe('the assignee filters of the list', () => {
    it('answers "mine", "unassigned" and one named assignee', async () => {
      const organizationId = await organization('Filters');
      const mine = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: TEST_ADMIN_ID });
      const theirs = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: older.adminUserId });
      const nobodys = await createCrmOpportunity(h, { organizationId, assignedAdminUserId: null });
      const scope = `organizationId=${organizationId}`;

      expect(await listIds(`?${scope}&assignedAdminUserId=me`)).toEqual([mine.id]);
      expect(await listIds(`?${scope}&assignedAdminUserId=unassigned`)).toEqual([nobodys.id]);
      expect(await listIds(`?${scope}&assignedAdminUserId=${older.adminUserId}`)).toEqual([theirs.id]);
      // "me" is whoever asks.
      expect(await listIds(`?${scope}&assignedAdminUserId=me`, older.cookies)).toEqual([theirs.id]);
      expect((await listIds(`?${scope}`)).sort()).toEqual([mine.id, theirs.id, nobodys.id].sort());
    });
  });

  describe('visibility is the tenant scope, not the assignee', () => {
    it('shows a Sales Rep an Opportunity of their Organization that somebody else holds', async () => {
      const reachable = await organization('Rep reaches');
      const unreachable = await organization('Rep does not reach');
      const rep = await seedCrmSalesRep(h.em(), [reachable], ['crm:read', 'crm:write', 'orders:read']);
      seeded.push(rep);

      // The rep is the Organization's only Sales Rep, so the default would be
      // them — the Opportunity is given to somebody else on purpose.
      const held = await createCrmOpportunity(h, { organizationId: reachable, assignedAdminUserId: older.adminUserId });
      const elsewhere = await createCrmOpportunity(h, {
        organizationId: unreachable,
        assignedAdminUserId: rep.adminUserId,
      });

      const visible = await listIds('', rep.cookies);
      expect(visible).toContain(held.id);
      // Assigned to the rep, and still not theirs to see: the Organization is out of reach.
      expect(visible).not.toContain(elsewhere.id);
      expect((await detail(held.id, rep.cookies)).assignee?.id).toBe(older.adminUserId);
      expect(await listIds('?assignedAdminUserId=me', rep.cookies)).toEqual([]);
      const hidden = await call('GET', `/opportunities/${elsewhere.id}`, { cookies: rep.cookies });
      expect(hidden.statusCode, hidden.body).toBe(404);
    });
  });
});
