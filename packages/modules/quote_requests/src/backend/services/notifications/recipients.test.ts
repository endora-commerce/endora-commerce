import { describe, expect, it, vi } from 'vitest';
import type { AdminUserRecord, CustomerAccountRecord } from '@endora-commerce/contracts';
import { createRecipientResolver, orgWideViewerRoleIds, type RecipientResolverDeps } from './recipients.js';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-03 (T020, T021) — who stands
 * on each side of a quote request when a change commits.
 *
 * Customer side (research R-3, FR-004): the requester and every member of the
 * request's Organization who may open it — the same rule the storefront's
 * visibility check applies, so nobody is told about a request they get a 404
 * for. Operator side (research R-5, FR-005): the assignee and the
 * Organization's assigned representatives holding `rfqs:handle`, else every
 * active administrator holding it (owner ruling Q6).
 */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const PERSONAL_ORG = '00000000-0000-4000-8000-0000000000a2';
const RFQ = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_ROLE = '00000000-0000-4000-8000-0000000000f1';
const MEMBER_ROLE = '00000000-0000-4000-8000-0000000000f2';
const CUSTOM_ROLE = '00000000-0000-4000-8000-0000000000f3';

const REQUESTER = '00000000-0000-4000-8000-0000000000c1';
const ORG_ADMIN = '00000000-0000-4000-8000-0000000000c2';
const MEMBER = '00000000-0000-4000-8000-0000000000c3';
const BLOCKED_ADMIN = '00000000-0000-4000-8000-0000000000c4';
const DELETED_ADMIN = '00000000-0000-4000-8000-0000000000c5';
const ANONYMISED_ADMIN = '00000000-0000-4000-8000-0000000000c6';
const CUSTOM_ROLE_MEMBER = '00000000-0000-4000-8000-0000000000c7';

const ASSIGNEE = '00000000-0000-4000-8000-0000000000d1';
const REP = '00000000-0000-4000-8000-0000000000d2';
const REP_WITHOUT_HANDLE = '00000000-0000-4000-8000-0000000000d3';
const INACTIVE_REP = '00000000-0000-4000-8000-0000000000d4';
const PLATFORM_ADMIN = '00000000-0000-4000-8000-0000000000d5';
const SALES_ADMIN = '00000000-0000-4000-8000-0000000000d6';
const SUPPORT_ADMIN = '00000000-0000-4000-8000-0000000000d7';

