import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type OrganizationRoleKind } from '@endora-commerce/contracts';
import type { Command, CommandContext, CommandOutcome } from '@endora-commerce/platform/commands';
import type {
  CustomerAccountRoleCommandDeps,
  CustomerAccountRoleRow,
  CustomerAccountRoleStore,
  OrganizationRoleLookup,
} from './customer-account-role-rules.js';
import { makeChangeCustomerAccountRoleCommand } from './customer-account-change-role.command.js';
import { makeRemoveMemberCommand } from './customer-account-remove-member.command.js';
import { makePromoteOrganizationAdminCommand } from './customer-account-promote-admin.command.js';

/**
 * `customer_account.{change_role,remove_member,promote_organization_admin}`
 * (`specs/170-organization-roles/` WP-02b, T041; `contracts/commands-audit-events.md`
 * §2–§3; research R-22, R-29, R-32; FR-005, FR-065).
 *
 * Each Command is run directly — `command.run(ctx)` — against an in-memory
 * account store and role lookup, so the audit state, the `skipAudit` decision,
 * the lock and the event are read off the outcome exactly as the bus would
 * receive them. The bus itself (one entry, co-transactional, event on commit)
 * is the platform's; the lock's effect against a real database is
 * `backend/test/integration/customer_accounts/last-administrator-lock.test.ts`.
 */

const ORG = '00000000-0000-4000-8000-00000000b001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000b002';

interface Role {
  id: string;
  organizationId: string;
  kind: OrganizationRoleKind;
  name: string | null;
}

class MemoryRoles implements OrganizationRoleLookup {
  readonly roles: Role[] = [];

  constructor() {
    for (const organizationId of [ORG, OTHER_ORG]) {
      this.add(organizationId, 'administrator');
      this.add(organizationId, 'member');
    }
  }

  add(organizationId: string, kind: OrganizationRoleKind, name: string | null = null): Role {
    const role = { id: randomUUID(), organizationId, kind, name };
    this.roles.push(role);
    return role;
  }

  of(organizationId: string, kind: OrganizationRoleKind): Role {
    return this.roles.find((r) => r.organizationId === organizationId && r.kind === kind)!;
  }

  async findRole(organizationId: string, roleId: string) {
    const role = this.roles.find((r) => r.id === roleId && r.organizationId === organizationId);
    return role ? { id: role.id, kind: role.kind, name: role.name } : null;
  }

  async predefinedRoleId(organizationId: string, kind: 'administrator' | 'member') {
    return this.of(organizationId, kind).id;
  }
}

class MemoryAccounts implements CustomerAccountRoleStore {
  readonly rows = new Map<string, CustomerAccountRoleRow & { blockedAt: Date | null }>();
  readonly locks: Array<{ organizationId: string; roleId: string }> = [];

  seed(organizationId: string, organizationRoleId: string, options: { blocked?: boolean; deleted?: boolean } = {}) {
    const row = {
      id: randomUUID(),
      organizationId,
      organizationRoleId,
      deletedAt: options.deleted ? new Date() : null,
      blockedAt: options.blocked ? new Date() : null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findMember(organizationId: string, customerAccountId: string) {
    const row = this.rows.get(customerAccountId);
    return row && row.organizationId === organizationId && row.deletedAt === null ? row : null;
  }

  async lockActiveHolders(organizationId: string, roleId: string) {
    this.locks.push({ organizationId, roleId });
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.organizationId === organizationId &&
          r.organizationRoleId === roleId &&
          r.deletedAt === null &&
          r.blockedAt === null,
      )
      .map((r) => r.id);
  }

  async save(row: CustomerAccountRoleRow) {
    this.rows.set(row.id, { ...this.rows.get(row.id)!, ...row });
  }
}

function fixture() {
  const roles = new MemoryRoles();
  const accounts = new MemoryAccounts();
  const deps: CustomerAccountRoleCommandDeps = { roles, store: () => accounts };
  const admin = roles.of(ORG, 'administrator');
  const member = roles.of(ORG, 'member');
  return { roles, accounts, deps, admin, member };
}

const ctx = { em: {} as EntityManager, actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'customer' } } as CommandContext;

async function run<T>(command: Command<T>): Promise<CommandOutcome<T>> {
  return command.run(ctx);
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { statusCode: number; code: string };
  }
  throw new Error('expected a refusal');
}

