/**
 * The audit-state rule for customer accounts (`specs/conventions/audit-state.md`,
 * D-288, issue #470): the platform audit log carries **names and structure** of
 * a customer account, never its values. No history reads those values back out
 * of the audit log, so they are kept nowhere else: the account row holds the
 * current ones.
 *
 * Every write that records an account entry is run against an in-memory
 * EntityManager with a recording audit port. The Commands
 * (`customer.custom_fields.update`, `customer_account.change_role`) run through
 * the **real** `CommandBus`; the other writes record through the audit port
 * directly, as they always have, and are held to the same sentinels.
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationRoleKind } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { makeChangeCustomerAccountRoleCommand } from '../commands/customer-account-change-role.command.js';
import type { CustomerAccountRoleCommandDeps, CustomerAccountRoleRow } from '../commands/customer-account-role-rules.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CUSTOMER_ACCOUNT_AUDIT_KEYS, accountCreatedAuditState } from './customer-account-audit-state.js';
import { CustomerAccountLifecycleWriteService } from './customer-account-lifecycle-ports.js';
import { CustomerAccountMemberWriteService } from './customer-account-ports.js';

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit` (#1004): this branch is not stacked on it.
// Replace this block with the import once #1004 has merged.
// ---------------------------------------------------------------------------
type Sentinel = string | number;
type AuditState = Pick<RecordAuditInput, 'action' | 'stateBefore' | 'stateAfter'>;

function leaksOf(entries: readonly AuditState[], sentinels: readonly Sentinel[]): string[] {
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) {
        leaks.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
  };
  entries.forEach((entry, index) => {
    walk(entry.stateBefore, `[${index}] ${entry.action} stateBefore`);
    walk(entry.stateAfter, `[${index}] ${entry.action} stateAfter`);
  });
  return leaks;
}

function expectNoAuditValues(entries: readonly AuditState[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks = leaksOf(entries, sentinels);
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const NEW_ORG = randomUUID();
const ROLE = randomUUID();
const NEW_ROLE = randomUUID();

const S = {
  email: 's470@example.test',
  emailNew: 's470-new@example.test',
  firstName: 'S470-FIRST',
  firstNameNew: 'S470-FIRST-NEW',
  lastName: 'S470-LAST',
  reason: 'S470-REASON',
  customField: 'S470-CF',
  customFieldNew: 'S470-CF-NEW',
  role: 'S470-ROLE',
} as const;

const SENTINELS: readonly Sentinel[] = [...Object.values(S), ORG, NEW_ORG];

function topLevelKeys(entries: readonly AuditState[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => [...Object.keys(entry.stateBefore ?? {}), ...Object.keys(entry.stateAfter ?? {})])),
  ].sort();
}

function expectOnlyAllowedKeys(entries: readonly AuditState[]): void {
  expect(topLevelKeys(entries).filter((key) => !CUSTOMER_ACCOUNT_AUDIT_KEYS.has(key))).toEqual([]);
}

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
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async persistAndFlush(row: object): Promise<void> {
    this.persist(row);
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

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async (input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  const noEnrolments = async () => new Set<string>();
  const provision = {
    provisionFor: async () => ({ id: ORG, administratorRoleId: ROLE }),
  } as unknown as PersonalOrganizationProvisionApi;
  const lifecycle = new CustomerAccountLifecycleWriteService(
    () => em as never,
    audit as never,
    noEnrolments,
    provision,
    commandBus,
  );
  const members = new CustomerAccountMemberWriteService(() => em as never, noEnrolments, audit as never);
  return { em, entries, commandBus, lifecycle, members };
}

function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ADMIN, 'customer_accounts audit-state sentinel test', fn);
}

function seedAccount(em: FakeEm, overrides: Partial<CustomerAccount> = {}): CustomerAccount {
  return em.create(CustomerAccount, {
    id: randomUUID(),
    email: S.email,
    firstName: S.firstName,
    lastName: S.lastName,
    passwordHash: 'x',
    organizationId: ORG,
    organizationRoleId: ROLE,
    deletedAt: null,
    blockedAt: null,
    customFieldValues: { risk: S.customField },
    ...overrides,
  } as Partial<CustomerAccount>);
}

describe('customer_accounts audit state carries names, never values (#470)', () => {
  it('customer_account.blocked / .unblocked — the block, never its reason', async () => {
    const h = harness();
    const account = seedAccount(h.em);

    await h.lifecycle.block(account.id, { actorAdminUserId: ADMIN, reason: S.reason });
    await h.lifecycle.unblock(account.id, { actorAdminUserId: ADMIN });

    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries.map((e) => e.action)).toEqual(['customer_account.blocked', 'customer_account.unblocked']);
    expect(h.entries[0]?.stateAfter).toMatchObject({ blockSource: 'staff', hasBlockReason: true });
    expect(h.entries[1]?.stateBefore).toMatchObject({ hasBlockReason: true });
    expect(h.entries[1]?.stateAfter).toMatchObject({ blockedAt: null, hasBlockReason: false });
    expectOnlyAllowedKeys(h.entries);
  });

  it('customer_account.organization_assigned / _unassigned — a tenant move by name', async () => {
    const h = harness();
    const account = seedAccount(h.em);

    await h.lifecycle.setOrganization(account.id, NEW_ORG, { actorAdminUserId: ADMIN, organizationRoleId: NEW_ROLE });
    await h.lifecycle.detachToPersonalOrganization(account.id, ORG, { actorAdminUserId: ADMIN, organizationRoleId: ROLE });

    expectNoAuditValues(h.entries, SENTINELS);
    for (const entry of h.entries) {
      expect(entry.stateAfter).toMatchObject({ changedFields: ['organizationId', 'organizationRoleId'] });
    }
    expect(h.entries[0]?.stateAfter).toMatchObject({ organizationRoleId: NEW_ROLE });
    expect(h.entries[0]?.stateBefore).toEqual({ organizationRoleId: ROLE });
    expectOnlyAllowedKeys(h.entries);
  });

  it('customer.custom_fields.update — names the changed keys through the bus', async () => {
    const h = harness();
    const account = seedAccount(h.em);

    await asAdmin(() =>
      h.lifecycle.setCustomFieldValues(account.id, async (current) => ({ ...current, risk: S.customFieldNew, tier: S.customFieldNew })),
    );

    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.action).toBe('customer.custom_fields.update');
    expect(h.entries[0]?.stateAfter).toEqual({ changedCustomFields: ['risk', 'tier'] });
    expect(account.customFieldValues).toEqual({ risk: S.customFieldNew, tier: S.customFieldNew });
    expectOnlyAllowedKeys(h.entries);
  });

  it('customer_account.register_standalone — no e-mail, name or tenant', async () => {
    const h = harness();

    await h.lifecycle.createStandalone({ email: S.email, password: 'S470-pass-word', firstName: S.firstName, lastName: S.lastName });

    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.action).toBe('customer_account.register_standalone');
    expect(h.entries[0]?.stateAfter).toMatchObject({
      changedFields: ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId'],
    });
    expectOnlyAllowedKeys(h.entries);
  });

  it('customer_account.register_social — the same shape, from its builder', () => {
    const account = Object.assign(new CustomerAccount(), {
      id: randomUUID(),
      email: S.email,
      firstName: S.firstName,
      lastName: S.lastName,
      organizationId: ORG,
      organizationRoleId: ROLE,
      emailVerifiedAt: new Date(),
    });
    const entries = [{ action: 'customer_account.register_social', stateBefore: null, stateAfter: accountCreatedAuditState(account) }];

    expectNoAuditValues(entries, SENTINELS);
    expect(entries[0]?.stateAfter).toMatchObject({ emailVerified: true, organizationRoleId: ROLE });
    expectOnlyAllowedKeys(entries);
  });

  it('customer_account.create / .update_profile / .attach_organization — names only', async () => {
    const h = harness();

    const created = await asAdmin(() =>
      h.members.create({
        organizationId: ORG,
        email: S.email,
        password: 'S470-pass-word',
        firstName: S.firstName,
        lastName: S.lastName,
        organizationRoleId: ROLE,
      }),
    );
    await asAdmin(() => h.members.updateProfile(created.id, { email: S.emailNew, firstName: S.firstNameNew }));
    await asAdmin(() => h.members.attachToOrganization(created.id, NEW_ORG, NEW_ROLE));

    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries.map((e) => e.action)).toEqual([
      'customer_account.create',
      'customer_account.update_profile',
      'customer_account.attach_organization',
    ]);
    expect(h.entries[1]?.stateAfter).toEqual({ changedFields: ['email', 'emailVerifiedAt', 'firstName'] });
    expect(h.entries[2]?.stateAfter).toMatchObject({ changedFields: ['organizationId', 'organizationRoleId'] });
    expectOnlyAllowedKeys(h.entries);
  });

  it('customer_account.change_role — the role by id and kind, never its name', async () => {
    const h = harness();
    const account: CustomerAccountRoleRow = { id: randomUUID(), organizationId: ORG, organizationRoleId: ROLE, deletedAt: null };
    const roles: Array<{ id: string; kind: OrganizationRoleKind; name: string | null }> = [
      { id: ROLE, kind: 'custom', name: 'S470-ROLE-OLD' },
      { id: NEW_ROLE, kind: 'custom', name: S.role },
    ];
    const deps: CustomerAccountRoleCommandDeps = {
      roles: {
        findRole: async (_org: string, id: string) => roles.find((role) => role.id === id) ?? null,
        predefinedRoleId: async () => randomUUID(),
      },
      store: () => ({
        findMember: async () => account,
        lockActiveHolders: async () => [],
        save: async () => undefined,
      }),
    } as never;

    await asAdmin(() =>
      h.commandBus.run(
        makeChangeCustomerAccountRoleCommand(deps, { organizationId: ORG, customerAccountId: account.id, roleId: NEW_ROLE } as never),
      ),
    );

    expectNoAuditValues(h.entries, [...SENTINELS, 'S470-ROLE-OLD']);
    expect(h.entries[0]?.stateAfter).toEqual({ customerAccountId: account.id, role: { id: NEW_ROLE, kind: 'custom' } });
    expectOnlyAllowedKeys(h.entries);
  });
});
