import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification, CrmOpportunity } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  assignCrmSalesRep,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
} from '../../helpers/seed-crm.js';

/**
 * Telling a person an Opportunity is now theirs (User Story 3;
 * `specs/143-crm-sales-opportunities/research.md` R-11).
 *
 * The bell belongs to `admin_notifications`, which an operator may switch off.
 * CRM **decides** that module's presence before it asks — it does not catch the
 * refusal after — so with the bell off an assignment succeeds exactly as it
 * does with it on, and nothing is recorded.
 */
describe('crm assignment notification', () => {
  let h: BackendServerHandle;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

  const assign = (opportunityId: string, adminUserId: string | null, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({
      method: 'POST',
      url: `${CRM_API}/opportunities/${opportunityId}/assign`,
      cookies,
      payload: { adminUserId },
    });

  const notificationsAbout = (opportunityId: string) =>
    h.em().find(AdminNotification, { subjectId: opportunityId }, { filters: false, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    colleague = await seedCrmAdmin(h.em(), 'colleague', ['crm:read', 'crm:write', 'orders:read']);
  });

  afterAll(async () => {
    colleague.undo();
    await teardownBackendServer(h);
  });

  it('records one notification for the new assignee, linking to the Opportunity', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'Forklift fleet', assignedAdminUserId: null });
    expect(await notificationsAbout(opportunity.id)).toEqual([]);

    const response = await assign(opportunity.id, colleague.adminUserId);
    expect(response.statusCode, response.body).toBe(200);

    const recorded = await notificationsAbout(opportunity.id);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      audience: 'admin_user',
      targetAdminUserId: colleague.adminUserId,
      kind: 'crm.opportunity.assigned',
      subjectType: 'crm_opportunity',
      subjectId: opportunity.id,
      linkPath: `/crm/opportunities/${opportunity.id}`,
    });
    expect(recorded[0]?.title).toContain(opportunity.number);
    expect(recorded[0]?.title).toContain('Forklift fleet');
  });

  it('records none for a self-assignment, an unassignment, or an assignment that changes nothing', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    expect((await assign(opportunity.id, TEST_ADMIN_ID)).statusCode).toBe(200);
    expect((await assign(opportunity.id, TEST_ADMIN_ID)).statusCode).toBe(200);
    expect((await assign(opportunity.id, null)).statusCode).toBe(200);
    expect(await notificationsAbout(opportunity.id)).toEqual([]);

    // The colleague takes it themselves.
    expect((await assign(opportunity.id, colleague.adminUserId, colleague.cookies)).statusCode).toBe(200);
    expect(await notificationsAbout(opportunity.id)).toEqual([]);
  });

  it('tells the default assignee of an Opportunity somebody else created', async () => {
    const organizationId = await seedCrmOrganization(h.em(), 'Notified by default');
    await assignCrmSalesRep(h.em(), organizationId, colleague.adminUserId);
    const opportunity = await createCrmOpportunity(h, { organizationId });
    const recorded = await notificationsAbout(opportunity.id);
    expect(recorded.map((row) => [row.kind, row.targetAdminUserId])).toEqual([
      ['crm.opportunity.assigned', colleague.adminUserId],
    ]);

    // …and nobody when the creator is the default assignee.
    const own = await createCrmOpportunity(h, { organizationId }, colleague.cookies);
    expect(await notificationsAbout(own.id)).toEqual([]);
  });

  it('still assigns, and records nothing, while admin_notifications is deactivated', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    await withModuleOff('admin_notifications', 'deactivated', async () => {
      const response = await assign(opportunity.id, colleague.adminUserId);
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: { assignee: { id: string } } }).data.assignee.id).toBe(
        colleague.adminUserId,
      );
    });
    expect(
      (await h.em().findOneOrFail(CrmOpportunity, { id: opportunity.id }, { filters: false })).assignedAdminUserId,
    ).toBe(colleague.adminUserId);
    expect(await notificationsAbout(opportunity.id)).toEqual([]);

    // Positive control after restoration: the same act is told again.
    expect((await assign(opportunity.id, null)).statusCode).toBe(200);
    expect((await assign(opportunity.id, colleague.adminUserId)).statusCode).toBe(200);
    expect(await notificationsAbout(opportunity.id)).toHaveLength(1);
  });

  it('still assigns while admin_notifications is platform-unavailable', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    await withModuleOff('admin_notifications', 'platform-unavailable', async () => {
      const response = await assign(opportunity.id, colleague.adminUserId);
      expect(response.statusCode, response.body).toBe(200);
    });
    expect(await notificationsAbout(opportunity.id)).toEqual([]);
  });
});