describe('customer_account.change_role', () => {
  it('moves the account to the role, writes no legacy enum and audits against the Organization', async () => {
    const { accounts, deps, admin, member } = fixture();
    accounts.seed(ORG, admin.id); // a second administrator, so the first may be demoted
    const target = accounts.seed(ORG, member.id);

    const promote = makeChangeCustomerAccountRoleCommand(deps, {
      organizationId: ORG,
      customerAccountId: target.id,
      roleId: admin.id,
    });
    expect(promote).toMatchObject({ action: 'customer_account.change_role', objectType: 'organization', objectId: ORG });
    const outcome = await run(promote);
    expect(accounts.rows.get(target.id)).toMatchObject({ organizationRoleId: admin.id });
    expect(accounts.rows.get(target.id)).not.toHaveProperty('role');
    expect(outcome.skipAudit).toBeFalsy();
    expect(outcome.before).toEqual({
      customerAccountId: target.id,
      role: { id: member.id, name: null, kind: 'member' },
    });
    expect(outcome.after).toEqual({
      customerAccountId: target.id,
      role: { id: admin.id, name: null, kind: 'administrator' },
    });
    const event = promote.event?.(outcome.result);
    expect(event?.eventName).toBe('customer_account.organization_role_changed.v1');
    expect(event?.payload).toMatchObject({
      organizationId: ORG,
      customerAccountId: target.id,
      fromRoleId: member.id,
      toRoleId: admin.id,
    });

    const demote = makeChangeCustomerAccountRoleCommand(deps, {
      organizationId: ORG,
      customerAccountId: target.id,
      roleId: member.id,
    });
    await run(demote);
    expect(accounts.rows.get(target.id)).toMatchObject({ organizationRoleId: member.id });
  });

  it('moves the account to a custom role and names the custom role in the audit', async () => {
    const { roles, accounts, deps, member } = fixture();
    const buyer = roles.add(ORG, 'custom', 'Buyer');
    const target = accounts.seed(ORG, member.id);
    const outcome = await run(
      makeChangeCustomerAccountRoleCommand(deps, { organizationId: ORG, customerAccountId: target.id, roleId: buyer.id }),
    );
    expect(accounts.rows.get(target.id)).toMatchObject({ organizationRoleId: buyer.id });
    expect(outcome.after).toEqual({ customerAccountId: target.id, role: { id: buyer.id, name: 'Buyer', kind: 'custom' } });
  });

  it('records nothing and emits nothing when the account already holds the role', async () => {
    const { accounts, deps, member } = fixture();
    const target = accounts.seed(ORG, member.id);
    const command = makeChangeCustomerAccountRoleCommand(deps, {
      organizationId: ORG,
      customerAccountId: target.id,
      roleId: member.id,
    });
    const outcome = await run(command);
    expect(outcome.skipAudit).toBe(true);
    expect(command.event?.(outcome.result)).toBeUndefined();
  });

  it("refuses another Organization's role with not-found (FR-005)", async () => {
    const { roles, accounts, deps, member } = fixture();
    const target = accounts.seed(ORG, member.id);
    const err = await refusal(
      run(
        makeChangeCustomerAccountRoleCommand(deps, {
          organizationId: ORG,
          customerAccountId: target.id,
          roleId: roles.of(OTHER_ORG, 'administrator').id,
        }),
      ),
    );
    expect(err).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    expect(accounts.rows.get(target.id)?.organizationRoleId).toBe(member.id);
  });

  it('refuses a member of another Organization, and a removed member, with not-found', async () => {
    const { accounts, deps, roles, member } = fixture();
    const elsewhere = accounts.seed(OTHER_ORG, roles.of(OTHER_ORG, 'member').id);
    const removed = accounts.seed(ORG, member.id, { deleted: true });
    for (const customerAccountId of [elsewhere.id, removed.id]) {
      const err = await refusal(
        run(makeChangeCustomerAccountRoleCommand(deps, { organizationId: ORG, customerAccountId, roleId: member.id })),
      );
      expect(err).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    }
  });

  it('refuses demoting the last active administrator, counting under a lock (R-29)', async () => {
    const { accounts, deps, admin, member } = fixture();
    const only = accounts.seed(ORG, admin.id);
    // A blocked administrator cannot act, so it does not keep the Organization administered.
    accounts.seed(ORG, admin.id, { blocked: true });
    const err = await refusal(
      run(makeChangeCustomerAccountRoleCommand(deps, { organizationId: ORG, customerAccountId: only.id, roleId: member.id })),
    );
    expect(err).toMatchObject({ statusCode: 409, code: ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN });
    expect(accounts.locks).toEqual([{ organizationId: ORG, roleId: admin.id }]);
    expect(accounts.rows.get(only.id)?.organizationRoleId).toBe(admin.id);
  });

  it('lets one of two active administrators step down', async () => {
    const { accounts, deps, admin, member } = fixture();
    const first = accounts.seed(ORG, admin.id);
    accounts.seed(ORG, admin.id);
    await run(makeChangeCustomerAccountRoleCommand(deps, { organizationId: ORG, customerAccountId: first.id, roleId: member.id }));
    expect(accounts.rows.get(first.id)?.organizationRoleId).toBe(member.id);
  });
});

