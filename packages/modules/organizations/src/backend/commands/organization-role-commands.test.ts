import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command, CommandContext, CommandOutcome } from '@endora-commerce/platform/commands';
import { OrganizationRoleCatalogue, type OrganizationPermissionManifestEntry } from '../services/organization-role-catalogue.js';
import type {
  NewOrganizationRole,
  OrganizationRoleRow,
  OrganizationRoleStore,
} from '../services/organization-role-store.js';
import { MAX_CUSTOM_ROLES_PER_ORGANIZATION } from '../services/organization-role-rules.js';
import { makeCreateOrganizationRoleCommand } from './organization-role-create.command.js';
import { makeUpdateOrganizationRoleCommand } from './organization-role-update.command.js';
import { makeDeleteOrganizationRoleCommand } from './organization-role-delete.command.js';

/**
 * `organization_role.{create,update,delete}` (`specs/170-organization-roles/`
 * WP-02a, T027; data-model §1; `contracts/commands-audit-events.md` §2;
 * research R-17, R-29, R-32; FR-002…FR-004, FR-023…FR-025, FR-065).
 *
 * Each Command is run directly — `command.run(ctx)` — against an in-memory
 * role store, so the audit state, the `skipAudit` decision and the event are
 * read off the outcome exactly as the bus would receive them. The bus itself
 * (one entry, co-transactional, event on commit) is the platform's and is
 * tested there.
 */

const ORG = '00000000-0000-4000-8000-00000000a001';
const PERSONAL_ORG = '00000000-0000-4000-8000-00000000a002';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a003';

const MANIFESTS: OrganizationPermissionManifestEntry[] = [
  {
    manifest: {
      id: 'carts',
      name: 'Carts',
      organizationPermissions: [
        { code: 'carts.create', label: 'Create carts', description: 'd', memberDefault: true },
        { code: 'carts.approve', label: 'Approve carts', description: 'd', memberDefault: false },
      ],
    },
  },
  {
    manifest: {
      id: 'quick_order',
      name: 'Quick order',
      organizationPermissions: [{ code: 'quick_order.one_click', label: 'One click', description: 'd', memberDefault: true }],
    },
  },
  {
    manifest: {
      id: 'orders',
      name: 'Orders',
      organizationPermissions: [{ code: 'orders.view_organization', label: 'Colleagues’ orders', description: 'd', memberDefault: false }],
    },
  },
];

const RESERVED = ['Administrator', 'Member', 'Administrator', 'Członek'];

class MemoryRoleStore implements OrganizationRoleStore {
  readonly rows = new Map<string, OrganizationRoleRow>();
  readonly invitations = new Map<string, number>();
  readonly organizations = new Map<string, { isPersonal: boolean }>([
    [ORG, { isPersonal: false }],
    [PERSONAL_ORG, { isPersonal: true }],
    [OTHER_ORG, { isPersonal: false }],
  ]);

  constructor() {
    for (const org of this.organizations.keys()) {
      for (const kind of ['administrator', 'member'] as const) this.seed({ organizationId: org, kind });
    }
  }

  seed(values: Partial<OrganizationRoleRow> & { organizationId: string; kind: OrganizationRoleRow['kind'] }): OrganizationRoleRow {
    const row: OrganizationRoleRow = {
      id: randomUUID(),
      name: null,
      nameNormalized: null,
      description: null,
      permissions: [],
      memberDefaultsOffered: [],
      version: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      ...values,
    };
    this.rows.set(row.id, row);
    return row;
  }

  roleOf(organizationId: string, kind: OrganizationRoleRow['kind']): OrganizationRoleRow {
    return [...this.rows.values()].find((r) => r.organizationId === organizationId && r.kind === kind)!;
  }

