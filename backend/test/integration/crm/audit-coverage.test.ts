import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityHistoryResponseSchema, OpportunityTransitionResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  changeOrderStatusAsOperator,
  clearCrmTags,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  createCrmTag,
  linkCrmOrder,
  linkCrmQuoteRequest,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrder,
  setCrmMappings,
  submitCrmQuoteRequest,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * Every Command about an Opportunity — or about anything hanging on it — is
 * recorded against `crm_opportunity` and **that Opportunity's id**
 * (`specs/143-crm-sales-opportunities/data-model.md` § Audit actions; research
 * R-16). The change history is one read by that pair, so a Command recorded
 * under a child's id, or under another object type, would be a change the
 * history never shows.
 *
 * The sweep performs each action through the API on one Opportunity and reads
 * the audit trail back by action. `crm.opportunity.value_mode_set` of the
 * data model is not an action of its own: the mode is a field of
 * `crm.opportunity.update`.
 */
describe('crm audit coverage — every Opportunity Command is recorded against the Opportunity (US11)', () => {
  let h: BackendServerHandle;
  let colleague: { adminUserId: string; undo: () => void };
  const assetIds: string[] = [];
  const recorded: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies: CRM_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  /** Asserts `action` was recorded against the Opportunity, `times` times, and nowhere else for its children. */
  const expectRecorded = async (opportunityId: string, action: string, times = 1) => {
    const entries = await h.auditLogService.query({ action, objectId: opportunityId });
    expect(entries, action).toHaveLength(times);
    for (const entry of entries) expect(entry.objectType, action).toBe('crm_opportunity');
    recorded.push(action);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await clearCrmTags(h.em());
    colleague = await seedCrmAdmin(h.em(), 'audit-colleague', ['crm:read', 'crm:write']);
    const mapped = await setCrmMappings(h, [
      // `lost` asks a linked Order for `completed`, which an Order in `new`
      // cannot reach: the refusal that retry and dismiss act on.
      { direction: 'opportunity_to_order', opportunityStatusCode: 'lost', orderStatusCode: 'completed' },
      // An Order reaching `paid` asks the Opportunity for `won`, which `new`
      // has no edge to: the skipped change.
      { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'won' },
    ]);
    expect(mapped.statusCode, mapped.body).toBe(200);
  });

  afterAll(async () => {
    colleague.undo();
    await removeCrmAssets(h.em(), assetIds);
    await clearCrmTags(h.em());
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('create, update, assign, tags, notes, messages, attachments, links', async () => {
    const opportunity = await createCrmOpportunity(h);
    const id = opportunity.id;
    await expectRecorded(id, 'crm.opportunity.create');

    expect((await call('PATCH', `/opportunities/${id}`, { title: 'Swept', valueMode: 'computed' })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.update');

    expect((await call('POST', `/opportunities/${id}/assign`, { adminUserId: colleague.adminUserId })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.assign');

    const tag = await createCrmTag(h, `sweep-${id.slice(0, 8)}`);
    expect((await call('PUT', `/opportunities/${id}/tags`, { tagIds: [tag.id] })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.tag_set');

    const note = await call('POST', `/opportunities/${id}/comments`, { kind: 'note', body: 'First' });
    expect(note.statusCode, note.body).toBe(201);
    const noteId = (note.json() as { data: { id: string } }).data.id;
    await expectRecorded(id, 'crm.opportunity.note_add');
    expect((await call('PATCH', `/opportunities/${id}/comments/${noteId}`, { body: 'Second' })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.note_update');
    expect((await call('DELETE', `/opportunities/${id}/comments/${noteId}`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.note_delete');
    expect((await call('POST', `/opportunities/${id}/comments`, { kind: 'message', body: 'Hello' })).statusCode).toBe(201);
    await expectRecorded(id, 'crm.opportunity.message_add');

    // An Event is the Opportunity's plan: its three Commands are recorded
    // against the Opportunity, never under the Event's own id (User Story 21).
    const planned = await call('POST', `/opportunities/${id}/events`, {
      name: 'Call',
      allDay: false,
      startsAt: '2031-06-10T08:00:00.000Z',
      endsAt: '2031-06-10T09:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    });
    expect(planned.statusCode, planned.body).toBe(201);
    const eventId = (planned.json() as { data: { id: string } }).data.id;
    await expectRecorded(id, 'crm.opportunity.event_add');
    expect((await call('PATCH', `/opportunities/${id}/events/${eventId}`, { name: 'Call back' })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.event_update');
    expect((await call('DELETE', `/opportunities/${id}/events/${eventId}`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.event_remove');
    expect(await h.auditLogService.query({ objectId: eventId })).toEqual([]);

    const asset = await seedCrmAsset(h.em());
    assetIds.push(asset.id);
    const attached = await call('POST', `/opportunities/${id}/attachments`, { assetId: asset.id });
    expect(attached.statusCode, attached.body).toBe(201);
    await expectRecorded(id, 'crm.opportunity.attachment_add');
    const attachmentId = (attached.json() as { data: { id: string } }).data.id;
    expect((await call('DELETE', `/opportunities/${id}/attachments/${attachmentId}`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.attachment_remove');

    const order = await seedCrmOrder(h.em());
    const linked = await linkCrmOrder(h, id, order.id);
    expect(linked.statusCode, linked.body).toBe(201);
    const linkId = (linked.json() as { data: { id: string } }).data.id;
    const rfq = await submitCrmQuoteRequest(h);
    expect((await linkCrmQuoteRequest(h, id, rfq.id)).statusCode).toBe(201);
    await expectRecorded(id, 'crm.opportunity.link_add', 2);
    expect((await call('PATCH', `/opportunities/${id}/links/${linkId}`, { syncStatus: false })).statusCode).toBe(200);
    await expectRecorded(id, 'crm.opportunity.link_sync_set');
    expect((await call('DELETE', `/opportunities/${id}/links/${linkId}`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.link_remove');

    // The history endpoint shows exactly these, and nothing recorded elsewhere.
    const history = await call('GET', `/opportunities/${id}/history?limit=200`);
    const shown = OpportunityHistoryResponseSchema.parse(history.json()).data.map((entry) => entry.action);
    const all = await h.auditLogService.query({ objectType: 'crm_opportunity', objectId: id, limit: 500 });
    expect(shown).toEqual(all.map((entry) => entry.action));
    // Derived writes leave no entry: recalculating the value is not a change
    // anybody made.
    expect(shown).not.toContain('crm.opportunity.value_recalculate');
    // Nor does the reminder sweep's bookkeeping: a delivery is not a change to
    // an Opportunity.
    expect(shown.filter((action) => action.startsWith('crm.event_reminder.'))).toEqual([]);
  });

  it('transition, the Order that did not follow, retry, dismiss, and the Order-caused change that was skipped', async () => {
    // `paid` asks for `won`; `new` has no edge to it — recorded as skipped.
    const skipping = await createCrmOpportunity(h);
    const paidOrder = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, skipping.id, paidOrder.id)).statusCode).toBe(201);
    await changeOrderStatusAsOperator(h, paidOrder.id, 'paid');
    await expectRecorded(skipping.id, 'crm.opportunity.propagation_skip');

    const opportunity = await createCrmOpportunity(h);
    const id = opportunity.id;
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, id, order.id)).statusCode).toBe(201);

    const moved = await transitionCrmOpportunity(h, id, 'lost');
    expect(moved.statusCode, moved.body).toBe(200);
    await expectRecorded(id, 'crm.opportunity.transition');
    const [refusal] = OpportunityTransitionResponseSchema.parse(moved.json()).data.propagation;
    expect(refusal, moved.body).toBeDefined();
    expect(refusal?.outcome).not.toBe('applied');

    const retried = await call('POST', `/opportunities/${id}/propagations/${refusal?.id}/retry`);
    expect(retried.statusCode, retried.body).toBe(200);
    await expectRecorded(id, 'crm.opportunity.propagation_retry');
    const retriedId = (retried.json() as { data: { id: string } }).data.id;
    expect((await call('POST', `/opportunities/${id}/propagations/${retriedId}/dismiss`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.propagation_dismiss');

    expect((await call('DELETE', `/opportunities/${id}`)).statusCode).toBe(204);
    await expectRecorded(id, 'crm.opportunity.delete');
  });

  it('covered every audited Opportunity action the module declares a label for', async () => {
    // The two halves of one claim: the list above is the module's own list of
    // audited Opportunity actions, read from the bundle the Admin UI labels a
    // history entry with.
    const bundle = (await import('../../../../packages/modules/crm/i18n/en.json', { with: { type: 'json' } }))
      .default as Record<string, string>;
    const labelled = Object.keys(bundle)
      .filter((key) => key.startsWith('auditLog.crm.opportunity.'))
      .map((key) => key.slice('auditLog.'.length))
      .sort();
    expect([...new Set(recorded)].sort()).toEqual(labelled);
  });
});
