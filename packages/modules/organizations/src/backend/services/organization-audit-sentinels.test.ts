/**
 * The audit-state rule for organizations (`specs/conventions/audit-state.md`
 * §6, D-288, issue #470, owner rulings O-1 and O-2): every entry this module
 * writes carries **names and structure**, never a value — not an
 * Organization's name, legal name, tax id, address, reasons or custom-field
 * values, not a member's e-mail or names, not a custom role's name or
 * description, and not the tenant anchor.
 *
 * The Commands run through the **real** `CommandBus` over an in-memory
 * EntityManager with a recording audit port. The writes that are not Commands
 * (moderation, the invitation accept) record through the
 * audit port as they always have, and are held to the same sentinels. The
 * admin route writes (`organization.delete`, the `customer_account.admin_*`
 * member writes) record the state the snapshot helpers build, so the helpers
 * are what is checked here; the contract tests read the stored row.
 *
 * `organization.admin_patch` has its own file
 * (`commands/admin-patch-organization.command.test.ts`, #1039).
 */
import { AssertionError } from 'node:assert';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type {
  AdminOrganizationCreateBody,
  CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { makeConvertToCompanyCommand } from '../commands/convert-to-company.command.js';
import { makeCreateOrganizationCommand } from '../commands/create-organization.command.js';
import { makeCreateOrganizationInvitationCommand } from '../commands/organization-invitation-create.command.js';
import { makeRevokeOrganizationInvitationCommand } from '../commands/organization-invitation-revoke.command.js';
import { makeCreateOrganizationRoleCommand } from '../commands/organization-role-create.command.js';
import { makeDeleteOrganizationRoleCommand } from '../commands/organization-role-delete.command.js';
import { makeUpdateOrganizationRoleCommand } from '../commands/organization-role-update.command.js';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { InvitationService } from './invitation-service.js';
import {
  ORGANIZATION_AUDIT_KEYS,
  memberAuditState,
  memberCreatedAuditState,
  memberUpdatedAuditState,
  organizationDeletedAuditState,
} from './organization-audit-state.js';
import { OrganizationModerationService } from './organization-moderation-service.js';
import { OrganizationRoleCatalogue } from './organization-role-catalogue.js';
import type { NewOrganizationRole, OrganizationRoleRow, OrganizationRoleStore } from './organization-role-store.js';
import type { OrganizationEventBus } from './registration-service.js';

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit`, as the other modules' sentinel tests keep
// it: this package does not depend on the test kit.
// ---------------------------------------------------------------------------
type Sentinel = string | number;
type Entry = Record<string, unknown>;

function expectNoAuditValues(entries: readonly Entry[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
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
    walk(entry['stateBefore'], `[${index}] ${String(entry['action'])} stateBefore`);
    walk(entry['stateAfter'], `[${index}] ${String(entry['action'])} stateAfter`);
  });
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}

/** Every top-level key of every recorded state, and of a nested `role` snapshot, is classified. */
function expectClassifiedKeys(entries: readonly Entry[]): void {
  const keys: string[] = [];
  for (const entry of entries) {
    for (const state of [entry['stateBefore'], entry['stateAfter']]) {
      if (state === null || state === undefined) continue;
      const record = state as Record<string, unknown>;
      keys.push(...Object.keys(record));
      if (record['role'] && typeof record['role'] === 'object') keys.push(...Object.keys(record['role'] as object));
    }
  }
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) expect(ORGANIZATION_AUDIT_KEYS.has(key), key).toBe(true);
}
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-4000-8000-0000000470b1';
const PARENT = '00000000-0000-4000-8000-0000000470b2';
const CHANNEL = '00000000-0000-4000-8000-0000000470b3';
const ACCOUNT = '00000000-0000-4000-8000-0000000470b4';
const ADMIN_ROLE = '00000000-0000-4000-8000-0000000470b5';
const MEMBER_ROLE = '00000000-0000-4000-8000-0000000470b6';
const INVITATION = '00000000-0000-4000-8000-0000000470b7';
const ADMIN = '00000000-0000-4000-8000-0000000470b8';

const S = {
  name: 'S470-NAME',
  newName: 'S470-RENAMED',
  legalName: 'S470-LEGAL',
  taxId: 'S470TAXID47',
  street: 'S470-STREET',
  city: 'S470-CITY',
  email: 's470@example.test',
  newEmail: 's470-new@example.test',
  firstName: 'S470-FIRST',
  lastName: 'S470-LAST',
  blockedReason: 'S470-BLOCK-REASON',
  rejectedReason: 'S470-REJECT-REASON',
  customField: 'S470-CF',
  roleName: 'S470-TITLE',
  roleDescription: 'S470-DESC',
} as const;

/** The org's own id is the tenant anchor: it may be the entry's `objectId`, never part of its state. */
const SENTINELS: readonly Sentinel[] = [...Object.values(S), ORG];

const asSystem = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('organizations unit test: audit sentinels', fn);

function recordingAudit(): { audits: Entry[]; audit: AuditPort } {
  const audits: Entry[] = [];
  const audit = {
    recordWithin(_em: EntityManager, input: Entry) {
      audits.push(input);
      return {} as never;
    },
    async record(input: Entry) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  return { audits, audit };
}

/** A bus over a fake ORM whose transaction is `em` itself. */
function busOver(em: Record<string, unknown>, audit: AuditPort): CommandBus {
  em['transactional'] = async <T>(cb: (em: EntityManager) => Promise<T>): Promise<T> => cb(em as unknown as EntityManager);
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  return new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>());
}

function sentinelOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: ORG,
    name: S.name,
    legalName: S.legalName,
    taxId: S.taxId,
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: S.street, city: S.city, postalCode: '47-047', country: 'PL' },
    orderConfirmationEmails: [S.email],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: PARENT,
    path: `/${PARENT}/${ORG}/`,
    version: 4,
    blockedReason: S.blockedReason,
    blockedAt: null,
    rejectedReason: S.rejectedReason,
    rejectedAt: null,
    approvedAt: null,
    customFieldValues: { tier: S.customField },
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as unknown as Organization;
}

function sentinelMember(overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: ACCOUNT,
    organizationId: ORG,
    email: S.email,
    firstName: S.firstName,
    lastName: S.lastName,
    organizationRoleId: MEMBER_ROLE,
    emailVerifiedAt: new Date('2026-10-02T00:00:00Z'),
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    customFieldValues: { phone: S.customField },
    deletedAt: null,
    subtreeRollupEnabled: false,
    ...overrides,
  } as CustomerAccountRecord;
}

// ---------------------------------------------------------------------------
// Organization lifecycle
// ---------------------------------------------------------------------------

describe('organization.create — audit state (D-288, O-2)', () => {
  it('names the fields it was created with, keeps codes and ids, records no value', async () => {
    const { audits, audit } = recordingAudit();
    const parent = sentinelOrganization({ id: PARENT, path: `/${PARENT}/`, parentId: null, name: `${S.name}-PARENT` });
    const em: Record<string, unknown> = {
      findOne: async (_entity: unknown, where: { id: string }) => (where.id === PARENT ? parent : null),
      execute: async () => [],
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      flush: async () => {},
    };
    const bus = busOver(em, audit);
    const input = {
      name: S.name,
      taxId: S.taxId,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: S.street, city: S.city, postalCode: '47-047', country: 'PL' },
      salesChannelIds: [CHANNEL],
      parentId: PARENT,
      customFieldValues: { tier: S.customField },
    } as unknown as AdminOrganizationCreateBody;

    await asSystem(() =>
      bus.run(
        makeCreateOrganizationCommand(
          {
            membership: { replaceChannelsForEntity: async () => ({}) as never },
            tree: { assertMaxDepth: async () => {} },
            customFieldValues: { validateAndMerge: async (_t, _c, values) => ({ ...values }) },
          },
          input,
        ),
      ),
    );

    expectNoAuditValues(audits, SENTINELS);
    expectClassifiedKeys(audits);
    expect(audits[0]).toMatchObject({
      action: 'organization.create',
      stateBefore: null,
      stateAfter: {
        status: 'active',
        vatStatus: 'vat_payer',
        salesChannelIds: [CHANNEL],
        parentId: PARENT,
        changedFields: ['name', 'registeredAddress', 'taxId'],
        changedCustomFields: ['tier'],
      },
    });
  });
});

// `organization.register` is a Command since `specs/176-command-hooks-outbox/`
// P1: its sentinel case is `commands/register-organization.audit.test.ts`.

describe('organization.delete — audit state (D-288, O-2)', () => {
  it('records codes, the parent id and the version, and no value', () => {
    const state = organizationDeletedAuditState(sentinelOrganization({ status: 'blocked', blockedAt: new Date() }));
    const entries = [{ action: 'organization.delete', stateBefore: state, stateAfter: null }];
    expectNoAuditValues(entries, SENTINELS);
    expectClassifiedKeys(entries);
    expect(state).toEqual({ status: 'blocked', vatStatus: 'vat_payer', isPersonal: false, parentId: PARENT, version: 4 });
  });
});

describe('organization.approved|rejected|blocked|unblocked — audit state (D-288, O-2)', () => {
  function moderation(org: Organization) {
    const { audits, audit } = recordingAudit();
    const em = {
      findOne: async (_entity: unknown, where: { id: string }) => (where.id === ORG ? org : null),
      flush: async () => {
        org.version += 1;
      },
      transactional: async <T>(cb: (em: EntityManager) => Promise<T>): Promise<T> => cb(em as unknown as EntityManager),
    } as unknown as EntityManager;
    const service = new OrganizationModerationService(
      () => em,
      audit,
      { emit: vi.fn() } as unknown as OrganizationEventBus,
      { send: async () => ({ messageId: 'm' }) } as never,
      { listByOrganization: async () => [] } as never,
      async () => 'manual',
    );
    return { service, audits };
  }

  it('records whether a reason was given, never the reason', async () => {
    const pending = moderation(sentinelOrganization({ status: 'pending_verification', blockedReason: null, rejectedReason: null }));
    await pending.service.reject(ORG, { expectedVersion: 4, reason: S.rejectedReason, notifyCustomerEmail: false });

    const active = moderation(sentinelOrganization({ status: 'active', rejectedReason: null, blockedReason: null }));
    await active.service.block(ORG, { expectedVersion: 4, reason: S.blockedReason });

    const blocked = moderation(sentinelOrganization({ status: 'blocked', blockedAt: new Date(), rejectedReason: null }));
    await blocked.service.unblock(ORG, { expectedVersion: 4 });

    const approvable = moderation(sentinelOrganization({ status: 'pending_verification', blockedReason: null, rejectedReason: null }));
    await approvable.service.approve(ORG, { expectedVersion: 4, actorAdminUserId: ADMIN });

    const entries = [...pending.audits, ...active.audits, ...blocked.audits, ...approvable.audits];
    expect(entries.map((entry) => entry['action'])).toEqual([
      'organization.rejected',
      'organization.blocked',
      'organization.unblocked',
      'organization.approved',
    ]);
    expectNoAuditValues(entries, SENTINELS);
    expectClassifiedKeys(entries);
    expect(entries[0]).toMatchObject({
      stateBefore: { status: 'pending_verification', hasRejectedReason: false },
      stateAfter: { status: 'rejected', hasRejectedReason: true },
    });
    expect(entries[1]).toMatchObject({ stateAfter: { status: 'blocked', hasBlockedReason: true } });
    expect(entries[2]).toMatchObject({
      stateBefore: { status: 'blocked', hasBlockedReason: true },
      stateAfter: { status: 'active', hasBlockedReason: false },
    });
    expect(entries[3]).toMatchObject({ stateAfter: { status: 'active', approvedByAdminUserId: ADMIN } });
  });
});

describe('organization.convert_to_company — audit state (177, D-288)', () => {
  it('names the converted fields and records no value', async () => {
    const { audits, audit } = recordingAudit();
    const org = sentinelOrganization({
      isPersonal: true,
      taxId: null,
      name: `${S.name}-PERSONAL`,
      path: `/${ORG}/`,
      parentId: null,
    } as Partial<Organization>);
    const em: Record<string, unknown> = {
      execute: async (sql: string) => (sql.includes('for update') && sql.includes('"organizations"') ? [{ id: ORG }] : []),
      findOne: async (entity: unknown) => (entity === Organization ? org : entity === OrganizationRole ? { id: ADMIN_ROLE } : null),
      flush: async () => {},
    };
    const bus = busOver(em, audit);
    await asSystem(() =>
      bus.run(
        makeConvertToCompanyCommand(
          { accounts: { listByOrganization: async () => [sentinelMember({ organizationRoleId: ADMIN_ROLE })] } },
          {
            organizationId: ORG,
            input: {
              name: S.newName,
              legalName: S.legalName,
              taxId: S.taxId,
              vatStatus: 'vat_payer',
              registeredAddress: { street: `${S.street}-2`, city: S.city, postalCode: '47-047', country: 'PL' },
            } as never,
          },
        ),
      ),
    );
    expectNoAuditValues(audits, SENTINELS);
    expectClassifiedKeys(audits);
    expect(audits[0]).toMatchObject({ action: 'organization.convert_to_company', stateBefore: { isPersonal: true } });
  });
});

// ---------------------------------------------------------------------------
// Members (admin routes) — the snapshots `routes.admin.ts` records
// ---------------------------------------------------------------------------

describe('customer_account.admin_* — audit state (D-288)', () => {
  it('admin_create: names the fields the member was created with, its role by id, no e-mail and no Organization', () => {
    const state = memberCreatedAuditState(sentinelMember({ emailVerifiedAt: null }), ['phone']);
    const entries = [{ action: 'customer_account.admin_create', stateBefore: null, stateAfter: state }];
    expectNoAuditValues(entries, SENTINELS);
    expectClassifiedKeys(entries);
    expect(state).toEqual({
      changedFields: ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId'],
      organizationRoleId: MEMBER_ROLE,
      emailVerified: false,
      changedCustomFields: ['phone'],
    });
  });

  it('admin_profile_update / admin_rollup_change: ids, booleans and the names of what changed', () => {
    const before = sentinelMember();
    const profile = memberUpdatedAuditState(
      before,
      sentinelMember({ email: S.newEmail, lastName: `${S.lastName}-2`, emailVerifiedAt: null }),
    );
    const rollup = memberUpdatedAuditState(before, sentinelMember({ subtreeRollupEnabled: true }));
    const entries = [
      { action: 'customer_account.admin_profile_update', stateBefore: profile.before, stateAfter: profile.after },
      { action: 'customer_account.admin_rollup_change', stateBefore: rollup.before, stateAfter: rollup.after },
    ];
    expectNoAuditValues(entries, SENTINELS);
    expectClassifiedKeys(entries);
    expect(profile.after).toMatchObject({ emailVerified: false, changedFields: ['email', 'emailVerified', 'lastName'] });
    expect(rollup).toEqual({
      before: { organizationRoleId: MEMBER_ROLE, subtreeRollupEnabled: false, emailVerified: true, twoFactorEnabled: false },
      after: {
        organizationRoleId: MEMBER_ROLE,
        subtreeRollupEnabled: true,
        emailVerified: true,
        twoFactorEnabled: false,
        changedFields: ['subtreeRollupEnabled'],
      },
    });
  });

  it('admin_remove: the member by role id and flags, no e-mail or names', () => {
    const entries = [{ action: 'customer_account.admin_remove', stateBefore: memberAuditState(sentinelMember()), stateAfter: null }];
    expectNoAuditValues(entries, SENTINELS);
    expectClassifiedKeys(entries);
  });
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

describe('organization_invitation.create|revoke and organization.invite_accept — audit state (D-288)', () => {
  const customRole = {
    id: MEMBER_ROLE,
    organizationId: ORG,
    kind: 'custom' as const,
    name: S.roleName,
    description: S.roleDescription,
  };

  it('create and revoke record the invitation id and the role by id and kind — no address, no role name', async () => {
    const { audits, audit } = recordingAudit();
    const invitation = { id: INVITATION, organizationId: ORG, email: S.email, organizationRoleId: MEMBER_ROLE } as Record<string, unknown>;
    const em: Record<string, unknown> = {
      findOne: async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === OrganizationRole) return where['kind'] === 'administrator' ? { id: ADMIN_ROLE } : customRole;
        if (entity === OrganizationInvitation) return invitation;
        return null;
      },
      create: (_entity: unknown, data: Record<string, unknown>) => Object.assign(invitation, data),
      persistAndFlush: async () => {},
      flush: async () => {},
      count: async () => 0,
    };
    const bus = busOver(em, audit);
    await asSystem(() =>
      bus.run(
        makeCreateOrganizationInvitationCommand({
          organizationId: ORG,
          invitedByCustomerAccountId: ACCOUNT,
          email: S.email,
          roleId: MEMBER_ROLE,
          tokenHash: 'hash',
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    );
    await asSystem(() =>
      bus.run(
        makeRevokeOrganizationInvitationCommand(
          { accounts: { countAdministrators: async () => 1 } },
          { organizationId: ORG, invitationId: INVITATION },
        ),
      ),
    );

    expectNoAuditValues(audits, SENTINELS);
    expectClassifiedKeys(audits);
    expect(audits[0]).toMatchObject({
      action: 'organization_invitation.create',
      stateAfter: { invitationId: INVITATION, role: { id: MEMBER_ROLE, kind: 'custom' } },
    });
    expect(audits[1]).toMatchObject({
      action: 'organization_invitation.revoke',
      stateBefore: { invitationId: INVITATION, role: { id: MEMBER_ROLE, kind: 'custom' } },
    });
  });

  it('invite_accept records the account and the role by id — no address', async () => {
    const { audits, audit } = recordingAudit();
    const invitation = {
      id: INVITATION,
      organizationId: ORG,
      email: S.email,
      organizationRoleId: MEMBER_ROLE,
      consumedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    const em = {
      findOne: async (entity: unknown) =>
        entity === OrganizationInvitation ? invitation : entity === Organization ? sentinelOrganization() : null,
      flush: async () => {},
    } as unknown as EntityManager;
    const service = new InvitationService({
      emFactory: () => em,
      accounts: {
        read: { findByEmail: async () => null },
        write: { create: async () => sentinelMember() },
      } as never,
      commandBus: { run: async () => undefined as never },
      auditLog: audit,
    });
    await service.acceptByToken('token', { password: 'correct horse battery staple', firstName: S.firstName, lastName: S.lastName });

    expectNoAuditValues(audits, SENTINELS);
    expectClassifiedKeys(audits);
    expect(audits[0]).toMatchObject({
      action: 'organization.invite_accept',
      stateAfter: { organizationRoleId: MEMBER_ROLE, customerAccountId: ACCOUNT },
    });
  });
});

// ---------------------------------------------------------------------------
// Custom roles (architect ruling, #470)
// ---------------------------------------------------------------------------

describe('organization_role.create|update|delete — audit state (D-288, O-1)', () => {
  function roleHarness() {
    const rows = new Map<string, OrganizationRoleRow>();
    const seed = (values: Partial<OrganizationRoleRow> & Pick<OrganizationRoleRow, 'id' | 'kind'>): OrganizationRoleRow => {
      const row: OrganizationRoleRow = {
        organizationId: ORG,
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
      rows.set(row.id, row);
      return row;
    };
    seed({ id: ADMIN_ROLE, kind: 'administrator' });
    seed({ id: MEMBER_ROLE, kind: 'member' });
    let next = 0;
    const store: OrganizationRoleStore = {
      lockOrganization: async () => ({ isPersonal: false }),
      lock: async (_organizationId, roleId) => rows.get(roleId) ?? null,
      listInOrganization: async () => [...rows.values()],
      create: async (values: NewOrganizationRole) =>
        seed({ ...values, id: `00000000-0000-4000-8000-00000047c${String(next++).padStart(3, '0')}`, kind: 'custom' }),
      save: async (row) => {
        rows.set(row.id, row);
      },
      remove: async (row) => {
        rows.delete(row.id);
      },
      countInvitations: async () => 0,
      moveInvitations: async () => [],
    };
    const catalogue = new OrganizationRoleCatalogue({
      manifests: () => [
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
      ],
      isModulePresent: () => true,
    });
    const { audits, audit } = recordingAudit();
    const bus = busOver({}, audit);
    const deps = { catalogue, store: () => store, reservedNames: ['Administrator', 'Member'] };
    const accounts = {
      holdersOf: async () => [],
      changeRole: () => {
        throw new Error('no holder to move');
      },
    };
    return { bus, deps, accounts, audits };
  }

  it('records the role by id, kind and permission codes, and the names of what changed — never its name or description', async () => {
    const h = roleHarness();
    const role = await asSystem(() =>
      h.bus.run(
        makeCreateOrganizationRoleCommand(h.deps, {
          organizationId: ORG,
          name: S.roleName,
          description: S.roleDescription,
          permissions: ['carts.create'],
        }),
      ),
    );
    await asSystem(() =>
      h.bus.run(
        makeUpdateOrganizationRoleCommand(h.deps, {
          organizationId: ORG,
          roleId: role.id,
          expectedVersion: 1,
          name: `${S.roleName}-2`,
          description: `${S.roleDescription}-2`,
          permissions: ['carts.approve'],
        }),
      ),
    );
    await asSystem(() =>
      h.bus.run(
        makeDeleteOrganizationRoleCommand(
          { ...h.deps, accounts: h.accounts as never },
          { organizationId: ORG, roleId: role.id, expectedVersion: 2 },
        ),
      ),
    );

    expectNoAuditValues(h.audits, SENTINELS);
    expectClassifiedKeys(h.audits);
    expect(h.audits.map((entry) => entry['action'])).toEqual([
      'organization_role.create',
      'organization_role.update',
      'organization_role.delete',
    ]);
    expect(h.audits[0]).toMatchObject({
      stateBefore: null,
      stateAfter: { role: { id: role.id, kind: 'custom', permissions: ['carts.create'] } },
    });
    expect(h.audits[1]).toMatchObject({
      stateBefore: { role: { id: role.id, kind: 'custom', permissions: ['carts.create'] } },
      stateAfter: {
        role: { id: role.id, kind: 'custom', permissions: ['carts.approve'] },
        changedFields: ['description', 'name', 'permissions'],
      },
    });
    expect(h.audits[2]).toMatchObject({
      stateBefore: { role: { id: role.id, kind: 'custom', permissions: ['carts.approve'] } },
      stateAfter: { deletedRoleId: role.id, replacementRoleId: null, reassignedInvitations: [] },
    });
  });

  it('an update that changes only the permissions names only them', async () => {
    const h = roleHarness();
    const role = await asSystem(() =>
      h.bus.run(
        makeCreateOrganizationRoleCommand(h.deps, { organizationId: ORG, name: S.roleName, permissions: ['carts.create'] }),
      ),
    );
    await asSystem(() =>
      h.bus.run(
        makeUpdateOrganizationRoleCommand(h.deps, {
          organizationId: ORG,
          roleId: role.id,
          expectedVersion: 1,
          name: S.roleName,
          permissions: ['carts.create', 'carts.approve'],
        }),
      ),
    );
    expectNoAuditValues(h.audits, SENTINELS);
    expect(h.audits[1]).toMatchObject({ stateAfter: { changedFields: ['permissions'] } });
  });
});