  async lockOrganization(organizationId: string) {
    return this.organizations.get(organizationId) ?? null;
  }
  async lock(organizationId: string, roleId: string) {
    const row = this.rows.get(roleId);
    return row && row.organizationId === organizationId ? row : null;
  }
  async listInOrganization(organizationId: string) {
    return [...this.rows.values()].filter((r) => r.organizationId === organizationId);
  }
  async create(values: NewOrganizationRole) {
    return this.seed({ ...values, kind: 'custom' });
  }
  async save(row: OrganizationRoleRow) {
    this.rows.set(row.id, row);
  }
  async remove(row: OrganizationRoleRow) {
    this.rows.delete(row.id);
  }
  async countInvitations(_organizationId: string, roleId: string) {
    return this.invitations.get(roleId) ?? 0;
  }
  async moveInvitations(_organizationId: string, fromRoleId: string, to: OrganizationRoleRow) {
    const count = this.invitations.get(fromRoleId) ?? 0;
    this.invitations.delete(fromRoleId);
    this.invitations.set(to.id, (this.invitations.get(to.id) ?? 0) + count);
    return Array.from({ length: count }, (_, i) => `invitation-${i + 1}`);
  }
}

function setup(present = new Set(['carts', 'quick_order', 'orders'])) {
  const store = new MemoryRoleStore();
  const catalogue = new OrganizationRoleCatalogue({
    manifests: () => MANIFESTS,
    isModulePresent: (moduleId) => present.has(moduleId),
  });
  /** `customer_accounts`' role Command port: the holders it reports, and the children it builds. */
  const holders = new Map<string, string[]>();
  const accounts = {
    holdersOf: async (_organizationId: string, roleId: string) => holders.get(roleId) ?? [],
    changeRole: (input: { organizationId: string; customerAccountId: string; roleId: string }) => ({
      action: 'customer_account.change_role',
      objectType: 'organization',
      objectId: input.organizationId,
      run: async () => ({ result: { ...input, fromRoleId: 'held', toRoleId: input.roleId } }),
    }),
  };
  const deps = { catalogue, store: () => store, reservedNames: RESERVED, accounts };
  const children: Array<{ action: string; objectId: string; input?: unknown }> = [];
  const ctx: CommandContext = {
    em: {} as EntityManager,
    actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: 'acct', kind: 'customer' },
    run: async <TChild>(child: Command<TChild>): Promise<TChild> => {
      const outcome = await child.run(ctx);
      children.push({ action: child.action, objectId: child.objectId, input: outcome.result });
      return outcome.result;
    },
  };
  const run = <T>(command: Command<T>): Promise<CommandOutcome<T>> => command.run(ctx);
  return { store, deps, run, present, holders, children };
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details?: unknown }> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { statusCode: number; code: string; details?: unknown } | null;
  if (error === null) throw new Error('expected a refusal');
  return error;
}