describe('customer_account.remove_member', () => {
  it('removes a member and audits against the Organization with the role it held', async () => {
    const { accounts, deps, admin, member } = fixture();
    accounts.seed(ORG, admin.id);
    const target = accounts.seed(ORG, member.id);
    const command = makeRemoveMemberCommand(deps, { organizationId: ORG, customerAccountId: target.id });
    expect(command).toMatchObject({ action: 'customer_account.remove_member', objectType: 'organization', objectId: ORG });
    const outcome = await run(command);
    expect(accounts.rows.get(target.id)?.deletedAt).toBeInstanceOf(Date);
    expect(outcome.before).toEqual({ customerAccountId: target.id, role: { id: member.id, name: null, kind: 'member' } });
    expect(outcome.after).toBeNull();
  });

  it('refuses removing the last active administrator under a lock (R-29)', async () => {
    const { accounts, deps, admin } = fixture();
    const only = accounts.seed(ORG, admin.id);
    const err = await refusal(run(makeRemoveMemberCommand(deps, { organizationId: ORG, customerAccountId: only.id })));
    expect(err).toMatchObject({ statusCode: 409, code: ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN });
    expect(accounts.locks).toEqual([{ organizationId: ORG, roleId: admin.id }]);
    expect(accounts.rows.get(only.id)?.deletedAt).toBeNull();
  });

  it('refuses an account that is not a live member of the Organization with not-found', async () => {
    const { deps } = fixture();
    const err = await refusal(run(makeRemoveMemberCommand(deps, { organizationId: ORG, customerAccountId: randomUUID() })));
    expect(err).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  });
});

describe('customer_account.promote_organization_admin', () => {
  it('assigns the administrator role, audits against the Organization and emits the change', async () => {
    const { accounts, deps, admin, member } = fixture();
    const target = accounts.seed(ORG, member.id);
    const command = makePromoteOrganizationAdminCommand(deps, { organizationId: ORG, customerAccountId: target.id });
    expect(command).toMatchObject({
      action: 'customer_account.promote_organization_admin',
      objectType: 'organization',
      objectId: ORG,
    });
    const outcome = await run(command);
    expect(accounts.rows.get(target.id)).toMatchObject({ organizationRoleId: admin.id });
    expect(accounts.rows.get(target.id)).not.toHaveProperty('role');
    expect(outcome.after).toEqual({ customerAccountId: target.id, role: { id: admin.id, name: null, kind: 'administrator' } });
    expect(command.event?.(outcome.result)?.eventName).toBe('customer_account.organization_role_changed.v1');
  });

  it('is idempotent on an account that already holds it', async () => {
    const { accounts, deps, admin } = fixture();
    const target = accounts.seed(ORG, admin.id);
    const command = makePromoteOrganizationAdminCommand(deps, { organizationId: ORG, customerAccountId: target.id });
    const outcome = await run(command);
    expect(outcome.skipAudit).toBe(true);
    expect(command.event?.(outcome.result)).toBeUndefined();
  });
});

describe('no hand-placed audit for the member Commands (Principle XIII gate 12, R-32)', () => {
  const backend = join(dirname(fileURLToPath(import.meta.url)), '..');

  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    });
  }

  it('deletes role-service.ts', () => {
    expect(existsSync(join(backend, 'services', 'role-service.ts'))).toBe(false);
  });

  it('names the three actions in their Commands only, and the Commands record nothing by hand', () => {
    const actions = [
      'customer_account.change_role',
      'customer_account.remove_member',
      'customer_account.promote_organization_admin',
    ];
    for (const file of sources(backend)) {
      const text = readFileSync(file, 'utf8');
      const isCommand = file.endsWith('.command.ts');
      if (isCommand) expect(text, file).not.toContain('recordAuditFromContext');
      for (const action of actions) {
        if (text.includes(`'${action}'`)) expect(isCommand, `${file} names ${action}`).toBe(true);
      }
    }
  });
});
