/**
 * `crm`'s two hookable actions, `crm.opportunity.create` and
 * `crm.opportunity.update` (`specs/193-admin-form-extensions/` FR-111, FR-114,
 * `contracts/hookable-writers.md` §2 and §4; issue #2006). The mechanism is
 * `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
 *
 * Every write is driven through the module's own code — `OpportunityService`,
 * which the admin routes run, and `opportunityCommandPort` over it — on a real
 * `CommandBus` with a sealed hook registry built from the manifest, so what is
 * checked is what a hook author is handed. The EntityManager is a small
 * in-memory stand-in: what is under test is what the Command hands the bus,
 * not SQL. The route-level round trip is the contract suite's
 * (`backend/test/contract/crm/opportunity-command-port.test.ts`).
 *
 * Per §4: neither Command is reversible; each supplies `hookData` and
 * list-1 `outboxData` (`expectHookableCommand`); the manifest lists both; the
 * port forwards `options.extensions`, so the bus decides who claims a key.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  OPPORTUNITY_HOOKABLE_ACTIONS as OPP,
  type HookableActionRef,
  type OutboxData,
} from '@endora-commerce/contracts';
import {
  CommandBus,
  type Command,
  type CommandHookContext,
  type CommandHookEntry,
} from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { OpportunityCommandService, type OpportunityCommandServiceDeps } from './opportunity-command-port.js';
import { OpportunityService } from './opportunity-service.js';

const ADMIN = '00000000-0000-4000-8000-000000193201';
const ORG = '00000000-0000-4000-8000-000000193202';
const CONTACT = '00000000-0000-4000-8000-000000193203';
const HOOK_MODULE = 'acme_erp';
const SENTINEL = 'S193H2-';

// ---------------------------------------------------------------------------
// An in-memory EntityManager: enough of MikroORM's surface for the two Commands.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

class FakeEm {
  readonly tables = new Map<string, Row[]>();
  #sequence = 0;

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  #matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, wanted]) => {
      if (wanted !== null && typeof wanted === 'object' && !Array.isArray(wanted)) {
        const operators = wanted as Record<string, unknown>;
        return Array.isArray(operators.$in) ? operators.$in.includes(row[key]) : true;
      }
      return row[key] === wanted;
    });
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => this.#matches(row, where)) ?? null;
  }

  async find(entity: { name: string }, where: Row = {}): Promise<Row[]> {
    return this.table(entity.name).filter((row) => this.#matches(row, where));
  }

  async count(entity: { name: string }, where: Row = {}): Promise<number> {
    // A Sales Channel is a platform record this stand-in does not hold: it exists.
    if (entity.name === 'SalesChannel') return 1;
    return (await this.find(entity, where)).length;
  }

  remove(row: object): this {
    const rows = this.table(row.constructor.name);
    const index = rows.indexOf(row as Row);
    if (index >= 0) rows.splice(index, 1);
    return this;
  }

  async nativeDelete(entity: { name: string }, where: Row): Promise<number> {
    const rows = this.table(entity.name);
    const doomed = rows.filter((row) => this.#matches(row, where));
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    return doomed.length;
  }

  async execute(sql: string): Promise<Array<{ value: number }>> {
    return sql.includes('nextval') ? [{ value: (this.#sequence += 1) }] : [];
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

function harness(hooks: ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }> = []) {
  const em = new FakeEm();
  em.create(CrmOpportunityStatus, { code: 'new', kind: 'open' } as never);
  const audits: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      audits.push(structuredClone(input));
      return input as never;
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: () => undefined };
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'crm', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['crm'] },
    hooks,
  });
  const bus = new CommandBus({ em } as never, audit as never, events as never, { hooks: registry });
  const commands: Array<{ command: Command<unknown>; result?: unknown }> = [];
  const capturingBus = {
    run: async <T>(command: Command<T>): Promise<T> => {
      const seen: { command: Command<unknown>; result?: unknown } = { command: command as Command<unknown> };
      commands.push(seen);
      const result = await bus.run(command);
      seen.result = result;
      return result;
    },
  };
  const service = new OpportunityService({
    emFactory: () => em,
    commandBus: capturingBus,
    workflowRead: { loadGraph: async () => ({ initial: () => ({ code: 'new' }) }) },
    organizations: { findById: async (id: string) => ({ id }) },
    customerAccounts: { findInOrganization: async (id: string) => ({ id }) },
    adminUsers: { findByIds: async () => [] },
    assignment: {
      resolveDefault: async () => null,
      assertAssignable: async () => undefined,
      notifyAssigned: async () => undefined,
    },
    tags: { resolve: async (_em: unknown, ids: readonly string[]) => ids.map((id) => ({ id, name: `${SENTINEL}TAG` })) },
    customFields: {
      validateAndMerge: async (_type: string, current: Record<string, unknown>, patch: Record<string, unknown>) => ({
        ...current,
        ...patch,
      }),
    },
    customFieldCarry: { plan: async () => ({ values: {}, carried: [], skipped: [] }) },
    references: { rowsFor: () => [] },
    mentions: { tell: async () => undefined },
    recalculateValue: async () => undefined,
    warn: () => undefined,
  } as never);
  const port = new OpportunityCommandService({
    emFactory: () => em,
    workflowRead: { loadGraph: async () => ({}) },
    opportunities: () => service,
    assignment: () => ({}),
    transitions: () => ({}),
    links: () => ({}),
    comments: () => ({}),
    records: { findById: async (id: string) => ({ id }) },
  } as unknown as OpportunityCommandServiceDeps);
  return { em, audits, commands, service, port, outbox: () => em.table('CommandOutboxEntry') };
}

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN, 'crm unit test: hookable actions', fn);

/** One recording `beforeCommit` hook and one no-op `afterCommit` handler on each declared action. */
function onEveryAction(then?: (ctx: CommandHookContext<unknown>) => Promise<void> | void) {
  const recording = recordingCommandHooks();
  const refs: ReadonlyArray<HookableActionRef<unknown, OutboxData>> = Object.values(OPP);
  const entries: CommandHookEntry[] = refs.flatMap((ref) => [
    recording.on(ref, then ? { then } : {}),
    { id: `deliver-${ref.action.replace(/[._]+/g, '-')}`, on: ref, phase: 'afterCommit' as const, handler: async () => undefined },
  ]);
  return { recording, hooks: [{ moduleId: HOOK_MODULE, entries }] };
}

