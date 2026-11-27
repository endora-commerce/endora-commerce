/**
 * `customer_accounts`' three hookable actions (`specs/193-admin-form-extensions/`
 * FR-110, FR-114, T002, T003; `contracts/hookable-writers.md` §1; the mechanism
 * is `specs/176-command-hooks-outbox/`, `contracts/command-hooks-api.md` §6).
 *
 * Each Command is held to its ref with `expectHookableCommand`, and each is run
 * through `customerAccountCommandPort` on a real `CommandBus` with a sealed
 * hook registry, so what is checked is what a hook author is handed: the
 * after-state record and the names of what changed in `beforeCommit`, and one
 * names-only outbox row per `afterCommit` handler (`specs/conventions/audit-state.md`
 * list 1). The port forwards the caller's `extensions`; a key no present hook
 * module claims is refused `422 COMMAND_EXTENSION_UNCLAIMED` before any write.
 *
 * And none of the three is reversible (176 R-20): a reversible Command's undo
 * restores its owner's captured state only, so a hook's co-transactional write
 * would be silently left behind. That is proved before the actions are
 * declared, per `hookable-writers.md` §4.1.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS as ACCOUNTS,
  type CustomerAccountCreateHookData,
  type CustomerAccountRecord,
  type CustomerAccountUpdateHookData,
} from '@endora-commerce/contracts';
import { CommandBus, type Command, type CommandHookEntry, type CommandOutcome } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountCommandService } from '../services/customer-account-command-port.js';
import { toCustomerAccountRecord } from '../services/customer-account-ports.js';
import { prepareCustomerAccountCreate } from './customer-account-create.command.js';
import { makeSetCustomerCustomFieldValuesCommand } from './customer-account-lifecycle.commands.js';
import { makeUpdateCustomerAccountProfileCommand } from './customer-account-profile.commands.js';

const ADMIN = '00000000-0000-4000-8000-000001930a01';
const ORG = '00000000-0000-4000-8000-000001930a02';
const ROLE = '00000000-0000-4000-8000-000001930a03';
const HOOK_MODULE = 'acme_erp';

/** Values an outbox row must never carry: an e-mail, a name, a custom-field value. */
const S = {
  email: 's193@example.test',
  emailNew: 's193-new@example.test',
  firstName: 'S193-FIRST',
  lastName: 'S193-LAST',
  customField: 'S193-CF',
  customFieldNew: 'S193-CF-NEW',
} as const;
const SENTINELS = Object.values(S);

type Row = Record<string, unknown>;

/** Enough of MikroORM's EntityManager for these writes, keyed by class name. */
class FakeEm {
  readonly tables = new Map<string, Row[]>();

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    return Object.assign(new entity(), data);
  }

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => Object.entries(where).every(([k, v]) => (row[k] ?? null) === v)) ?? null;
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

type HookRegistration = { moduleId: string; entries: readonly CommandHookEntry[] };

function harness(hooks: readonly HookRegistration[] = []) {
  const em = new FakeEm();
  const audits: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      audits.push(structuredClone(input));
      return input as never;
    },
  };
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'customer_accounts', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['customer_accounts'] },
    hooks,
  });
  const bus = new CommandBus({ em } as never, audit as never, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  const port = new CustomerAccountCommandService({
    commandBus: bus,
    emFactory: () => em as never,
    // The account holds a second factor: the hook's record must say so.
    twoFactorEnrolments: async (ids) => new Set(ids),
    roles: { findRole: async () => null, predefinedRoleId: async () => ROLE },
    isPersonal: async () => false,
    personalOrganizations: {} as PersonalOrganizationProvisionApi,
    sessions: { destroyAllForCustomer: async () => undefined },
    afterCommit: async (fn) => fn(),
    hash: async () => 'hashed',
  });
  const outbox = () => em.table('CommandOutboxEntry');
  return { em, audits, bus, port, outbox };
}

function seedAccount(em: FakeEm): CustomerAccount {
  const account = em.create(CustomerAccount, {
    id: randomUUID(),
    email: S.email,
    firstName: S.firstName,
    lastName: S.lastName,
    passwordHash: 'x',
    organizationId: ORG,
    organizationRoleId: ROLE,
    emailVerifiedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
    blockedAt: null,
    subtreeRollupEnabled: false,
    customFieldValues: { risk: S.customField },
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  } as Partial<CustomerAccount>);
  em.persist(account);
  return account;
}

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN, 'customer_accounts unit test: hookable actions', fn);

const afterCommitEntry = (ref: (typeof ACCOUNTS)[keyof typeof ACCOUNTS]): CommandHookEntry => ({
  id: `outbox-${ref.action.replace(/[._]+/g, '-')}`,
  on: ref,
  phase: 'afterCommit',
  handler: async () => undefined,
});

const toRecord = (account: CustomerAccount): CustomerAccountRecord => toCustomerAccountRecord(account, true);