describe('organization_role.create', () => {
  it('creates a custom role: trimmed name, normalized for comparison, sorted present grants, audited against the Organization', async () => {
    const { deps, run } = setup();
    const command = makeCreateOrganizationRoleCommand(deps, {
      organizationId: ORG,
      name: '  Buyers  ',
      description: 'People who buy',
      permissions: ['orders.view_organization', 'carts.create', 'carts.create'],
    });
    expect(command).toMatchObject({ action: 'organization_role.create', objectType: 'organization', objectId: ORG });
    const outcome = await run(command);
    expect(outcome.result).toMatchObject({
      kind: 'custom',
      name: 'Buyers',
      nameNormalized: 'buyers',
      description: 'People who buy',
      permissions: ['carts.create', 'orders.view_organization'],
      version: 1,
    });
    expect(outcome.before ?? null).toBeNull();
    expect(outcome.after).toEqual({
      role: {
        id: outcome.result.id,
        kind: 'custom',
        name: 'Buyers',
        description: 'People who buy',
        permissions: ['carts.create', 'orders.view_organization'],
      },
    });
    expect(outcome.skipAudit).toBeFalsy();
  });

  it('refuses a name another custom role or a predefined label already uses, in any case and any shipped language (R-29)', async () => {
    const { deps, run, store } = setup();
    store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    for (const name of ['buyers', 'BUYERS', 'member', 'Administrator', 'członek', 'CZŁONEK']) {
      const error = await refusal(run(makeCreateOrganizationRoleCommand(deps, { organizationId: ORG, name, permissions: [] })));
      expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_NAME_TAKEN });
    }
    // Another Organization's custom role does not take the name.
    await expect(
      run(makeCreateOrganizationRoleCommand(deps, { organizationId: OTHER_ORG, name: 'Buyers', permissions: [] })),
    ).resolves.toBeTruthy();
  });

  it(`refuses the ${MAX_CUSTOM_ROLES_PER_ORGANIZATION + 1}st custom role (FR-004)`, async () => {
    const { deps, run, store } = setup();
    expect(MAX_CUSTOM_ROLES_PER_ORGANIZATION).toBe(50);
    for (let i = 0; i < MAX_CUSTOM_ROLES_PER_ORGANIZATION; i += 1) {
      store.seed({ organizationId: ORG, kind: 'custom', name: `Role ${i}`, nameNormalized: `role ${i}` });
    }
    const error = await refusal(run(makeCreateOrganizationRoleCommand(deps, { organizationId: ORG, name: 'One too many', permissions: [] })));
    expect(error).toMatchObject({ statusCode: 422, code: ERROR_CODES.ORGANIZATION_ROLE_LIMIT_REACHED });
  });

  it('refuses a code outside the vocabulary, naming it', async () => {
    const { deps, run } = setup();
    const error = await refusal(
      run(makeCreateOrganizationRoleCommand(deps, { organizationId: ORG, name: 'X', permissions: ['carts.create', 'carts.teleport', 'orders:read'] })),
    );
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ORGANIZATION_PERMISSION_UNKNOWN,
      details: { permissions: ['carts.teleport', 'orders:read'] },
    });
  });

  it('answers 404 for a personal Organization and for one that does not exist', async () => {
    const { deps, run } = setup();
    for (const organizationId of [PERSONAL_ORG, '00000000-0000-4000-8000-0000000000ff']) {
      const error = await refusal(run(makeCreateOrganizationRoleCommand(deps, { organizationId, name: 'X', permissions: [] })));
      expect(error).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    }
  });
});

