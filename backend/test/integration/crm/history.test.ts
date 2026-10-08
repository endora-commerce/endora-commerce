import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityHistoryResponseSchema, type OpportunityHistoryEntry } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  changeOrderStatusAsOperator,
  clearCrmTags,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  createCrmTag,
  linkCrmOrder,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * User Story 11 — the change history of an Opportunity, read from the audit
 * trail (`specs/143-crm-sales-opportunities/spec.md`; research R-16).
 */
describe('crm opportunity history (US11)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const assetIds: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const history = async (id: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await call('GET', `/opportunities/${id}/history`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityHistoryResponseSchema.parse(response.json()).data;
  };

  const only = (entries: OpportunityHistoryEntry[], action: string) => {
    const matching = entries.filter((entry) => entry.action === action);
    expect(matching, `${action} in ${entries.map((entry) => entry.action).join(', ')}`).toHaveLength(1);
    return matching[0] as OpportunityHistoryEntry;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await clearCrmTags(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'History other');
    colleague = await seedCrmAdmin(h.em(), 'history-colleague', ['crm:read', 'crm:write', 'orders:read']);
    // Reads Opportunities; holds nothing that opens the platform's audit log.
    reader = await seedCrmAdmin(h.em(), 'history-reader', ['crm:read', 'orders:read']);
  });

  afterAll(async () => {
    colleague.undo();
    reader.undo();
    await removeCrmAssets(h.em(), assetIds);
    await clearCrmTags(h.em());
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('lists one entry per change, newest first, with who, what, and the state before and after', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'Before' });
    const id = opportunity.id;

    // An edit, a transition, a link, a note, a tag change, an assignment, an attachment.
    expect((await call('PATCH', `/opportunities/${id}`, { title: 'After' })).statusCode).toBe(200);
    expect((await transitionCrmOpportunity(h, id, 'qualified', CRM_ADMIN, 'Budget confirmed')).statusCode).toBe(200);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, id, order.id)).statusCode).toBe(201);
    const note = await call('POST', `/opportunities/${id}/comments`, { kind: 'note', body: 'Call back on Friday' });
    expect(note.statusCode, note.body).toBe(201);
    const tag = await createCrmTag(h, `history-${id.slice(0, 8)}`);
    expect((await call('PUT', `/opportunities/${id}/tags`, { tagIds: [tag.id] })).statusCode).toBe(200);
    expect((await call('POST', `/opportunities/${id}/assign`, { adminUserId: colleague.adminUserId })).statusCode).toBe(200);
    const asset = await seedCrmAsset(h.em());
    assetIds.push(asset.id);
    expect((await call('POST', `/opportunities/${id}/attachments`, { assetId: asset.id })).statusCode).toBe(201);

    const entries = await history(id);
    expect(entries.map((entry) => entry.action)).toEqual([
      'crm.opportunity.attachment_add',
      'crm.opportunity.assign',
      'crm.opportunity.tag_set',
      'crm.opportunity.note_add',
      'crm.opportunity.link_add',
      'crm.opportunity.transition',
      'crm.opportunity.update',
      'crm.opportunity.create',
    ]);
    // Newest first, by the entries' own clock.
    const times = entries.map((entry) => Date.parse(entry.actedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // Every one of them was made by a named administrator.
    for (const entry of entries) {
      expect(entry.actor.kind, entry.action).toBe('admin');
      expect(entry.actor.id, entry.action).toEqual(expect.any(String));
      expect(entry.actor.name, entry.action).toEqual(expect.stringMatching(/\S/));
    }

    expect(only(entries, 'crm.opportunity.update')).toMatchObject({
      before: { title: 'Before' },
      after: { title: 'After' },
    });
    expect(only(entries, 'crm.opportunity.transition')).toMatchObject({
      before: { status: 'new' },
      after: { status: 'qualified', cause: 'manual', reason: 'Budget confirmed' },
    });
    expect(only(entries, 'crm.opportunity.link_add')).toMatchObject({
      before: null,
      after: { documentKind: 'order', documentId: order.id },
    });
    expect(only(entries, 'crm.opportunity.tag_set')).toMatchObject({
      before: { tags: [] },
      after: { tags: [tag.name] },
    });
    expect(only(entries, 'crm.opportunity.assign').after).toMatchObject({
      assignedAdminUserId: colleague.adminUserId,
    });
  });

  it('names the actor of each entry — two people, two names', async () => {
    const opportunity = await createCrmOpportunity(h);
    const edited = await call('PATCH', `/opportunities/${opportunity.id}`, { title: 'By a colleague' }, colleague.cookies);
    expect(edited.statusCode, edited.body).toBe(200);

    const entries = await history(opportunity.id);
    const byColleague = only(entries, 'crm.opportunity.update');
    const byAdmin = only(entries, 'crm.opportunity.create');
    expect(byColleague.actor).toMatchObject({ kind: 'admin', id: colleague.adminUserId });
    expect(byColleague.actor.name).toContain('Crm');
    expect(byAdmin.actor.id).not.toBe(colleague.adminUserId);
  });

  it('a transition caused by an Order is the system’s, and says which Order caused it', async () => {
    const mapped = await setCrmMappings(h, [
      { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
    ]);
    expect(mapped.statusCode, mapped.body).toBe(200);
    try {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      await changeOrderStatusAsOperator(h, order.id, 'paid');

      const transition = only(await history(opportunity.id), 'crm.opportunity.transition');
      expect(transition.actor).toEqual({ kind: 'system', id: null, name: null });
      expect(transition).toMatchObject({
        before: { status: 'new' },
        after: { status: 'qualified', cause: 'order_status', causeOrderId: order.id },
      });
    } finally {
      await restoreDefaultCrmWorkflow(h.em());
    }
  });

  it('is open to a holder of crm:read who cannot open the platform’s audit log', async () => {
    const opportunity = await createCrmOpportunity(h);
    // The control: this reader really is refused by the audit log itself.
    const auditLog = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${opportunity.id}`,
      cookies: reader.cookies,
    });
    expect(auditLog.statusCode, auditLog.body).toBe(403);

    const entries = await history(opportunity.id, reader.cookies);
    expect(entries.map((entry) => entry.action)).toEqual(['crm.opportunity.create']);
  });

  it('answers 404 for an Opportunity outside the caller’s Organizations, whatever its history holds', async () => {
    const foreign = await createCrmOpportunity(h, { organizationId: otherOrganizationId, title: 'Not theirs' });
    const rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'orders:read']);
    try {
      const refused = await call('GET', `/opportunities/${foreign.id}/history`, undefined, rep.cookies);
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect(refused.body).not.toContain('Not theirs');
      // The control: the same person reads the history of one they do reach.
      const own = await createCrmOpportunity(h);
      expect((await history(own.id, rep.cookies)).length).toBe(1);
    } finally {
      rep.undo();
    }
  });

  it('never shows an entry about another object', async () => {
    const first = await createCrmOpportunity(h, { title: 'First' });
    const second = await createCrmOpportunity(h, { title: 'Second' });
    expect((await transitionCrmOpportunity(h, second.id, 'qualified')).statusCode).toBe(200);
    // Configuration changes and tag-list changes are audited under other
    // object types, and are no Opportunity's history.
    await createCrmTag(h, `unrelated-${first.id.slice(0, 8)}`);

    const entries = await history(first.id);
    expect(entries.map((entry) => entry.action)).toEqual(['crm.opportunity.create']);
    expect(JSON.stringify(entries)).not.toContain('Second');
    const all = await h.auditLogService.query({ objectType: 'crm_opportunity', objectId: first.id });
    expect(entries.map((entry) => entry.id)).toEqual(all.map((entry) => entry.id));
  });
});