describe('customer_accounts declares three hookable actions (193 FR-110, FR-114)', () => {
  it('lists the three refs in its manifest, for both phases', () => {
    expect(manifest.hookableActions).toEqual(
      [ACCOUNTS.create, ACCOUNTS.updateProfile, ACCOUNTS.customFieldsUpdate].map((ref) => ({
        action: ref.action,
        objectType: ref.objectType,
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });
});

describe('customer_account.create is hookable', () => {
  const input = {
    email: S.email,
    password: 'correct horse battery staple',
    firstName: S.firstName,
    lastName: S.lastName,
    customFieldValues: { risk: S.customField },
  };

  it('supplies hookData and list-1 outboxData', async () => {
    const prepared = await prepareCustomerAccountCreate(input, { toRecord, hash: async () => 'hashed' });
    const command = prepared.command({ organizationId: ORG, organizationRoleId: ROLE });
    const em = new FakeEm();
    const outcome = await command.run({ em } as never);
    expectHookableCommand(command, ACCOUNTS.create, { result: outcome.result, sentinels: SENTINELS });
  });

  it('hands a hook the new record, and an afterCommit handler a names-only row', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      { moduleId: HOOK_MODULE, entries: [recording.on(ACCOUNTS.create), afterCommitEntry(ACCOUNTS.create)] },
    ]);

    const created = await asAdmin(() =>
      h.port.create(
        { ...input, organizationId: ORG, organizationRoleId: ROLE },
        { extensions: { [HOOK_MODULE]: { code: 'E-1' } } },
      ),
    );

    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.extension).toEqual({ code: 'E-1' });
    const data = recording.calls[0]!.data as CustomerAccountCreateHookData;
    expect(data.customerAccount).toMatchObject({ id: created.id, email: S.email, organizationId: ORG });
    expect(h.outbox().map((row) => row['data'])).toEqual([
      {
        customerAccountId: created.id,
        organizationId: ORG,
        changedFields: ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId'],
      },
    ]);
  });
});

describe('customer_account.update_profile is hookable', () => {
  it('supplies hookData and list-1 outboxData', async () => {
    const em = new FakeEm();
    const account = seedAccount(em);
    const command = makeUpdateCustomerAccountProfileCommand({
      customerAccountId: account.id,
      patch: { email: S.emailNew },
      toRecord,
    });
    const outcome = await command.run({ em } as never);
    expectHookableCommand(command, ACCOUNTS.updateProfile, { result: outcome.result, sentinels: SENTINELS });
  });

  it('hands a hook the after-state and the names of what changed', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      { moduleId: HOOK_MODULE, entries: [recording.on(ACCOUNTS.updateProfile), afterCommitEntry(ACCOUNTS.updateProfile)] },
    ]);
    const account = seedAccount(h.em);

    await asAdmin(() =>
      h.port.updateProfile(account.id, { email: S.emailNew }, { extensions: { [HOOK_MODULE]: { code: 'E-2' } } }),
    );

    expect(recording.calls.map((call) => call.extension)).toEqual([{ code: 'E-2' }]);
    const data = recording.calls[0]!.data as CustomerAccountUpdateHookData;
    expect(data.customerAccount).toMatchObject({ id: account.id, email: S.emailNew, emailVerifiedAt: null, twoFactorEnabled: true });
    expect(data.changedFields).toEqual(['email', 'emailVerifiedAt']);
    expect(data.changedCustomFields).toEqual([]);
    expect(h.outbox().map((row) => row['data'])).toEqual([
      { customerAccountId: account.id, organizationId: ORG, changedFields: ['email', 'emailVerifiedAt'] },
    ]);
  });
});

describe('customer.custom_fields.update is hookable', () => {
  it('supplies hookData and list-1 outboxData', async () => {
    const em = new FakeEm();
    const account = seedAccount(em);
    const command = makeSetCustomerCustomFieldValuesCommand({
      customerAccountId: account.id,
      merge: async (current) => ({ ...current, tier: S.customFieldNew }),
      toRecord,
    });
    const outcome = await command.run({ em } as never);
    expectHookableCommand(command, ACCOUNTS.customFieldsUpdate, { result: outcome.result, sentinels: SENTINELS });
  });

  it('hands a hook the after-state and the custom-field keys that changed', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      {
        moduleId: HOOK_MODULE,
        entries: [recording.on(ACCOUNTS.customFieldsUpdate), afterCommitEntry(ACCOUNTS.customFieldsUpdate)],
      },
    ]);
    const account = seedAccount(h.em);

    await asAdmin(() =>
      h.port.setCustomFieldValues(account.id, async (current) => ({ ...current, tier: S.customFieldNew }), {
        extensions: { [HOOK_MODULE]: { code: 'E-3' } },
      }),
    );

    expect(recording.calls.map((call) => call.extension)).toEqual([{ code: 'E-3' }]);
    const data = recording.calls[0]!.data as CustomerAccountUpdateHookData;
    expect(data.customerAccount.customFieldValues).toEqual({ risk: S.customField, tier: S.customFieldNew });
    expect(data.changedFields).toEqual([]);
    expect(data.changedCustomFields).toEqual(['tier']);
    expect(h.outbox().map((row) => row['data'])).toEqual([
      { customerAccountId: account.id, organizationId: ORG, changedFields: [] },
    ]);
  });
});