describe('organization_role.update', () => {
  it('refuses any change to the administrator role (US 6.3)', async () => {
    const { deps, run, store } = setup();
    const admin = store.roleOf(ORG, 'administrator');
    for (const change of [{ permissions: [] }, { name: 'Boss' }, { description: 'x' }]) {
      const error = await refusal(
        run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: admin.id, expectedVersion: 1, ...change })),
      );
      expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_PROTECTED });
    }
  });

  it('refuses renaming or describing the member role, and lets its permissions be edited', async () => {
    const { deps, run, store } = setup();
    const member = store.roleOf(ORG, 'member');
    for (const change of [{ name: 'Staff' }, { description: 'Everyone' }]) {
      const error = await refusal(
        run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: member.id, expectedVersion: 1, ...change })),
      );
      expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_PROTECTED });
    }
    const outcome = await run(
      makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: member.id, expectedVersion: 1, permissions: ['carts.create'] }),
    );
    expect(outcome.result.version).toBe(2);
  });

  it('refuses a stale expectedVersion (R-29)', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers', version: 3 });
    const error = await refusal(
      run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 2, permissions: [] })),
    );
    expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_STALE });
  });

  it("answers 404 for another Organization's role (FR-005)", async () => {
    const { deps, run, store } = setup();
    const foreign = store.seed({ organizationId: OTHER_ORG, kind: 'custom', name: 'Theirs', nameNormalized: 'theirs' });
    const error = await refusal(
      run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: foreign.id, expectedVersion: 1, permissions: [] })),
    );
    expect(error).toMatchObject({ statusCode: 404 });
  });

  it('keeps a switched-off module’s grant, drops an undeclared code, bumps the version and emits added/removed (FR-025)', async () => {
    const { deps, run, store, present } = setup();
    present.delete('quick_order');
    const role = store.seed({
      organizationId: ORG,
      kind: 'custom',
      name: 'Buyers',
      nameNormalized: 'buyers',
      permissions: ['carts.create', 'legacy.gone', 'quick_order.one_click'],
    });
    const command = makeUpdateOrganizationRoleCommand(deps, {
      organizationId: ORG,
      roleId: role.id,
      expectedVersion: 1,
      permissions: ['carts.approve'],
    });
    const outcome = await run(command);
    expect(outcome.result.permissions).toEqual(['carts.approve', 'quick_order.one_click']);
    expect(outcome.result.version).toBe(2);
    expect(outcome.before).toEqual({
      role: {
        id: role.id,
        kind: 'custom',
        name: 'Buyers',
        description: null,
        permissions: ['carts.create', 'legacy.gone', 'quick_order.one_click'],
      },
    });
    expect(outcome.after).toMatchObject({ role: { permissions: ['carts.approve', 'quick_order.one_click'] } });
    const event = command.event?.(outcome.result);
    expect(event?.eventName).toBe('organization_role.permissions_changed.v1');
    expect(event?.payload).toMatchObject({
      organizationId: ORG,
      roleId: role.id,
      added: ['carts.approve'],
      removed: ['carts.create', 'legacy.gone'],
    });
  });

  it('Member: a save offers every member default, so an un-ticked one is not granted again (FR-023, R-17)', async () => {
    const { deps, run, store } = setup();
    const member = store.roleOf(ORG, 'member');
    const outcome = await run(
      makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: member.id, expectedVersion: 1, permissions: ['quick_order.one_click'] }),
    );
    expect(outcome.result.permissions).toEqual(['quick_order.one_click']);
    expect(outcome.result.memberDefaultsOffered).toEqual(['carts.create', 'quick_order.one_click']);
    expect(outcome.before).toMatchObject({ role: { permissions: ['carts.create', 'quick_order.one_click'] } });
  });

  it('an equal save is skipAudit, bumps nothing and emits nothing (FR-065)', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({
      organizationId: ORG,
      kind: 'custom',
      name: 'Buyers',
      nameNormalized: 'buyers',
      description: 'Desc',
      permissions: ['carts.create'],
    });
    const command = makeUpdateOrganizationRoleCommand(deps, {
      organizationId: ORG,
      roleId: role.id,
      expectedVersion: 1,
      name: 'Buyers',
      description: 'Desc',
      permissions: ['carts.create'],
    });
    const outcome = await run(command);
    expect(outcome.skipAudit).toBe(true);
    expect(outcome.result.version).toBe(1);
    expect(command.event?.(outcome.result)).toBeUndefined();

    // The Member role with nothing stored, saved with exactly what it holds, is equal too.
    const member = store.roleOf(ORG, 'member');
    const memberOutcome = await run(
      makeUpdateOrganizationRoleCommand(deps, {
        organizationId: ORG,
        roleId: member.id,
        expectedVersion: 1,
        permissions: ['carts.create', 'quick_order.one_click'],
      }),
    );
    expect(memberOutcome.skipAudit).toBe(true);
  });

  it('a rename that changes only case is the same role; a rename onto another role’s name is refused', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    store.seed({ organizationId: ORG, kind: 'custom', name: 'Sellers', nameNormalized: 'sellers' });
    const renamed = await run(
      makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1, name: 'BUYERS' }),
    );
    expect(renamed.result).toMatchObject({ name: 'BUYERS', nameNormalized: 'buyers', version: 2 });
    const error = await refusal(
      run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 2, name: ' sellers ' })),
    );
    expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_NAME_TAKEN });
  });

  it('refuses a code outside the vocabulary', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    const error = await refusal(
      run(makeUpdateOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1, permissions: ['nope.nope'] })),
    );
    expect(error).toMatchObject({ statusCode: 422, code: ERROR_CODES.ORGANIZATION_PERMISSION_UNKNOWN });
  });
});