function seed(em: FakeEm): CrmOpportunity {
  return em.create(CrmOpportunity, {
    id: randomUUID(),
    number: 'OPP-000193',
    title: `${SENTINEL}TITLE`,
    description: `${SENTINEL}DESCRIPTION`,
    organizationId: ORG,
    customerAccountId: CONTACT,
    statusCode: 'new',
    valueMode: 'manual',
    manualValue: '193.19',
    currency: 'PLN',
    customFieldValues: { risk: `${SENTINEL}CF` },
    version: 2,
  });
}

/** The one Command of `ref`'s action the code ran, held to the ref with the result the bus answered. */
function expectDeclared(h: ReturnType<typeof harness>, ref: HookableActionRef<unknown, OutboxData>): void {
  const seen = h.commands.find((candidate) => candidate.command.action === ref.action);
  expect(seen, ref.action).toBeDefined();
  expectHookableCommand(seen!.command, ref, { result: seen!.result, sentinels: [SENTINEL, '193.19'] });
}

const createBody = {
  title: `${SENTINEL}TITLE`,
  description: `${SENTINEL}DESCRIPTION`,
  organizationId: ORG,
  customerAccountId: CONTACT,
  assignedAdminUserId: null,
  manualValue: '193.19',
  currency: 'PLN',
  customFieldValues: { risk: `${SENTINEL}CF` },
};