function account(id: string, organizationRoleId: string, overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id,
    organizationId: ORG,
    email: `${id}@example.test`,
    firstName: 'F',
    lastName: 'L',
    organizationRoleId,
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    customFieldValues: {},
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function admin(id: string, overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id,
    email: `${id}@example.test`,
    firstName: 'A',
    lastName: 'B',
    adminRoleId: 'role',
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    avatarAssetId: null,
    bio: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

const ORG_MEMBERS: CustomerAccountRecord[] = [
  account(ORG_ADMIN, ADMIN_ROLE),
  account(BLOCKED_ADMIN, ADMIN_ROLE, { blockedAt: new Date('2026-02-01T00:00:00.000Z') }),
  account(DELETED_ADMIN, ADMIN_ROLE, { deletedAt: new Date('2026-02-01T00:00:00.000Z') }),
  account(ANONYMISED_ADMIN, ADMIN_ROLE, { anonymizedAt: new Date('2026-02-01T00:00:00.000Z') }),
  account(REQUESTER, MEMBER_ROLE),
  // Holds `quote_requests.create` like every Member, and still may not open a colleague's request.
  account(MEMBER, MEMBER_ROLE),
  account(CUSTOM_ROLE_MEMBER, CUSTOM_ROLE),
];

const ADMINS: AdminUserRecord[] = [
  admin(ASSIGNEE),
  admin(REP),
  admin(REP_WITHOUT_HANDLE),
  admin(INACTIVE_REP, { status: 'inactive' }),
  admin(PLATFORM_ADMIN),
  admin(SALES_ADMIN),
  admin(SUPPORT_ADMIN),
];

const PERMISSIONS: Record<string, string[]> = {
  [ASSIGNEE]: ['rfqs:handle'],
  [REP]: ['rfqs:handle', 'orders:read'],
  [REP_WITHOUT_HANDLE]: ['orders:read'],
  [INACTIVE_REP]: ['rfqs:handle'],
  [PLATFORM_ADMIN]: ['*'],
  [SALES_ADMIN]: ['rfqs:handle'],
  [SUPPORT_ADMIN]: ['orders:read', 'customers:read'],
};

function rig(options: { members?: CustomerAccountRecord[]; assignments?: string[]; admins?: AdminUserRecord[] } = {}) {
  const members = options.members ?? ORG_MEMBERS;
  const admins = options.admins ?? ADMINS;
  const viewerRoles = vi.fn(async (organizationId: string) => (organizationId === ORG ? [ADMIN_ROLE] : ['personal-admin']));
  const deps = {
    orgWideViewerRoleIds: viewerRoles,
    customerAccounts: {
      listByOrganization: vi.fn(async (organizationId: string, opts?: { activeOnly?: boolean }) =>
        members.filter((m) => m.organizationId === organizationId && (!opts?.activeOnly || m.deletedAt === null)),
      ),
    },
    salesRepAssignment: {
      listForOrganization: vi.fn(async () =>
        (options.assignments ?? []).map((adminUserId) => ({ id: adminUserId, organizationId: ORG, adminUserId, createdAt: new Date(0) })),
      ),
    },
    adminUsers: {
      findByIds: vi.fn(async (ids: readonly string[], opts?: { activeOnly?: boolean }) =>
        admins.filter((a) => ids.includes(a.id) && (!opts?.activeOnly || a.deletedAt === null)),
      ),
      listAll: vi.fn(async (opts?: { activeOnly?: boolean }) =>
        admins.filter((a) => !opts?.activeOnly || a.deletedAt === null),
      ),
    },
    permissions: { listPermissions: vi.fn(async (id: string) => PERMISSIONS[id] ?? []) },
  } satisfies RecipientResolverDeps;
  return { resolver: createRecipientResolver(deps as unknown as RecipientResolverDeps), deps };
}

const rfq = (overrides: { organizationId?: string; customerAccountId?: string; assignedAdminUserId?: string | null } = {}) => ({
  id: RFQ,
  organizationId: ORG,
  customerAccountId: REQUESTER,
  assignedAdminUserId: null,
  ...overrides,
});

describe('orgWideViewerRoleIds — the roles that see every quote request of an Organization', () => {
  it('is, until 170 P3, the Organization’s predefined Administrator role', async () => {
    const predefinedRoleId = vi.fn(async () => ADMIN_ROLE);
    await expect(orgWideViewerRoleIds({ predefinedRoleId }, ORG)).resolves.toEqual([ADMIN_ROLE]);
    expect(predefinedRoleId).toHaveBeenCalledWith(ORG, 'administrator');
  });
});

describe('customer side (T020, FR-004) — the requester and the members who may open the request', () => {
  it('the requester first, then each live Administrator member; a Member is not told', async () => {
    const { resolver, deps } = rig();
    await expect(resolver.customerSide(rfq())).resolves.toEqual([REQUESTER, ORG_ADMIN]);
    expect(deps.orgWideViewerRoleIds).toHaveBeenCalledWith(ORG);
  });

  it('a Member holding quote_requests.create, or a custom role, is excluded', async () => {
    const { resolver } = rig();
    const side = await resolver.customerSide(rfq());
    expect(side).not.toContain(MEMBER);
    expect(side).not.toContain(CUSTOM_ROLE_MEMBER);
  });

  it('blocked, deleted and anonymised Administrators are excluded', async () => {
    const { resolver } = rig();
    const side = await resolver.customerSide(rfq());
    expect(side).not.toContain(BLOCKED_ADMIN);
    expect(side).not.toContain(DELETED_ADMIN);
    expect(side).not.toContain(ANONYMISED_ADMIN);
  });

  it('a requester who is also an Administrator is one recipient', async () => {
    const { resolver } = rig();
    await expect(resolver.customerSide(rfq({ customerAccountId: ORG_ADMIN }))).resolves.toEqual([ORG_ADMIN]);
  });

  it('a blocked, deleted or anonymised requester is not told either (matrix rule 4)', async () => {
    for (const requester of [BLOCKED_ADMIN, DELETED_ADMIN, ANONYMISED_ADMIN]) {
      const { resolver } = rig();
      await expect(resolver.customerSide(rfq({ customerAccountId: requester }))).resolves.toEqual([ORG_ADMIN]);
    }
  });

  it('a personal Organization is the requester alone', async () => {
    const buyer = account(REQUESTER, 'personal-admin', { organizationId: PERSONAL_ORG });
    const { resolver } = rig({ members: [buyer] });
    await expect(
      resolver.customerSide(rfq({ organizationId: PERSONAL_ORG, customerAccountId: REQUESTER })),
    ).resolves.toEqual([REQUESTER]);
  });

  it('a requester no longer a member of the request’s Organization is not told', async () => {
    const { resolver } = rig({ members: ORG_MEMBERS.filter((m) => m.id !== REQUESTER) });
    await expect(resolver.customerSide(rfq())).resolves.toEqual([ORG_ADMIN]);
  });
});

describe('operator side (T021, FR-005) — assignee and representatives holding rfqs:handle, else every holder', () => {
  it('the assignee and the assigned representatives, each once', async () => {
    const { resolver } = rig({ assignments: [REP, ASSIGNEE] });
    await expect(resolver.operatorSide(rfq({ assignedAdminUserId: ASSIGNEE }))).resolves.toEqual([ASSIGNEE, REP]);
  });

  it('a representative without rfqs:handle is dropped', async () => {
    const { resolver } = rig({ assignments: [REP, REP_WITHOUT_HANDLE] });
    await expect(resolver.operatorSide(rfq())).resolves.toEqual([REP]);
  });

  it('an inactive or deleted representative is dropped', async () => {
    const deleted = admin('00000000-0000-4000-8000-0000000000d8', { deletedAt: new Date('2026-02-01T00:00:00.000Z') });
    PERMISSIONS[deleted.id] = ['rfqs:handle'];
    const { resolver } = rig({ assignments: [INACTIVE_REP, deleted.id, REP], admins: [...ADMINS, deleted] });
    await expect(resolver.operatorSide(rfq())).resolves.toEqual([REP]);
  });

  it('a wildcard role counts as holding rfqs:handle', async () => {
    const { resolver } = rig({ assignments: [PLATFORM_ADMIN] });
    await expect(resolver.operatorSide(rfq())).resolves.toEqual([PLATFORM_ADMIN]);
  });

  it('nobody assigned → every active administrator holding rfqs:handle, wildcard included, nobody without it', async () => {
    const { resolver, deps } = rig();
    const side = await resolver.operatorSide(rfq());
    expect([...side].sort()).toEqual([ASSIGNEE, PLATFORM_ADMIN, REP, SALES_ADMIN].sort());
    expect(side).not.toContain(SUPPORT_ADMIN);
    expect(side).not.toContain(REP_WITHOUT_HANDLE);
    expect(side).not.toContain(INACTIVE_REP);
    expect(deps.adminUsers.listAll).toHaveBeenCalledTimes(1);
  });

  it('every candidate filtered away → the fallback applies', async () => {
    const { resolver } = rig({ assignments: [REP_WITHOUT_HANDLE, INACTIVE_REP] });
    const side = await resolver.operatorSide(rfq());
    expect([...side].sort()).toEqual([ASSIGNEE, PLATFORM_ADMIN, REP, SALES_ADMIN].sort());
  });

  it('a candidate that holds rfqs:handle → the fallback is not read', async () => {
    const { resolver, deps } = rig({ assignments: [REP] });
    await resolver.operatorSide(rfq());
    expect(deps.adminUsers.listAll).not.toHaveBeenCalled();
  });
});