describe('organization_role.delete', () => {
  it('refuses deleting a predefined role', async () => {
    const { deps, run, store } = setup();
    for (const kind of ['administrator', 'member'] as const) {
      const error = await refusal(
        run(makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: store.roleOf(ORG, kind).id, expectedVersion: 1 })),
      );
      expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_PROTECTED });
    }
  });

  it('deletes a role nobody holds without a replacement, audited with its last state', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers', permissions: ['carts.create'] });
    const outcome = await run(makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1 }));
    expect(outcome.result).toEqual({ reassignedMembers: 0, reassignedInvitations: 0 });
    expect(store.rows.has(role.id)).toBe(false);
    expect(outcome.before).toEqual({
      role: { id: role.id, kind: 'custom', name: 'Buyers', description: null, permissions: ['carts.create'] },
      memberCount: 0,
      invitationCount: 0,
    });
    expect(outcome.after).toEqual({ deletedRoleId: role.id, replacementRoleId: null, reassignedInvitations: [] });
  });

  it('refuses a held role without a replacement (FR-024)', async () => {
    const { deps, run, store, holders } = setup();
    const byInvitation = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    store.invitations.set(byInvitation.id, 1);
    const byMember = store.seed({ organizationId: ORG, kind: 'custom', name: 'Sellers', nameNormalized: 'sellers' });
    holders.set(byMember.id, ['account-1']);
    for (const role of [byInvitation, byMember]) {
      const error = await refusal(run(makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1 })));
      expect(error).toMatchObject({ statusCode: 422, code: ERROR_CODES.ORGANIZATION_ROLE_REPLACEMENT_REQUIRED });
      expect(store.rows.has(role.id)).toBe(true);
    }
  });

  it('moves every holder to the replacement — one change_role child per account, the invitations with them (R-22, FR-065)', async () => {
    const { deps, run, store, holders, children } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    const member = store.roleOf(ORG, 'member');
    holders.set(role.id, ['account-1', 'account-2', 'account-3']);
    store.invitations.set(role.id, 2);
    const outcome = await run(
      makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1, replacementRoleId: member.id }),
    );
    expect(outcome.result).toEqual({ reassignedMembers: 3, reassignedInvitations: 2 });
    expect(children.map((c) => [c.action, c.objectId])).toEqual([
      ['customer_account.change_role', ORG],
      ['customer_account.change_role', ORG],
      ['customer_account.change_role', ORG],
    ]);
    expect(children.map((c) => (c.input as { customerAccountId: string; toRoleId: string }).customerAccountId)).toEqual([
      'account-1',
      'account-2',
      'account-3',
    ]);
    expect(store.rows.has(role.id)).toBe(false);
    expect(store.invitations.get(member.id)).toBe(2);
    expect(outcome.before).toMatchObject({ memberCount: 3, invitationCount: 2 });
    expect(outcome.after).toEqual({
      deletedRoleId: role.id,
      replacementRoleId: member.id,
      reassignedInvitations: ['invitation-1', 'invitation-2'],
    });
  });

  it('refuses a replacement equal to the deleted role, and one of another Organization', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers' });
    const self = await refusal(
      run(makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1, replacementRoleId: role.id })),
    );
    expect(self).toMatchObject({ statusCode: 422, code: ERROR_CODES.ORGANIZATION_ROLE_REPLACEMENT_REQUIRED });
    const foreign = await refusal(
      run(
        makeDeleteOrganizationRoleCommand(deps, {
          organizationId: ORG,
          roleId: role.id,
          expectedVersion: 1,
          replacementRoleId: store.roleOf(OTHER_ORG, 'member').id,
        }),
      ),
    );
    expect(foreign).toMatchObject({ statusCode: 404 });
  });

  it('refuses a stale expectedVersion', async () => {
    const { deps, run, store } = setup();
    const role = store.seed({ organizationId: ORG, kind: 'custom', name: 'Buyers', nameNormalized: 'buyers', version: 2 });
    const error = await refusal(run(makeDeleteOrganizationRoleCommand(deps, { organizationId: ORG, roleId: role.id, expectedVersion: 1 })));
    expect(error).toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_ROLE_STALE });
  });
});
