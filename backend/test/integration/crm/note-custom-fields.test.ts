import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  OpportunityCommentListResponseSchema,
  OpportunityCommentResponseSchema,
  type OpportunityCommandPort,
  type OpportunityReadPort,
} from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { CRM_ADMIN, CRM_API, createCrmOpportunity, restoreDefaultCrmWorkflow } from '../../helpers/seed-crm.js';

/**
 * Issue #2005 — a note on an Opportunity is a custom-field host,
 * `opportunity_note` (`specs/conventions/custom-field-writes.md`).
 *
 * The values are written with the note, validated with the administrator's
 * rules, by the note's own Command (`crm.opportunity.note_add` /
 * `.note_update`), whose audit state names the changed keys and never a value.
 * A message is not a host: a non-empty bag on one is refused. The admin list
 * and `opportunityReadPort.listNotes` answer the values; while `crm` is off the
 * type is not offered at all.
 */
describe('crm — custom fields on notes (issue #2005)', () => {
  let h: BackendServerHandle;
  const DEFINITIONS = '/api/v1/admin/custom-fields/definitions';
  const suffix = randomUUID().slice(0, 6);
  const TYPE = `note_type_${suffix}`;
  const REMARK = `note_remark_${suffix}`;
  const definitions: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url: `${CRM_API}${path}`, cookies: CRM_ADMIN, ...(payload ? { payload } : {}) });

  async function define(payload: Record<string, unknown>): Promise<void> {
    const response = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS,
      cookies: CRM_ADMIN,
      payload: { entityType: 'opportunity_note', label: {}, required: false, sortOrder: 0, config: {}, options: [], ...payload },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitions.push((response.json() as { data: { id: string } }).data.id);
  }

  const audit = (opportunityId: string, action: string) =>
    h.auditLogService.query({ action, objectId: opportunityId });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await define({
      key: TYPE,
      labelDefault: 'Type',
      valueType: 'select',
      options: ['call', 'meeting'].map((value, index) => ({
        value,
        label: {},
        labelDefault: value,
        isDefault: false,
        sortOrder: index,
      })),
    });
    await define({ key: REMARK, labelDefault: 'Remark', valueType: 'text' });
  });

  afterAll(async () => {
    for (const id of definitions) await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS}/${id}`, cookies: CRM_ADMIN });
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('offers opportunity_note as an entity type while crm is on, labelled from custom_fields’ bundle', async () => {
    const types = async () =>
      (
        (await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', cookies: CRM_ADMIN })).json() as {
          data: Array<{ entityType: string; labelKey: string }>;
        }
      ).data;
    expect((await types()).find((row) => row.entityType === 'opportunity_note')).toMatchObject({
      labelKey: 'customFields.entity.opportunityNote',
    });
    await withModuleOff('crm', 'deactivated', async () => {
      expect((await types()).map((row) => row.entityType)).not.toContain('opportunity_note');
    });
  });

  it('stores a note’s values with the note, answers them, and records only the keys', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    const created = await call('POST', `/opportunities/${opportunity.id}/comments`, {
      kind: 'note',
      body: 'Called the buyer.',
      customFieldValues: { [TYPE]: 'call', [REMARK]: 'S2005-CF-NOTE' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const note = OpportunityCommentResponseSchema.parse(created.json()).data;
    expect(note.customFieldValues).toEqual({ [TYPE]: 'call', [REMARK]: 'S2005-CF-NOTE' });

    const listed = OpportunityCommentListResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunity.id}/comments?kind=note`)).json(),
    ).data;
    expect(listed.find((row) => row.id === note.id)?.customFieldValues).toEqual({
      [TYPE]: 'call',
      [REMARK]: 'S2005-CF-NOTE',
    });

    const added = await audit(opportunity.id, 'crm.opportunity.note_add');
    expect(added).toHaveLength(1);
    expect(added[0]?.stateAfter).toMatchObject({ commentId: note.id, changedCustomFields: [REMARK, TYPE].sort() });
    expectNoAuditValues(added, ['S2005-CF-NOTE']);

    // An edit merges: the key it leaves out keeps its value.
    const edited = await call('PATCH', `/opportunities/${opportunity.id}/comments/${note.id}`, {
      body: 'Called the buyer.',
      customFieldValues: { [TYPE]: 'meeting' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(OpportunityCommentResponseSchema.parse(edited.json()).data.customFieldValues).toEqual({
      [TYPE]: 'meeting',
      [REMARK]: 'S2005-CF-NOTE',
    });
    const updated = await audit(opportunity.id, 'crm.opportunity.note_update');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.stateAfter).toMatchObject({ commentId: note.id, changedCustomFields: [TYPE] });
    expectNoAuditValues(updated, ['S2005-CF-NOTE']);

    // The same body and the same values change nothing and record nothing.
    const unchanged = await call('PATCH', `/opportunities/${opportunity.id}/comments/${note.id}`, {
      body: 'Called the buyer.',
      customFieldValues: { [TYPE]: 'meeting' },
    });
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    expect(await audit(opportunity.id, 'crm.opportunity.note_update')).toHaveLength(1);
  });

  it('refuses a value that breaks its definition, and writes nothing', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    const refused = await call('POST', `/opportunities/${opportunity.id}/comments`, {
      kind: 'note',
      body: 'Never stored.',
      customFieldValues: { [TYPE]: 'carrier-pigeon' },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(refused.json().error.details).toEqual([expect.objectContaining({ path: TYPE })]);
    const listed = OpportunityCommentListResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunity.id}/comments?kind=note`)).json(),
    ).data;
    expect(listed).toEqual([]);
    expect(await audit(opportunity.id, 'crm.opportunity.note_add')).toHaveLength(0);
  });

  it('refuses values on a message, and takes an empty bag', async () => {
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    const refused = await call('POST', `/opportunities/${opportunity.id}/comments`, {
      kind: 'message',
      body: 'A message has no fields.',
      customFieldValues: { [TYPE]: 'call' },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(await audit(opportunity.id, 'crm.opportunity.message_add')).toHaveLength(0);

    const accepted = await call('POST', `/opportunities/${opportunity.id}/comments`, {
      kind: 'message',
      body: 'An empty bag is no value.',
      customFieldValues: {},
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(OpportunityCommentResponseSchema.parse(accepted.json()).data.customFieldValues).toEqual({});
  });

  it('takes the values through opportunityCommandPort.addComment and answers them on listNotes', async () => {
    const since = new Date(Date.now() - 1000);
    const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
    const port = h.container.resolve<OpportunityCommandPort>('opportunityCommandPort');
    const written = await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: note with fields', () =>
      port.addComment(opportunity.id, { kind: 'note', body: 'From a connector.', customFieldValues: { [TYPE]: 'meeting' } }),
    );
    expect(written.customFieldValues).toEqual({ [TYPE]: 'meeting' });
    await expect(
      withSystemScopeActingFor(TEST_ADMIN_ID, 'test: bad note value', () =>
        port.addComment(opportunity.id, { kind: 'note', body: 'Bad.', customFieldValues: { [TYPE]: 'fax' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID });

    const read = h.container.resolve<OpportunityReadPort>('opportunityReadPort');
    const page = await runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, { allowAll: true, allowedOrganizationIds: [] }),
      () => read.listNotes({ authorAdminUserId: TEST_ADMIN_ID, createdFrom: since, limit: 100 }),
    );
    expect(page.items.find((item) => item.id === written.id)?.customFieldValues).toEqual({ [TYPE]: 'meeting' });
  });
});