describe('customerAccountCommandPort forwards extensions (193 T003)', () => {
  const cases: ReadonlyArray<{
    name: string;
    run: (port: CustomerAccountCommandService, id: string, extensions: Record<string, unknown>) => Promise<unknown>;
  }> = [
    {
      name: 'create',
      run: (port, _id, extensions) =>
        port.create(
          {
            email: S.emailNew,
            password: 'correct horse battery staple',
            firstName: S.firstName,
            lastName: S.lastName,
            organizationId: ORG,
            organizationRoleId: ROLE,
          },
          { extensions },
        ),
    },
    { name: 'updateProfile', run: (port, id, extensions) => port.updateProfile(id, { firstName: 'Changed' }, { extensions }) },
    {
      name: 'setCustomFieldValues',
      run: (port, id, extensions) =>
        port.setCustomFieldValues(id, async (current) => ({ ...current, tier: 'gold' }), { extensions }),
    },
  ];

  for (const { name, run } of cases) {
    it(`${name}: answers 422 COMMAND_EXTENSION_UNCLAIMED for a key no present hook module claims, before any write`, async () => {
      const h = harness([
        {
          moduleId: HOOK_MODULE,
          entries: [
            recordingCommandHooks().on(ACCOUNTS.create),
            recordingCommandHooks().on(ACCOUNTS.updateProfile),
            recordingCommandHooks().on(ACCOUNTS.customFieldsUpdate),
          ],
        },
      ]);
      const account = seedAccount(h.em);
      const fieldsOf = (row: CustomerAccount) => Object.fromEntries(Object.entries(row));
      const before = fieldsOf(account);

      const err = await asAdmin(() => run(h.port, account.id, { acme_typo: { code: 'x' } })).catch((e: unknown) => e);

      expect(err).toMatchObject({
        statusCode: 422,
        code: 'COMMAND_EXTENSION_UNCLAIMED',
        details: [{ path: 'extensions.acme_typo' }],
      });
      expect(h.audits).toEqual([]);
      expect(h.em.table('CustomerAccount')).toHaveLength(1);
      expect(fieldsOf(account)).toEqual(before);
    });
  }
});

describe('none of the three is reversible (176 R-20; 193 hookable-writers.md §4.1)', () => {
  /** A Command's outcome: the caller result and the audit states, never a stored revert state. */
  const OUTCOME_KEYS = new Set<keyof CommandOutcome<unknown>>(['result', 'before', 'after', 'skipAudit']);

  async function outcomes(): Promise<Array<{ action: string; outcome: CommandOutcome<unknown> }>> {
    const em = new FakeEm();
    const account = seedAccount(em);
    const prepared = await prepareCustomerAccountCreate(
      { email: S.emailNew, password: 'correct horse battery staple', firstName: S.firstName, lastName: S.lastName },
      { toRecord, hash: async () => 'hashed' },
    );
    const commands: Array<Command<unknown>> = [
      prepared.command({ organizationId: ORG, organizationRoleId: ROLE }) as Command<unknown>,
      makeUpdateCustomerAccountProfileCommand({ customerAccountId: account.id, patch: { firstName: 'Changed' }, toRecord }),
      makeSetCustomerCustomFieldValuesCommand({
        customerAccountId: account.id,
        merge: async (current) => ({ ...current, tier: 'gold' }),
        toRecord,
      }),
    ];
    const ran: Array<{ action: string; outcome: CommandOutcome<unknown> }> = [];
    for (const command of commands) ran.push({ action: command.action, outcome: await command.run({ em } as never) });
    return ran;
  }

  it('each Command returns a result and audit states only, and no revert state', async () => {
    const ran = await outcomes();
    expect(ran.map((entry) => entry.action)).toEqual(Object.values(ACCOUNTS).map((ref) => ref.action));
    for (const { action, outcome } of ran) {
      expect(Object.keys(outcome).filter((key) => !OUTCOME_KEYS.has(key as keyof CommandOutcome<unknown>)), action).toEqual(
        [],
      );
    }
  });

  it('the module wires nothing into the stored-revert undo of feature 054', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const sources = (readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]).filter(
      (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path),
    );
    expect(sources, 'the scan reads the module source').toContain(join('backend', 'commands', 'customer-account-create.command.ts'));
    const offenders = sources.filter((path) =>
      /\b(applyUndo|RevertRecord|RevertHandlers|revertState)\b/.test(readFileSync(join(root, path), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