describe('crm lists its hookable actions in its manifest (FR-114)', () => {
  it('lists the two refs, for both phases', () => {
    expect(manifest.hookableActions).toEqual(
      [OPP.create, OPP.update].map((ref) => ({
        action: ref.action,
        objectType: ref.objectType,
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });
});

describe('neither Command is reversible (176 §6; 193 §4.1)', () => {
  it('records no revert state: the undo affordance has nothing to restore', async () => {
    const h = harness();
    const id = await asAdmin(() => h.service.create(createBody as never));
    await asAdmin(() => h.service.update(id, { title: `${SENTINEL}NEW` } as never, null));
    const actions = h.audits.map((entry) => entry.action);
    expect(actions).toEqual(['crm.opportunity.create', 'crm.opportunity.update']);
    for (const entry of h.audits) {
      expect(entry.stateAfter ?? {}).not.toHaveProperty('reversible');
      expect(entry.stateAfter ?? {}).not.toHaveProperty('revertState');
    }
  });

  it('crm declares no undo Command and no revert handlers', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const sources = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => readFileSync(join(root, file), 'utf8'));
    expect(sources.length).toBeGreaterThan(10);
    for (const source of sources) {
      expect(source).not.toMatch(/\bapplyUndo\b|\bRevertHandlers\b|\brevertState\b/);
      expect(source).not.toMatch(/action:\s*'crm\.[a-z_.]+\.undo'/);
    }
  });
});

describe('a present hook runs on each declared action, handed the after-state and the changed names', () => {
  it('crm.opportunity.create — the new Opportunity and everything it was given', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);
    const id = await asAdmin(() => h.service.create(createBody as never));

    expectDeclared(h, OPP.create);
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]).toMatchObject({ action: 'crm.opportunity.create', objectId: id });
    expect(recording.calls[0]!.data).toEqual({
      opportunity: expect.objectContaining({
        id,
        number: expect.any(String),
        title: `${SENTINEL}TITLE`,
        organizationId: ORG,
        customerAccountId: CONTACT,
        salesChannelId: null,
        statusCode: 'new',
        statusKind: 'open',
        assignedAdminUserId: null,
        valueMode: 'manual',
        value: '193.19',
        currency: 'PLN',
        closedAt: null,
        customFieldValues: { risk: `${SENTINEL}CF` },
      }),
      changedFields: [
        'currency',
        'customerAccountId',
        'description',
        'manualValue',
        'organizationId',
        'statusCode',
        'title',
        'valueMode',
      ],
      changedCustomFields: ['risk'],
    });
    expect(h.outbox().map((row) => row.data)).toEqual([
      {
        opportunityId: id,
        organizationId: ORG,
        changedFields: [
          'currency',
          'customerAccountId',
          'description',
          'manualValue',
          'organizationId',
          'statusCode',
          'title',
          'valueMode',
        ],
        changedCustomFields: ['risk'],
      },
    ]);
    expect(h.outbox()[0]).toMatchObject({ action: 'crm.opportunity.create', objectId: id, organizationId: ORG });
  });

  it('crm.opportunity.update — the edited Opportunity, and only what changed', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);
    const opportunity = seed(h.em);
    await asAdmin(() =>
      h.service.update(
        opportunity.id,
        { title: `${SENTINEL}NEW`, expectedCloseDate: '2026-12-31', customFieldValues: { risk: `${SENTINEL}CF2` } } as never,
        null,
      ),
    );

    expectDeclared(h, OPP.update);
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.data).toEqual({
      opportunity: expect.objectContaining({
        id: opportunity.id,
        title: `${SENTINEL}NEW`,
        statusKind: 'open',
        customFieldValues: { risk: `${SENTINEL}CF2` },
      }),
      changedFields: ['expectedCloseDate', 'title'],
      changedCustomFields: ['risk'],
    });
    expect(h.outbox().map((row) => row.data)).toEqual([
      { opportunityId: opportunity.id, organizationId: ORG, changedFields: ['expectedCloseDate', 'title'], changedCustomFields: ['risk'] },
    ]);
  });

  it('crm.opportunity.update through setCustomFieldValues — the custom fields alone', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);
    const opportunity = seed(h.em);
    await asAdmin(() => h.service.setCustomFieldValues(opportunity.id, async (bag) => ({ ...bag, tier: 'gold' })));

    expectDeclared(h, OPP.update);
    expect(recording.calls[0]!.data).toMatchObject({ changedFields: [], changedCustomFields: ['tier'] });
  });

  it('a beforeCommit veto refuses the write with the hook’s own error, and no entry is recorded', async () => {
    const veto = new Error('acme_erp: the ERP refuses this edit');
    const { hooks } = onEveryAction(() => {
      throw veto;
    });
    const h = harness(hooks);
    const opportunity = seed(h.em);
    await expect(asAdmin(() => h.service.update(opportunity.id, { title: 'Vetoed' } as never, null))).rejects.toBe(veto);
    expect(h.audits).toEqual([]);
    expect(h.outbox()).toEqual([]);
  });

  it('a hook whose module is not composed is not there: the write runs as before, with no outbox row', async () => {
    const h = harness();
    const opportunity = seed(h.em);
    await asAdmin(() => h.service.update(opportunity.id, { title: `${SENTINEL}NEW` } as never, null));
    expect(h.audits.map((entry) => entry.action)).toEqual(['crm.opportunity.update']);
    expect(h.outbox()).toEqual([]);
  });
});

