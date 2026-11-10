import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityHistoryResponseSchema } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  crmValueChangeOf,
  defineCrmCustomField,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #470 (D-288; `specs/conventions/audit-state.md`): an Opportunity's
 * audit entries carry names and structure, and the values its history shows
 * are in `crm_opportunity_value_changes`, written in the same Command and read
 * only under the Opportunity's own access path.
 *
 * Against the database, because each of these is a property SQL has and a
 * stand-in does not: the rollback is a transaction's, the reach is the tenant
 * filter's, and the gate is the permission resolver's.
 */
describe('crm opportunity value store (#470)', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let repOfA: { cookies: { b2b_session: string }; undo: () => void };
  let crmReaderOnly: { cookies: { b2b_session: string }; undo: () => void };
  let definitionId: string;
  const key = `cfc_${randomUUID().slice(0, 8)}_s470`;

  const history = (id: string, cookies: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}/history`, cookies });

  const edit = async (id: string, payload: Record<string, unknown>) => {
    const response = await h.app.inject({ method: 'PATCH', url: `${CRM_API}/opportunities/${id}`, cookies: CRM_ADMIN, payload });
    expect(response.statusCode, response.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'S470 A');
    organizationB = await seedCrmOrganization(h.em(), 'S470 B');
    repOfA = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read']);
    crmReaderOnly = await seedCrmAdmin(h.em(), 's470-reader', ['crm:read']);
    definitionId = (await defineCrmCustomField(h, { key, valueType: 'text' })).id;
  });

  afterAll(async () => {
    repOfA.undo();
    crmReaderOnly.undo();
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/custom-fields/definitions/${definitionId}`, cookies: CRM_ADMIN });
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('commits the store row with the audit entry, and rolls both back with the Command', async () => {
    const documentId = randomUUID();
    const service = h.container.resolve('crmOpportunityService') as {
      createForDocument(input: unknown): Promise<{ id: string } | 'already-linked'>;
    };
    const create = () =>
      enterSystemScope('test: crm value store rollback', () =>
        service.createForDocument({
          title: 'S470-ROLLBACK',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          salesChannelId: null,
          source: 'order',
          document: { kind: 'order', id: documentId },
        }),
      );
    const first = await create();
    expect(first).not.toBe('already-linked');
    // The same document again: the link is refused at commit, and the whole
    // Command — the Opportunity, its store row and its audit entry — goes.
    expect(await create()).toBe('already-linked');

    const conn = h.orm.em.getConnection();
    const audits = (await conn.execute(
      `select "object_id" as "objectId", "state_after" as "stateAfter" from "audit_log_entries"
        where "action" = 'crm.opportunity.create' and "state_after"->'linkedDocument'->>'documentId' = ?`,
      [documentId],
    )) as Array<{ objectId: string; stateAfter: Record<string, unknown> }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.objectId).toBe((first as { id: string }).id);
    const stored = (await conn.execute(
      `select "opportunity_id" as "opportunityId" from "crm_opportunity_value_changes" where "after"->>'title' = ?`,
      ['S470-ROLLBACK'],
    )) as Array<{ opportunityId: string }>;
    expect(stored).toEqual([{ opportunityId: (first as { id: string }).id }]);
    // And the one that committed is the one its entry points at.
    expect(await crmValueChangeOf(h, audits[0]!)).toMatchObject({ after: { title: 'S470-ROLLBACK' } });
  });

  it('serves the values to a reader who reaches the Organization, and 404 to one who does not — as for a missing one', async () => {
    const inReach = await createCrmOpportunity(h, { title: 'S470-A', organizationId: organizationA });
    const outOfReach = await createCrmOpportunity(h, { title: 'S470-B', organizationId: organizationB });
    await edit(inReach.id, { title: 'S470-A2', manualValue: '470470.47' });
    await edit(outOfReach.id, { title: 'S470-B2' });

    const served = await history(inReach.id, repOfA.cookies);
    expect(served.statusCode, served.body).toBe(200);
    const [update, creation] = OpportunityHistoryResponseSchema.parse(served.json()).data;
    expect(update).toMatchObject({
      action: 'crm.opportunity.update',
      before: { title: 'S470-A', manualValue: null },
      after: { title: 'S470-A2', manualValue: '470470.47' },
    });
    expect(update?.after).not.toHaveProperty('valueChangeId');
    expect(update?.after).not.toHaveProperty('changedFields');
    expect(creation).toMatchObject({ before: null, after: { title: 'S470-A', organizationId: organizationA } });

    const refused = await history(outOfReach.id, repOfA.cookies);
    const missing = await history(randomUUID(), repOfA.cookies);
    expect(refused.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // The same code and sentence; only the request id is the request's own.
    const withoutRequestId = (body: { error: Record<string, unknown> }) => {
      const { requestId: _requestId, ...rest } = body.error;
      return rest;
    };
    expect(withoutRequestId(refused.json())).toEqual(withoutRequestId(missing.json()));
    // The administrator who reaches B is served B's — the 404 was a refusal, not a broken route.
    const admin = OpportunityHistoryResponseSchema.parse((await history(outOfReach.id, CRM_ADMIN)).json()).data;
    expect(admin[0]?.after).toMatchObject({ title: 'S470-B2' });
  });

  it('serves custom-field values, and the names of changed ones, only to a custom_fields:read holder', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'S470-CF', customFieldValues: { [key]: 'S470-CF-1' } });
    await edit(opportunity.id, { customFieldValues: { [key]: 'S470-CF-2' } });

    const full = OpportunityHistoryResponseSchema.parse((await history(opportunity.id, CRM_ADMIN)).json()).data;
    expect(full[0]).toMatchObject({
      before: { customFieldValues: { [key]: 'S470-CF-1' } },
      after: { customFieldValues: { [key]: 'S470-CF-2' } },
    });

    const response = await history(opportunity.id, crmReaderOnly.cookies);
    expect(response.statusCode, response.body).toBe(200);
    const text = JSON.stringify(OpportunityHistoryResponseSchema.parse(response.json()).data);
    expect(text).not.toContain('S470-CF-1');
    expect(text).not.toContain('S470-CF-2');
    expect(text).not.toContain(key);
  });
});
