import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OpportunityCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { CrmOpportunity, CrmOpportunityStatusHistory } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createCrmTag,
  defineCrmCustomField,
  removeCrmCustomFields,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
} from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/186-aggregate-ports/` T089 (issue #1827, US9) — a CRM connector
 * running as a worker maintains an Opportunity through `opportunityCommandPort`
 * with no administrator anywhere: every call runs under `withSystemScope`, so
 * each entry records the `system` actor (no administrator id) and the
 * connector names itself through `source` (D-293.6).
 *
 * The worker creates an Opportunity, edits it, sets a custom field, assigns
 * it, tags it, links an Order and unlinks it, moves it to a won status and
 * finally deletes it. A note needs an author, so it is written acting for an
 * administrator (R-21.3). Then the refusals that must write nothing: an
 * extension key and a malformed `source`.
 */

const SOURCE = 'crm.connector';

describe('opportunityCommandPort from a worker (186 T089)', () => {
  let h: BackendServerHandle;
  let port: OpportunityCommandPort;
  let rep: { adminUserId: string; undo: () => void };
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: CRM connector sync', fn);

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'crm_opportunity', objectId }, { orderBy: { actedAt: 'asc' } });
  const reread = (id: string) => h.em().fork().findOneOrFail(CrmOpportunity, { id }, { filters: false });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    port = h.container.resolve<OpportunityCommandPort>('opportunityCommandPort');
    rep = await seedCrmAdmin(h.em(), 'worker-rep', ['crm:read', 'crm:write']);
    await defineCrmCustomField(h, { key: 'erp_deal_id', valueType: 'text' });
  });

  afterAll(async () => {
    rep.undo();
    await removeCrmCustomFields(h);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('runs the whole lifecycle with the system actor, recording its source', async () => {
    const options = { source: SOURCE };
    const tag = await createCrmTag(h, `Worker ${Date.now()}`);
    const order = await seedCrmOrder(h.em().fork());

    const created = await asWorker(() =>
      port.create({ title: 'ERP deal', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', assignedAdminUserId: null }, options),
    );
    expect(created).toMatchObject({ statusCode: 'new', assignedAdminUserId: null, customFieldValues: {} });
    await asWorker(() => port.update(created.id, { title: 'ERP deal, revised', manualValue: '1000.00' }, options));
    const withField = await asWorker(() =>
      port.setCustomFieldValues(created.id, async (current) => ({ ...current, erp_deal_id: 'D-42' }), options),
    );
    expect(withField.customFieldValues).toEqual({ erp_deal_id: 'D-42' });
    await asWorker(() => port.assign(created.id, { adminUserId: rep.adminUserId }, options));
    await asWorker(() => port.setTags(created.id, { tagIds: [tag.id] }, options));
    const link = await asWorker(() => port.link(created.id, { documentKind: 'order', documentId: order.id }, options));
    await asWorker(() => port.unlink(created.id, link.id, options));
    for (const to of ['qualified', 'proposal', 'won']) {
      expect(await asWorker(() => port.transition(created.id, { to }, options))).toMatchObject({ applied: true, to });
    }

    const stored = await reread(created.id);
    expect(stored).toMatchObject({
      title: 'ERP deal, revised',
      assignedAdminUserId: rep.adminUserId,
      statusCode: 'won',
      closedKind: 'won',
    });
    expect(stored.createdByAdminUserId ?? null).toBeNull();
    // The status history names no administrator either.
    const history = await h.em().fork().find(CrmOpportunityStatusHistory, { opportunityId: created.id });
    expect(history.every((row) => (row.actorAdminUserId ?? null) === null)).toBe(true);

    const written = await entries(created.id);
    expect(written.map((e) => e.action)).toEqual([
      'crm.opportunity.create',
      'crm.opportunity.update',
      'crm.opportunity.update',
      'crm.opportunity.assign',
      'crm.opportunity.tag_set',
      'crm.opportunity.link_add',
      'crm.opportunity.link_remove',
      'crm.opportunity.transition',
      'crm.opportunity.transition',
      'crm.opportunity.transition',
    ]);
    for (const entry of written) {
      expect(entry.actorAdminUserId ?? null, entry.action).toBeNull();
      expect(entry.stateAfter ?? {}, entry.action).toMatchObject({ source: SOURCE });
    }
    // A transition with no administrator records the system cause (R-21.2).
    expect(written.at(-1)?.stateAfter).toMatchObject({ status: 'won', cause: 'system' });

    // A note has an author: written acting for one.
    await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: CRM connector note', () =>
      port.addComment(created.id, { kind: 'note', body: 'Synced from the ERP.' }, options),
    );
    expect((await entries(created.id)).at(-1)).toMatchObject({
      action: 'crm.opportunity.note_add',
      actorAdminUserId: TEST_ADMIN_ID,
      stateAfter: expect.objectContaining({ source: SOURCE }),
    });

    await asWorker(() => port.delete(created.id, options));
    expect(await h.em().fork().findOne(CrmOpportunity, { id: created.id }, { filters: false })).toBeNull();
    const deleted = (await entries(created.id)).at(-1);
    expect(deleted?.action).toBe('crm.opportunity.delete');
    expect(deleted?.actorAdminUserId ?? null).toBeNull();
  });

  it('refuses an extension key and a malformed source before anything is written', async () => {
    const created = await asWorker(() =>
      port.create({ title: 'Refusals', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', assignedAdminUserId: null }),
    );
    const recorded = (await entries(created.id)).length;
    expect(
      await refusal(asWorker(() => port.transition(created.id, { to: 'qualified' }, { extensions: { nobody_claims_this: {} } }))),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(await refusal(asWorker(() => port.update(created.id, { title: 'Never' }, { source: 'CRM Sync!' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await reread(created.id)).toMatchObject({ statusCode: 'new', title: 'Refusals' });
    expect(await entries(created.id)).toHaveLength(recorded);
  });
});
