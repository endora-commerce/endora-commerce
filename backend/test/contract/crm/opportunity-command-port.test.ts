import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  OpportunityTransitionVetoError,
  type OpportunityCommandPort,
  type OpportunityReadPort,
  type OpportunityTransitionGuardRegistryPort,
  type OpportunityTransitionPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { AdminNotification, CrmOpportunity } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  createCrmTag,
  defineCrmCustomField,
  removeCrmCustomFields,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
} from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';

/**
 * `specs/186-aggregate-ports/` T088 (issue #1827, US9) —
 * `opportunityCommandPort` runs the Command the admin route for the same
 * operation runs. Each case performs the operation twice, once through the
 * route and once through the port under the same administrator, on two
 * Opportunities in the same state, and holds what each wrote to the other
 * (`expectPortParity`): the audit entries, the command hooks fired (none: no
 * `crm` action is hookable), the outbox rows, and a side-effect probe where the
 * route has one — the assignee's notice.
 *
 * `setCustomFieldValues` has no route of its own: it is measured against the
 * route's `PATCH` carrying `customFieldValues` alone, the `crm.opportunity.update`
 * the method runs (contract § *Inventory*).
 *
 * Then the port's own additions: `source` recorded beside the actor, a
 * malformed `source` and an extension key refused before anything is read —
 * a transition's guards included — `expectedVersion` honoured by `update`, a
 * guard's veto answered as an outcome, the deprecated
 * `opportunityTransitionPort` delegating, and the owner switched off.
 */

const OPPORTUNITIES = `${CRM_API}/opportunities`;

