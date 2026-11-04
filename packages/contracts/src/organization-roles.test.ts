import { describe, expect, it, vi } from 'vitest';
import type { Actor } from './actor.js';
import { ERROR_CODES } from './errors.js';
import { cartMergeOutcomeSchema, customerAccountSchema, customerLoginResponseSchema } from './organizations.js';
import { impersonationStartResponseSchema } from './admin.js';
import type {
  CustomerAccountCreateInput,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerRolePort,
} from './customer-accounts.js';
import type { OrganizationRecord } from './organizations.js';
import type { RfqCustomerContext } from './quote-requests.js';
import {
  CustomerSessionRequiredError,
  adminAssignMemberRoleRequestSchema,
  adminDirectMemberToRoleRequestSchema,
  assignMemberRoleRequestSchema,
  createOrganizationRoleRequestSchema,
  deleteOrganizationRoleRequestSchema,
  inviteMemberToRoleRequestSchema,
  organizationPermissionPreHandler,
  organizationRoleKindSchema,
  organizationRoleRefSchema,
  organizationRoleViewSchema,
  updateOrganizationRoleRequestSchema,
  type OrganizationPermissionPort,
  type OrganizationPermissionSubject,
} from './organization-roles.js';

/**
 * `specs/170-organization-roles/` WP-01 (T007) — the role contracts, and the
 * route guard every gating module declares (`contracts/organization-permission-port.md`
 * §1; research R-20, R-24, R-35; owner ruling PR-4).
 */

const ROLE_ID = '6f1c1d5e-6a4b-4c43-9d43-2b8a3c2e7f10';
const OTHER_ID = '0b9e7c5a-2f1d-4e8b-8a6c-1d2e3f4a5b6c';

describe('organization role kinds and references', () => {
  it('knows exactly the three kinds', () => {
    expect(organizationRoleKindSchema.options).toEqual(['administrator', 'member', 'custom']);
    expect(organizationRoleKindSchema.safeParse('organization_admin').success).toBe(false);
  });

  it('a role reference is { id, name, kind } and nothing else', () => {
    expect(
      organizationRoleRefSchema.parse({ id: ROLE_ID, name: 'Buyer', kind: 'custom' }),
    ).toEqual({ id: ROLE_ID, name: 'Buyer', kind: 'custom' });
    expect(
      organizationRoleRefSchema.safeParse({ id: ROLE_ID, name: 'Buyer', kind: 'custom', role: 'regular_user' })
        .success,
    ).toBe(false);
  });

  it('a role view carries the counts, the version and the stored grants', () => {
    const view = {
      id: ROLE_ID,
      kind: 'member',
      name: 'Member',
      description: null,
      permissions: ['carts.create'],
      memberCount: 3,
      pendingInvitationCount: 1,
      version: 2,
      updatedAt: '2026-11-03T10:00:00.000Z',
    };
    expect(organizationRoleViewSchema.parse(view)).toEqual(view);
    expect(organizationRoleViewSchema.safeParse({ ...view, memberCount: -1 }).success).toBe(false);
  });
});

/**
 * FR-073, R-24: a request that still sends the legacy `role` is refused, never
 * silently stripped — Zod's default `.object` would drop the key and answer as
 * though the caller had asked for the default role.
 */
