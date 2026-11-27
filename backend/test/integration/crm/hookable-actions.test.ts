import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineModuleErrorCodes,
  OPPORTUNITY_HOOKABLE_ACTIONS as OPP,
  toHookableActionDeclaration,
  type CustomFieldValuePort,
  type OpportunityHookData,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `crm.opportunity.create` and `crm.opportunity.update` as hookable actions on
 * Postgres (`specs/193-admin-form-extensions/` FR-111, issue #2006). A hook
 * module (`acme_erp`, registered here as a deployment's overlay would) takes
 * part in real writes of the composed `OpportunityService`, on a Command Bus
 * whose hook registry holds its hooks:
 *
 *  - the `command_outbox` row exists only once the write has committed — not
 *    on another connection while the `beforeCommit` hook runs — and a veto
 *    leaves no row, no Opportunity change and no entry;
 *  - an edit whose custom-field bag changed underneath it between validation
 *    and the row lock is retried, and the attempt that found it stale runs no
 *    hook and leaves no row: one save, one hook call, one outbox row, one entry.
 *
 * The service is the composed one with its Command Bus swapped: built from the
 * container instance's own class and dependencies, so its entity classes are
 * the ones the ORM discovered.
 */

const HOOK_MODULE = 'acme_erp';
const ACME = defineModuleErrorCodes(['ACME_ERP_REFUSED']);

interface OpportunityServiceLike {
  create(input: Record<string, unknown>, caller?: { extensions?: Record<string, unknown> }): Promise<string>;
  update(
    id: string,
    patch: Record<string, unknown>,
    ifMatch: number | null,
    caller?: { extensions?: Record<string, unknown> },
  ): Promise<void>;
}

describe('crm hookable actions on Postgres (193 FR-111)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
  });
  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  /** Reads on a connection of their own: only what has committed. */
  const committed = () => h.orm.em.fork().getConnection();

  async function outboxRowsFor(objectId: string): Promise<Array<{ action: string; data: Record<string, unknown> }>> {
    return (await committed().execute(
      `select "action", "data" from "command_outbox" where "object_id" = ? and "hook_module" = ? order by "sequence"`,
      [objectId, HOOK_MODULE],
    )) as Array<{ action: string; data: Record<string, unknown> }>;
  }

  async function auditActionsFor(objectId: string): Promise<string[]> {
    const rows = (await committed().execute(
      `select "action" from "audit_log_entries" where "object_id" = ? order by "acted_at"`,
      [objectId],
    )) as Array<{ action: string }>;
    return rows.map((row) => row.action);
  }

  /**
   * The composed service on a bus with `acme_erp`'s hooks. `customFields`
   * replaces the custom-field port when given.
   */
  function compose(options: { veto?: boolean; customFields?: CustomFieldValuePort } = {}) {
    const calls: Array<{ action: string; objectId: string; data: OpportunityHookData; extension: unknown; rowsMeanwhile: number }> = [];
    const before = (ref: typeof OPP.create): CommandHookEntry => ({
      id: `check-${ref.action.replace(/[._]+/g, '-')}`,
      on: ref,
      phase: 'beforeCommit',
      handler: async (ctx) => {
        const [meanwhile] = (await committed().execute(
          `select count(*)::int as n from "command_outbox" where "object_id" = ? and "hook_module" = ?`,
          [ctx.objectId, HOOK_MODULE],
        )) as Array<{ n: number }>;
        calls.push({ action: ctx.action, objectId: ctx.objectId, data: ctx.data, extension: ctx.extension, rowsMeanwhile: meanwhile!.n });
        if (options.veto) throw new CommandHookRefusal(409, ACME.ACME_ERP_REFUSED, 'The ERP refuses this write.');
      },
    });
    const after = (ref: typeof OPP.create): CommandHookEntry => ({
      id: `sync-${ref.action.replace(/[._]+/g, '-')}`,
      on: ref,
      phase: 'afterCommit',
      handler: async () => undefined,
    });
    const registry = sealedCommandHookRegistry({
      hookableActions: Object.values(OPP).map((ref) => ({ moduleId: 'crm', ...toHookableActionDeclaration(ref) })),
      moduleDependencies: { [HOOK_MODULE]: ['crm'] },
      hooks: [{ moduleId: HOOK_MODULE, entries: [before(OPP.create), before(OPP.update), after(OPP.create), after(OPP.update)] }],
    });
    const bus = new CommandBus(h.orm, new AuditLogService(() => h.orm.em.fork()), new EventBus(), { hooks: registry });
    const composed = h.container.resolve<OpportunityServiceLike & { deps: Record<string, unknown> }>('crmOpportunityService');
    const Service = composed.constructor as new (deps: Record<string, unknown>) => OpportunityServiceLike;
    const service = new Service({
      ...composed.deps,
      commandBus: bus,
      ...(options.customFields ? { customFields: options.customFields } : {}),
    });
    return { calls, service };
  }

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'crm integration test: hookable actions', fn);

  it('writes the outbox row of a create and an update only at commit', async () => {
    const { calls, service } = compose();
    const title = `S193H2 ${randomUUID()}`;
    const id = await asAdmin(() =>
      service.create(
        { title, organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', assignedAdminUserId: null },
        { extensions: { [HOOK_MODULE]: { externalId: 'E-1' } } },
      ),
    );
    await asAdmin(() => service.update(id, { expectedCloseDate: '2026-12-31' }, null));

    expect(calls.map((call) => [call.action, call.objectId, call.extension, call.rowsMeanwhile])).toEqual([
      ['crm.opportunity.create', id, { externalId: 'E-1' }, 0],
      ['crm.opportunity.update', id, undefined, 1],
    ]);
    expect(calls[0]!.data.opportunity).toMatchObject({ id, title, statusKind: 'open' });
    expect(calls[1]!.data.changedFields).toEqual(['expectedCloseDate']);
    expect(await outboxRowsFor(id)).toEqual([
      { action: 'crm.opportunity.create', data: expect.objectContaining({ opportunityId: id, organizationId: TEST_ORGANIZATION_ID }) },
      {
        action: 'crm.opportunity.update',
        data: { opportunityId: id, organizationId: TEST_ORGANIZATION_ID, changedFields: ['expectedCloseDate'], changedCustomFields: [] },
      },
    ]);
    expect(JSON.stringify(await outboxRowsFor(id))).not.toContain(title);
  });

  it('a veto leaves no outbox row, no change and no entry', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'S193H2 veto', assignedAdminUserId: null });
    const entries = await auditActionsFor(opportunity.id);
    const { calls, service } = compose({ veto: true });

    await expect(asAdmin(() => service.update(opportunity.id, { title: 'Vetoed' }, null))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACME_ERP_REFUSED',
    });
    const title = `S193H2 vetoed create ${randomUUID()}`;
    await expect(
      asAdmin(() => service.create({ title, organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', assignedAdminUserId: null })),
    ).rejects.toMatchObject({ code: 'ACME_ERP_REFUSED' });

    expect(calls).toHaveLength(2);
    expect(await outboxRowsFor(opportunity.id)).toEqual([]);
    expect(await outboxRowsFor(calls[1]!.objectId)).toEqual([]);
    expect(await auditActionsFor(opportunity.id)).toEqual(entries);
    const [row] = (await committed().execute(`select "title" from "crm_opportunities" where "id" = ?`, [opportunity.id])) as Array<{
      title: string;
    }>;
    expect(row!.title).toBe('S193H2 veto');
    const [created] = (await committed().execute(`select count(*)::int as n from "crm_opportunities" where "title" = ?`, [
      title,
    ])) as Array<{ n: number }>;
    expect(created!.n).toBe(0);
  });

  it('an edit retried after its custom-field bag went stale runs its hooks once, for the write that happened', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'S193H2 stale', assignedAdminUserId: null });
    const entries = await auditActionsFor(opportunity.id);
    let validations = 0;
    // The first validation is overtaken: another write changes the bag on its
    // own connection, and commits, before this edit's Command locks the row.
    const customFields = {
      validateAndMerge: async (_entityType: string, current: Record<string, unknown>, patch: Record<string, unknown>) => {
        validations += 1;
        if (validations === 1) {
          await committed().execute(`update "crm_opportunities" set "custom_field_values" = ?::jsonb where "id" = ?`, [
            JSON.stringify({ overtaken: 'by another write' }),
            opportunity.id,
          ]);
        }
        return { ...current, ...patch };
      },
    } as unknown as CustomFieldValuePort;
    const { calls, service } = compose({ customFields });

    await asAdmin(() =>
      service.update(opportunity.id, { customFieldValues: { tier: 'gold' } }, null, {
        extensions: { [HOOK_MODULE]: { externalId: 'E-STALE' } },
      }),
    );

    expect(validations).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      action: 'crm.opportunity.update',
      extension: { externalId: 'E-STALE' },
      data: { changedFields: [], changedCustomFields: ['tier'] },
    });
    expect(calls[0]!.data.opportunity.customFieldValues).toEqual({ overtaken: 'by another write', tier: 'gold' });
    expect(await outboxRowsFor(opportunity.id)).toEqual([
      {
        action: 'crm.opportunity.update',
        data: { opportunityId: opportunity.id, organizationId: TEST_ORGANIZATION_ID, changedFields: [], changedCustomFields: ['tier'] },
      },
    ]);
    expect(await auditActionsFor(opportunity.id)).toEqual([...entries, 'crm.opportunity.update']);
  });
});