describe('opportunityCommandPort — the admin routes’ Commands (#1827)', () => {
  let h: BackendServerHandle;
  let port: OpportunityCommandPort;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Guards registered by a case: the registry has no removal, so each matches only its own Opportunity. */
  const vetoed = new Set<string>();
  let guardRuns = 0;

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: opportunity command port', fn);

  async function route(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: CRM_ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  function observe<T>(
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'crm_opportunity', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  const fresh = (body: Record<string, unknown> = {}) =>
    createCrmOpportunity(h, { title: 'Port parity', assignedAdminUserId: null, ...body });

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'crm_opportunity', objectId }, { orderBy: { actedAt: 'asc' } });
  const reread = (id: string) => h.em().fork().findOneOrFail(CrmOpportunity, { id }, { filters: false });
  const notices = async (opportunityId: string) =>
    (await h.em().fork().find(AdminNotification, { subjectId: opportunityId }, { filters: false })).map(
      (notice) => `${notice.kind}:${notice.targetAdminUserId}`,
    );

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
    colleague = await seedCrmAdmin(h.em(), 'port-colleague', ['crm:read', 'crm:write']);
    h.container.resolve<OpportunityTransitionGuardRegistryPort>('opportunityTransitionGuardRegistry').register({
      ownerModuleId: 'crm',
      match: {},
      guard: (event) => {
        guardRuns += 1;
        if (vetoed.has(event.opportunityId)) {
          throw new OpportunityTransitionVetoError('Not before the budget is known.', event.from, event.to);
        }
      },
    });
    await defineCrmCustomField(h, { key: 'port_parity_note', valueType: 'text' });
  });

  afterAll(async () => {
    colleague.undo();
    await removeCrmCustomFields(h);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('create — crm.opportunity.create, as the admin create', async () => {
    const body = () => ({ title: 'Created', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', assignedAdminUserId: null });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          (res) => res!.data['id'] as string,
          () => route('POST', OPPORTUNITIES, body(), 201),
        ),
      viaPort: () => observe((record) => record.id, () => asAdmin(() => port.create(body()))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['crm.opportunity.create']);
  });

  it('create answers the record, its custom-field values included (R-8)', async () => {
    const record = await asAdmin(() =>
      port.create({
        title: 'Record',
        organizationId: TEST_ORGANIZATION_ID,
        currency: 'PLN',
        customFieldValues: { port_parity_note: 'kept' },
      }),
    );
    expect(record).toMatchObject({
      title: 'Record',
      organizationId: TEST_ORGANIZATION_ID,
      statusCode: 'new',
      statusKind: 'open',
      customFieldValues: { port_parity_note: 'kept' },
    });
    // The read port carries the same bag (T090).
    const read = h.container.resolve<OpportunityReadPort>('opportunityReadPort');
    expect(await asAdmin(() => read.findById(record.id))).toMatchObject({
      id: record.id,
      customFieldValues: { port_parity_note: 'kept' },
    });
  });

  it('update — crm.opportunity.update, the route’s PATCH', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `${OPPORTUNITIES}/${a.id}`, { title: 'Renamed', manualValue: '12.50' })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.update(b.id, { title: 'Renamed', manualValue: '12.50' }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['crm.opportunity.update']);
    expect((await reread(b.id)).title).toBe('Renamed');
  });

  it('setCustomFieldValues — crm.opportunity.update values only, as the route’s PATCH of customFieldValues', async () => {
    const [a, b] = [await fresh(), await fresh()];
    let seen: Record<string, unknown> | null = null;
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('PATCH', `${OPPORTUNITIES}/${a.id}`, { customFieldValues: { port_parity_note: 'set' } })),
      viaPort: () =>
        observe(b.id, () =>
          asAdmin(() =>
            port.setCustomFieldValues(b.id, async (current) => {
              seen = current;
              return { ...current, port_parity_note: 'set' };
            }),
          ),
        ),
    });
    expect(seen).toEqual({});
    expect(viaPort.audit.map((e) => e.action)).toEqual(['crm.opportunity.update']);
    expect((await reread(b.id)).customFieldValues).toEqual({ port_parity_note: 'set' });

    // A refusal thrown by the merge propagates unchanged and writes nothing.
    const recorded = (await entries(b.id)).length;
    const refused = new Error('the caller refused');
    await expect(asAdmin(() => port.setCustomFieldValues(b.id, async () => Promise.reject(refused)))).rejects.toBe(refused);
    expect(await entries(b.id)).toHaveLength(recorded);
  });

  it('assign — crm.opportunity.assign, and the assignee told once', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('POST', `${OPPORTUNITIES}/${a.id}/assign`, { adminUserId: colleague.adminUserId }), () =>
          notices(a.id),
        ),
      viaPort: () =>
        observe(b.id, () => asAdmin(() => port.assign(b.id, { adminUserId: colleague.adminUserId })), () => notices(b.id)),
    });
    expect(viaPort.sideEffects).toEqual([`crm.opportunity.assigned:${colleague.adminUserId}`]);
    // The same assignee again: nothing recorded.
    const repeat = await observe(b.id, () => asAdmin(() => port.assign(b.id, { adminUserId: colleague.adminUserId })));
    expect(repeat.audit).toEqual([]);
  });

  it('transition — crm.opportunity.transition, answered as an outcome', async () => {
    const [a, b] = [await fresh(), await fresh()];
    let outcome: unknown;
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `${OPPORTUNITIES}/${a.id}/transition`, { to: 'qualified', reason: 'Budget known' })),
      viaPort: () =>
        observe(b.id, async () => {
          outcome = await asAdmin(() => port.transition(b.id, { to: 'qualified', reason: 'Budget known' }));
        }),
    });
    expect(outcome).toEqual({ applied: true, from: 'new', to: 'qualified' });
    expect((await reread(b.id)).statusCode).toBe('qualified');
  });

  it('transition — a guard’s veto, a missing edge and an unknown status are outcomes, with nothing written', async () => {
    const opportunity = await fresh();
    const recorded = (await entries(opportunity.id)).length;
    vetoed.add(opportunity.id);
    try {
      // The route answers the veto as an HTTP error …
      await route('POST', `${OPPORTUNITIES}/${opportunity.id}/transition`, { to: 'qualified' }, 409);
      // … the port as a value.
      expect(await asAdmin(() => port.transition(opportunity.id, { to: 'qualified' }))).toEqual({
        applied: false,
        reason: 'vetoed',
        from: 'new',
        detail: 'Not before the budget is known.',
      });
    } finally {
      vetoed.delete(opportunity.id);
    }
    expect(await asAdmin(() => port.transition(opportunity.id, { to: 'won' }))).toMatchObject({
      applied: false,
      reason: 'not_permitted',
      from: 'new',
    });
    expect(await asAdmin(() => port.transition(opportunity.id, { to: 'no_such_status' }))).toMatchObject({
      applied: false,
      reason: 'unknown_status',
      from: 'new',
    });
    expect(await asAdmin(() => port.transition(opportunity.id, { to: 'new' }))).toEqual({
      applied: false,
      reason: 'already_there',
      from: 'new',
    });
    expect(await asAdmin(() => port.transition(randomUUID(), { to: 'qualified' }))).toMatchObject({
      applied: false,
      reason: 'not_found',
      from: null,
    });
    expect((await reread(opportunity.id)).statusCode).toBe('new');
    expect(await entries(opportunity.id)).toHaveLength(recorded);
  });

  it('setTags — crm.opportunity.tag_set; the same set again records nothing', async () => {
    const tag = await createCrmTag(h, `Port ${randomUUID().slice(0, 8)}`);
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `${OPPORTUNITIES}/${a.id}/tags`, { tagIds: [tag.id] })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setTags(b.id, { tagIds: [tag.id] }))),
    });
    const repeat = await observe(b.id, () => asAdmin(() => port.setTags(b.id, { tagIds: [tag.id] })));
    expect(repeat.audit).toEqual([]);
  });

  it('link and unlink — crm.opportunity.link_add / link_remove', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const [orderA, orderB] = [await seedCrmOrder(h.em().fork()), await seedCrmOrder(h.em().fork())];
    let linkA = '';
    let linkB = '';
    await expectPortParity({
      viaRoute: () =>
        observe(a.id, async () => {
          const res = await route('POST', `${OPPORTUNITIES}/${a.id}/links`, { documentKind: 'order', documentId: orderA.id }, 201);
          linkA = res!.data['id'] as string;
        }),
      viaPort: () =>
        observe(b.id, async () => {
          const link = await asAdmin(() => port.link(b.id, { documentKind: 'order', documentId: orderB.id }));
          expect(link).toMatchObject({ documentKind: 'order', documentId: orderB.id, linkSource: 'manual', available: true });
          linkB = link.id;
        }),
    });
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `${OPPORTUNITIES}/${a.id}/links/${linkA}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.unlink(b.id, linkB))),
    });
    // The route’s answer for a link that is not there.
    expect(await refusal(asAdmin(() => port.unlink(b.id, linkB)))).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  });

  it('addComment — crm.opportunity.note_add, and a message is message_add', async () => {
    const [a, b] = [await fresh(), await fresh()];
    for (const kind of ['note', 'message'] as const) {
      const { port: viaPort } = await expectPortParity({
        viaRoute: () => observe(a.id, () => route('POST', `${OPPORTUNITIES}/${a.id}/comments`, { kind, body: 'Called the buyer.' }, 201)),
        viaPort: () =>
          observe(b.id, async () => {
            const comment = await asAdmin(() => port.addComment(b.id, { kind, body: 'Called the buyer.' }));
            expect(comment).toMatchObject({ kind, body: 'Called the buyer.', author: { id: TEST_ADMIN_ID } });
          }),
      });
      expect(viaPort.audit.map((e) => e.action)).toEqual([`crm.opportunity.${kind}_add`]);
    }
  });

  it('delete — crm.opportunity.delete', async () => {
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `${OPPORTUNITIES}/${a.id}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.delete(b.id))),
    });
    expect(await h.em().fork().findOne(CrmOpportunity, { id: b.id }, { filters: false })).toBeNull();
  });

  describe('the port’s own options and refusals', () => {
    it('records source beside the actor', async () => {
      const opportunity = await fresh();
      await asAdmin(() => port.update(opportunity.id, { title: 'From the ERP' }, { source: 'erp.sync' }));
      expect((await entries(opportunity.id)).at(-1)).toMatchObject({
        action: 'crm.opportunity.update',
        actorAdminUserId: TEST_ADMIN_ID,
        stateAfter: expect.objectContaining({ source: 'erp.sync' }),
      });
    });

    it('refuses a malformed source and any extension key before anything is read — guards included', async () => {
      const opportunity = await fresh();
      const recorded = (await entries(opportunity.id)).length;
      const runs = guardRuns;
      expect(await refusal(asAdmin(() => port.transition(opportunity.id, { to: 'qualified' }, { source: 'Not A Code' })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(
        await refusal(asAdmin(() => port.transition(opportunity.id, { to: 'qualified' }, { extensions: { nobody_claims_this: {} } }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
      for (const write of <Array<() => Promise<unknown>>>[
        () => port.update(opportunity.id, { title: 'Never' }, { extensions: { nobody: {} } }),
        () => port.assign(opportunity.id, { adminUserId: null }, { source: ' ' }),
        () => port.create({ title: 'Never', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN' }, { source: 'ERP!' }),
      ]) {
        expect((await refusal(asAdmin(write))).statusCode).toBe(422);
      }
      expect(guardRuns).toBe(runs);
      expect((await reread(opportunity.id)).statusCode).toBe('new');
      expect((await reread(opportunity.id)).title).toBe('Port parity');
      expect(await entries(opportunity.id)).toHaveLength(recorded);
    });

    it('honours expectedVersion on update with the route’s 409, and ignores it elsewhere', async () => {
      const opportunity = await fresh();
      const stale = opportunity.version + 5;
      expect(await refusal(asAdmin(() => port.update(opportunity.id, { title: 'Stale' }, { expectedVersion: stale })))).toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.VERSION_CONFLICT,
      });
      const updated = await asAdmin(() =>
        port.update(opportunity.id, { title: 'Current' }, { expectedVersion: opportunity.version }),
      );
      expect(updated.title).toBe('Current');
      // A method whose route has no version rule ignores the option.
      await asAdmin(() => port.assign(opportunity.id, { adminUserId: colleague.adminUserId }, { expectedVersion: stale }));
      expect((await reread(opportunity.id)).assignedAdminUserId).toBe(colleague.adminUserId);
    });

    it('validates its input with the route’s schema (422) and answers an unknown Opportunity as the route does', async () => {
      const opportunity = await fresh();
      expect(await refusal(asAdmin(() => port.update(opportunity.id, { title: '' })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(
        await refusal(asAdmin(() => port.addComment(opportunity.id, { kind: 'note', body: '' }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
      const unknown = randomUUID();
      for (const write of <Array<() => Promise<unknown>>>[
        () => port.update(unknown, { title: 'x' }),
        () => port.assign(unknown, { adminUserId: null }),
        () => port.setTags(unknown, { tagIds: [] }),
        () => port.delete(unknown),
        () => port.setCustomFieldValues(unknown, async (current) => current),
      ]) {
        expect(await refusal(asAdmin(write))).toMatchObject({ statusCode: 404, code: ERROR_CODES.CRM_OPPORTUNITY_NOT_FOUND });
      }
    });

    it('refuses a comment with no administrator behind it, as the route does (R-21.3)', async () => {
      const opportunity = await fresh();
      expect(
        await refusal(withSystemScope('test: comment with no administrator', () => port.addComment(opportunity.id, { kind: 'note', body: 'x' }))),
      ).toMatchObject({ statusCode: 403, code: ERROR_CODES.FORBIDDEN });
    });
  });

  it('the deprecated opportunityTransitionPort delegates: the same entry as transition', async () => {
    const narrow = h.container.resolve<OpportunityTransitionPort>('opportunityTransitionPort');
    const [a, b] = [await fresh(), await fresh()];
    const outcomes: unknown[] = [];
    await expectPortParity({
      viaRoute: () =>
        observe(a.id, async () => {
          // The input actor is no longer read (R-21.2): the entry and the event name the ambient one.
          outcomes.push(await asAdmin(() => narrow.applyStatus({ opportunityId: a.id, to: 'qualified', actor: { kind: 'system' } })));
        }),
      viaPort: () =>
        observe(b.id, async () => {
          outcomes.push(await asAdmin(() => port.transition(b.id, { to: 'qualified' })));
        }),
    });
    expect(outcomes).toEqual([
      { applied: true, from: 'new', to: 'qualified' },
      { applied: true, from: 'new', to: 'qualified' },
    ]);
    const [entryA, entryB] = [(await entries(a.id)).at(-1), (await entries(b.id)).at(-1)];
    expect(entryA).toMatchObject({ actorAdminUserId: TEST_ADMIN_ID, stateAfter: { status: 'qualified', cause: 'manual' } });
    expect(entryB).toMatchObject({ actorAdminUserId: TEST_ADMIN_ID, stateAfter: { status: 'qualified', cause: 'manual' } });
  });

  it('cannot be resolved while crm is off, so nothing is written — and is back after', async () => {
    const opportunity = await fresh();
    const recorded = (await entries(opportunity.id)).length;
    await withModuleOff('crm', 'deactivated', async () => {
      const attempt = withSystemScope('test: opportunity command port off', async () =>
        h.container.resolve<OpportunityCommandPort>('opportunityCommandPort').update(opportunity.id, { title: 'Off' }),
      );
      await expect(attempt).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect((await reread(opportunity.id)).title).toBe('Port parity');
    expect(await entries(opportunity.id)).toHaveLength(recorded);

    const record = await withSystemScope('test: opportunity command port on again', () =>
      h.container.resolve<OpportunityCommandPort>('opportunityCommandPort').update(opportunity.id, { title: 'On' }),
    );
    expect(record.title).toBe('On');
  });
});