describe('role-bearing request schemas refuse a legacy `role` key', () => {
  const cases: ReadonlyArray<{ name: string; schema: { safeParse(v: unknown): { success: boolean } }; valid: Record<string, unknown> }> = [
    {
      name: 'createOrganizationRoleRequestSchema',
      schema: createOrganizationRoleRequestSchema,
      valid: { name: 'Buyer', description: 'Places orders', permissions: ['carts.create'] },
    },
    {
      name: 'updateOrganizationRoleRequestSchema',
      schema: updateOrganizationRoleRequestSchema,
      valid: { expectedVersion: 3, permissions: [] },
    },
    {
      name: 'deleteOrganizationRoleRequestSchema',
      schema: deleteOrganizationRoleRequestSchema,
      valid: { expectedVersion: 1, replacementRoleId: OTHER_ID },
    },
    { name: 'assignMemberRoleRequestSchema', schema: assignMemberRoleRequestSchema, valid: { roleId: ROLE_ID } },
    {
      name: 'inviteMemberToRoleRequestSchema',
      schema: inviteMemberToRoleRequestSchema,
      valid: { email: 'new@example.test', roleId: ROLE_ID },
    },
    {
      name: 'adminDirectMemberToRoleRequestSchema',
      schema: adminDirectMemberToRoleRequestSchema,
      valid: {
        email: 'new@example.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'a-long-enough-password',
        roleId: ROLE_ID,
      },
    },
    {
      name: 'adminAssignMemberRoleRequestSchema',
      schema: adminAssignMemberRoleRequestSchema,
      valid: { roleId: ROLE_ID, expectedUpdatedAt: '2026-11-03T10:00:00.000Z' },
    },
  ];

  it.each(cases)('$name accepts its own shape', ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)('$name refuses the same body with `role` added', ({ schema, valid }) => {
    expect(schema.safeParse({ ...valid, role: 'organization_admin' }).success).toBe(false);
  });

  it('an invitation names its role optionally — the default is the Member role, resolved server-side', () => {
    expect(inviteMemberToRoleRequestSchema.safeParse({ email: 'new@example.test' }).success).toBe(true);
    expect(adminDirectMemberToRoleRequestSchema.safeParse({
      email: 'new@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: 'a-long-enough-password',
    }).success).toBe(true);
  });

  it('a role id is a uuid, not a kind', () => {
    expect(assignMemberRoleRequestSchema.safeParse({ roleId: 'administrator' }).success).toBe(false);
  });

  it('a custom role is named; an update and a delete name the version they were read at', () => {
    expect(createOrganizationRoleRequestSchema.safeParse({ name: '  ', permissions: [] }).success).toBe(false);
    expect(updateOrganizationRoleRequestSchema.safeParse({ permissions: [] }).success).toBe(false);
    expect(deleteOrganizationRoleRequestSchema.safeParse({}).success).toBe(false);
  });
});

function fakePort(): OrganizationPermissionPort & {
  assert: ReturnType<typeof vi.fn>;
} {
  return {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    isAdministrator: vi.fn(async () => false),
    effective: vi.fn(async () => ({ role: { id: ROLE_ID, kind: 'member' as const }, permissions: [] })),
    rolesHolding: vi.fn(async () => []),
  };
}

const customer: Actor = {
  kind: 'customer',
  customerAccountId: 'acc-1',
  organizationId: 'org-1',
  organizationRoleId: ROLE_ID,
  impersonatorAdminUserId: null,
};

const impersonated: Actor = {
  kind: 'customer',
  customerAccountId: 'acc-2',
  organizationId: 'org-1',
  organizationRoleId: OTHER_ID,
  impersonatorAdminUserId: 'admin-9',
};

const nonCustomers: ReadonlyArray<{ label: string; actor: Actor }> = [
  { label: 'anonymous', actor: { kind: 'anonymous' } },
  { label: 'admin', actor: { kind: 'admin', adminUserId: 'admin-1' } },
  { label: 'api key', actor: { kind: 'api_key', apiKeyId: 'k-1', scopes: [] } },
];