describe('opportunityCommandPort forwards options.extensions to the hookable Commands (§4.5)', () => {
  it('hands a claimed key to the claiming module’s hook, on create and on update', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);
    const created = await asAdmin(() =>
      h.port.create(createBody as never, { source: 'erp.sync', extensions: { [HOOK_MODULE]: { externalId: 'E-1' } } }),
    );
    await asAdmin(() =>
      h.port.update(created.id, { title: 'Edited' }, { extensions: { [HOOK_MODULE]: { externalId: 'E-2' } } }),
    );
    await asAdmin(() =>
      h.port.setCustomFieldValues(created.id, async (bag) => ({ ...bag, tier: 'gold' }), {
        extensions: { [HOOK_MODULE]: { externalId: 'E-3' } },
      }),
    );
    expect(recording.calls.map((call) => [call.action, call.extension])).toEqual([
      ['crm.opportunity.create', { externalId: 'E-1' }],
      ['crm.opportunity.update', { externalId: 'E-2' }],
      ['crm.opportunity.update', { externalId: 'E-3' }],
    ]);
    expect(h.audits[0]?.stateAfter).toMatchObject({ source: 'erp.sync' });
  });

  it('an unclaimed key is the bus’s 422 COMMAND_EXTENSION_UNCLAIMED, before anything is written', async () => {
    const { hooks } = onEveryAction();
    const h = harness(hooks);
    const opportunity = seed(h.em);
    const before = h.em.table('CrmOpportunity').length;

    await expect(
      asAdmin(() => h.port.create(createBody as never, { extensions: { nobody_claims_this: {} } })),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.nobody_claims_this', issue: expect.any(String) }],
    });
    await expect(
      asAdmin(() => h.port.update(opportunity.id, { title: 'Never' }, { extensions: { nobody: {} } })),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });

    // The bus refused both Commands: they reached it, and it wrote nothing.
    expect(h.commands.map((seen) => seen.command.action)).toEqual(['crm.opportunity.create', 'crm.opportunity.update']);
    expect(h.em.table('CrmOpportunity')).toHaveLength(before);
    expect(opportunity.title).toBe(`${SENTINEL}TITLE`);
    expect(h.audits).toEqual([]);
  });
});