describe('organizationPermissionPreHandler (R-20, R-35, PR-4)', () => {
  describe("guests: 'refuse' (the default)", () => {
    it.each(nonCustomers)('answers 401 UNAUTHORIZED for a $label actor and never asks the port', async ({ actor }) => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'carts.create');
      const refusal = await guard({ actor }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(CustomerSessionRequiredError);
      expect(refusal).toMatchObject({ statusCode: 401, code: ERROR_CODES.UNAUTHORIZED });
      expect(port.assert).not.toHaveBeenCalled();
    });

    it("is the same as naming 'refuse' explicitly", async () => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'carts.create', { guests: 'refuse' });
      await expect(guard({ actor: { kind: 'anonymous' } })).rejects.toBeInstanceOf(CustomerSessionRequiredError);
    });
  });

  describe("guests: 'pass'", () => {
    it.each(nonCustomers)('lets a $label actor through unjudged', async ({ actor }) => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'carts.create', { guests: 'pass' });
      await expect(guard({ actor })).resolves.toBeUndefined();
      expect(port.assert).not.toHaveBeenCalled();
    });
  });

  describe.each(['refuse', 'pass'] as const)("a customer actor, guests: '%s'", (guests) => {
    it('is judged by assert, with the subject built from the actor and the response language', async () => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'carts.create', { guests });
      await guard({ actor: customer, responseLanguage: async () => 'pl' });
      const expected: OrganizationPermissionSubject = {
        customerAccountId: 'acc-1',
        organizationId: 'org-1',
        organizationRoleId: ROLE_ID,
      };
      expect(port.assert).toHaveBeenCalledTimes(1);
      expect(port.assert).toHaveBeenCalledWith(expected, 'carts.create', { language: 'pl' });
    });

    it('judges an impersonated customer as that customer (spec *Impersonation*)', async () => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'quote_requests.create', { guests });
      await guard({ actor: impersonated });
      expect(port.assert).toHaveBeenCalledWith(
        { customerAccountId: 'acc-2', organizationId: 'org-1', organizationRoleId: OTHER_ID },
        'quote_requests.create',
        {},
      );
    });

    it('passes a missing role id as null, so the port reads the account (R-15)', async () => {
      const port = fakePort();
      const guard = organizationPermissionPreHandler(() => port, 'carts.create', { guests });
      const { organizationRoleId: _omitted, ...withoutRole } = customer as Extract<Actor, { kind: 'customer' }>;
      await guard({ actor: withoutRole });
      expect(port.assert).toHaveBeenCalledWith(
        { customerAccountId: 'acc-1', organizationId: 'org-1', organizationRoleId: null },
        'carts.create',
        {},
      );
    });

    it("propagates the port's refusal unchanged", async () => {
      const port = fakePort();
      const refusal = new Error('ORGANIZATION_PERMISSION_REQUIRED');
      port.assert.mockRejectedValueOnce(refusal);
      const guard = organizationPermissionPreHandler(() => port, 'carts.create', { guests });
      await expect(guard({ actor: customer })).rejects.toBe(refusal);
    });

    it('resolves the port on every call, never at construction (module-composition item 4a)', async () => {
      const first = fakePort();
      const second = fakePort();
      const getPort = vi.fn<() => OrganizationPermissionPort>().mockReturnValueOnce(first).mockReturnValueOnce(second);
      const guard = organizationPermissionPreHandler(getPort, 'carts.create', { guests });
      expect(getPort).not.toHaveBeenCalled();
      await guard({ actor: customer });
      await guard({ actor: customer });
      expect(getPort).toHaveBeenCalledTimes(2);
      expect(first.assert).toHaveBeenCalledTimes(1);
      expect(second.assert).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Owner ruling PR-12: sign-in skips merging the guest basket when the member's
 * role lacks `carts.create`, and says so in the internal outcome (WP-03/WP-04
 * produce it; WP-01 only widens the vocabulary).
 */
describe('cart merge outcome on sign-in (PR-12)', () => {
  it('knows `skipped_permission` beside the existing outcomes', () => {
    const outcome = {
      outcome: 'skipped_permission',
      movedLineCount: 0,
      summedLineCount: 0,
      destinationCartId: ROLE_ID,
    };
    expect(cartMergeOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(cartMergeOutcomeSchema.shape.outcome.options).toEqual([
      'adopted',
      'merged',
      'noop_empty',
      'noop_no_anon',
      'skipped_permission',
    ]);
  });
});

/**
 * R-23 deprecate-then-delete, completed by WP-12 (T105, FR-073): the legacy
 * two-value `role` is gone from every response shape, and so are the symbols
 * that spelled it. A payload that still carries `role` parses with the key
 * stripped — these are response schemas, so nothing is refused, but nothing
 * describes or forwards the old field either.
 */
describe('the legacy role is removed (R-23, WP-12)', () => {
  const organizationRole = { id: ROLE_ID, name: 'Administrator', kind: 'administrator' as const };

  it('the package exports none of the legacy role symbols', async () => {
    const contracts: Record<string, unknown> = await import('./index.js');
    for (const name of [
      'organizationRoleSchema',
      'setCartApprovalPolicySchema',
      'cartApprovalPolicyResponseSchema',
      'inviteMemberRequestSchema',
      'changeMemberRoleRequestSchema',
      'adminDirectMemberRequestSchema',
      'adminPatchMemberRoleRequestSchema',
    ]) {
      expect(contracts, name).not.toHaveProperty(name);
    }
    expect(Object.keys(ERROR_CODES)).not.toContain('CART_APPROVAL_SELF_SUBMIT');
  });

  it('the cross-module records and ports carry no legacy member (checked by the type-check)', () => {
    type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
    const absent: [
      Has<CustomerAccountRecord, 'role'>,
      Has<CustomerAccountCreateInput, 'role'>,
      Has<CustomerAccountReadPort, 'countByOrganizationRole'>,
      Has<CustomerRolePort, 'changeRole'>,
      Has<OrganizationRecord, 'requiresCartApproval'>,
      Has<RfqCustomerContext, 'isOrgAdmin'>,
    ] = [false, false, false, false, false, false];
    expect(absent.every((present) => !present)).toBe(true);
  });

  it('a customer account carries organizationRole and permissions, and no role', () => {
    const base = {
      id: ROLE_ID,
      organizationId: OTHER_ID,
      email: 'a@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      emailVerifiedAt: null,
      twoFactorEnabled: false,
      createdAt: '2026-11-03T10:00:00.000Z',
      updatedAt: '2026-11-03T10:00:00.000Z',
    };
    const parsed = customerAccountSchema.parse({
      ...base,
      role: 'organization_admin',
      organizationRole,
      permissions: ['carts.create'],
    });
    expect(parsed.organizationRole).toEqual(organizationRole);
    expect(parsed.permissions).toEqual(['carts.create']);
    expect(parsed).not.toHaveProperty('role');
    expect(Object.keys(customerAccountSchema.shape)).not.toContain('role');
    // Required since the legacy removal: every producer sends both (WP-12).
    expect(customerAccountSchema.safeParse({ ...base, permissions: [] }).success).toBe(false);
    expect(customerAccountSchema.safeParse({ ...base, organizationRole }).success).toBe(false);
  });

  it('the login response carries them, and no role', () => {
    const parsed = customerLoginResponseSchema.parse({
      data: {
        customerAccount: {
          id: ROLE_ID,
          email: 'a@example.test',
          organizationId: OTHER_ID,
          role: 'regular_user',
          twoFactorEnabled: false,
          organizationRole,
          permissions: [],
        },
      },
    });
    expect(parsed.data.customerAccount.organizationRole).toEqual(organizationRole);
    expect(parsed.data.customerAccount.permissions).toEqual([]);
    expect(parsed.data.customerAccount).not.toHaveProperty('role');
    const account = { id: ROLE_ID, email: 'a@example.test', organizationId: OTHER_ID, twoFactorEnabled: false };
    expect(customerLoginResponseSchema.safeParse({ data: { customerAccount: { ...account, permissions: [] } } }).success).toBe(false);
    expect(customerLoginResponseSchema.safeParse({ data: { customerAccount: { ...account, organizationRole } } }).success).toBe(false);
  });

  it('the impersonation start response carries organizationRole, and no role', () => {
    const parsed = impersonationStartResponseSchema.parse({
      impersonationSessionId: ROLE_ID,
      impersonatedCustomerAccount: {
        id: OTHER_ID,
        email: 'a@example.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'regular_user',
        organizationRole,
      },
    });
    expect(parsed.impersonatedCustomerAccount.organizationRole).toEqual(organizationRole);
    expect(parsed.impersonatedCustomerAccount).not.toHaveProperty('role');
    expect(
      impersonationStartResponseSchema.safeParse({
        impersonationSessionId: ROLE_ID,
        impersonatedCustomerAccount: { id: OTHER_ID, email: 'a@example.test', firstName: 'Ada', lastName: 'Lovelace' },
      }).success,
    ).toBe(false);
  });
});
