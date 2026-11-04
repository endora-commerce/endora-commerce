import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationRoleCatalogue, type OrganizationPermissionManifestEntry } from './organization-role-catalogue.js';
import type { CachedOrganizationRoles } from './organization-role-cache.js';
import { OrganizationRolePermissionService } from './organization-role-permission-port.js';

/**
 * `organizationPermissionPort` and `organizationRoleReadPort`, as `organizations`
 * implements them (`specs/170-organization-roles/` WP-02a, T025;
 * `contracts/organization-permission-port.md` §1–§3; FR-002, FR-007, FR-055).
 *
 * The cache, the presence predicate, the account fallback and the label
 * translation are injected; the semantics table of §2 is asserted row by row.
 */

const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';
const ADMIN_ROLE = '00000000-0000-4000-8000-00000000b001';
const MEMBER_ROLE = '00000000-0000-4000-8000-00000000b002';
const CUSTOM_ROLE = '00000000-0000-4000-8000-00000000b003';
const ACCOUNT = '00000000-0000-4000-8000-00000000c001';

const MANIFESTS: OrganizationPermissionManifestEntry[] = [
  {
    manifest: {
      id: 'carts',
      name: 'Carts',
      organizationPermissions: [
        { code: 'carts.create', label: 'Create carts', description: 'Build baskets.', memberDefault: true },
        { code: 'carts.approve', label: 'Approve carts', description: 'Approve colleagues’ baskets.', memberDefault: false },
      ],
    },
  },
  {
    manifest: {
      id: 'quote_requests',
      name: 'Quote requests',
      organizationPermissions: [
        { code: 'quote_requests.create', label: 'Create quote requests', description: 'Ask for a quote.', memberDefault: true },
      ],
    },
  },
];

function roles(): CachedOrganizationRoles {
  return new Map([
    [ADMIN_ROLE, { id: ADMIN_ROLE, kind: 'administrator' as const, permissions: new Set<string>(), memberDefaultsOffered: new Set<string>() }],
    [MEMBER_ROLE, { id: MEMBER_ROLE, kind: 'member' as const, permissions: new Set<string>(), memberDefaultsOffered: new Set<string>() }],
    [
      CUSTOM_ROLE,
      { id: CUSTOM_ROLE, kind: 'custom' as const, name: 'Buyer', permissions: new Set(['carts.approve', 'quote_requests.create']), memberDefaultsOffered: new Set<string>() },
    ],
  ]);
}

function port(options: { present?: Set<string>; accountRoleId?: string | null } = {}) {
  const present = options.present ?? new Set(['carts', 'quote_requests']);
  const logError = vi.fn();
  const translate = vi.fn(async (code: string, language?: string) =>
    language === 'pl' ? `PL:${code}` : `EN:${code}`,
  );
  const resolveAccountRoleId = vi.fn(async () => options.accountRoleId ?? null);
  const service = new OrganizationRolePermissionService({
    cache: { get: async (organizationId) => (organizationId === ORG ? roles() : new Map()) },
    catalogue: new OrganizationRoleCatalogue({
      manifests: () => MANIFESTS,
      isModulePresent: (moduleId) => present.has(moduleId),
    }),
    resolveAccountRoleId,
    permissionLabel: translate,
    logError,
  });
  return { service, logError, translate, resolveAccountRoleId, present };
}

const subject = (organizationRoleId: string | null, organizationId = ORG) => ({
  customerAccountId: ACCOUNT,
  organizationId,
  organizationRoleId,
});

describe('organizationPermissionPort — §2 semantics', () => {
  it('administrator holds every present code and nothing absent or unknown', async () => {
    const { service, present } = port();
    expect(await service.can(subject(ADMIN_ROLE), 'carts.approve')).toBe(true);
    expect(await service.can(subject(ADMIN_ROLE), 'quote_requests.create')).toBe(true);
    expect(await service.can(subject(ADMIN_ROLE), 'carts.nothing')).toBe(false);
    present.delete('quote_requests');
    expect(await service.can(subject(ADMIN_ROLE), 'quote_requests.create')).toBe(false);
    expect(await service.isAdministrator(subject(ADMIN_ROLE))).toBe(true);
  });

  it('member holds the R-17 set: unoffered member defaults, present only', async () => {
    const { service, present } = port();
    expect(await service.can(subject(MEMBER_ROLE), 'carts.create')).toBe(true);
    expect(await service.can(subject(MEMBER_ROLE), 'carts.approve')).toBe(false);
    present.delete('carts');
    expect(await service.can(subject(MEMBER_ROLE), 'carts.create')).toBe(false);
    expect(await service.isAdministrator(subject(MEMBER_ROLE))).toBe(false);
  });

  it('custom holds its grants intersected with presence', async () => {
    const { service, present } = port();
    expect(await service.can(subject(CUSTOM_ROLE), 'carts.approve')).toBe(true);
    expect(await service.can(subject(CUSTOM_ROLE), 'carts.create')).toBe(false);
    present.delete('quote_requests');
    expect(await service.can(subject(CUSTOM_ROLE), 'quote_requests.create')).toBe(false);
  });

  it('effective answers the role and the sorted present codes', async () => {
    const { service } = port();
    expect(await service.effective(subject(ADMIN_ROLE))).toEqual({
      role: { id: ADMIN_ROLE, kind: 'administrator' },
      permissions: ['carts.approve', 'carts.create', 'quote_requests.create'],
    });
    expect(await service.effective(subject(MEMBER_ROLE))).toEqual({
      role: { id: MEMBER_ROLE, kind: 'member' },
      permissions: ['carts.create', 'quote_requests.create'],
    });
  });

  it('fails closed, and logs, when the role cannot be found in the subject’s Organization', async () => {
    const { service, logError } = port();
    for (const s of [subject('00000000-0000-4000-8000-00000000dead'), subject(ADMIN_ROLE, OTHER_ORG), subject(null)]) {
      expect(await service.can(s, 'carts.create')).toBe(false);
      expect(await service.isAdministrator(s)).toBe(false);
      expect((await service.effective(s)).permissions).toEqual([]);
    }
    expect(logError).toHaveBeenCalled();
    expect(logError.mock.calls[0]![1]).toMatchObject({ customerAccountId: ACCOUNT, organizationId: ORG });
  });

  it('asks the account fallback only when the subject carries no role id (R-15)', async () => {
    const { service, resolveAccountRoleId } = port({ accountRoleId: ADMIN_ROLE });
    expect(await service.isAdministrator(subject(null))).toBe(true);
    expect(resolveAccountRoleId).toHaveBeenCalledTimes(1);
    expect(await service.isAdministrator(subject(MEMBER_ROLE))).toBe(false);
    expect(resolveAccountRoleId).toHaveBeenCalledTimes(1);
  });

  it('a code outside the vocabulary: can is false, assert is a 500 programming error', async () => {
    const { service } = port();
    expect(await service.can(subject(ADMIN_ROLE), 'catalog:read')).toBe(false);
    await expect(service.assert(subject(ADMIN_ROLE), 'carts.nothing')).rejects.toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.INTERNAL,
    });
  });
});

describe('organizationPermissionPort — the refusal (§3, FR-055)', () => {
  it('assert passes a held code silently', async () => {
    const { service } = port();
    await expect(service.assert(subject(MEMBER_ROLE), 'carts.create')).resolves.toBeUndefined();
  });

  it('assert refuses 403 ORGANIZATION_PERMISSION_REQUIRED with the label in the request language', async () => {
    const { service } = port();
    const error = await service.assert(subject(MEMBER_ROLE), 'carts.approve', { language: 'pl' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
      details: { permission: 'carts.approve', permissionLabel: 'PL:carts.approve' },
    });
    // No `code` member in `details`: it would re-key the sentence lookup (error-envelope).
    expect((error as HttpError).details).not.toHaveProperty('code');
  });

  it('assert refuses a present-but-absent code the same way, never as 404 or 503', async () => {
    const { service, present } = port();
    present.delete('quote_requests');
    await expect(service.assert(subject(ADMIN_ROLE), 'quote_requests.create')).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
    });
  });
});

describe('rolesHolding and predefinedRoleId', () => {
  it('lists every role whose effective set holds the code, the administrator included', async () => {
    const { service } = port();
    expect([...(await service.rolesHolding(ORG, 'carts.approve'))].sort()).toEqual([ADMIN_ROLE, CUSTOM_ROLE].sort());
    expect([...(await service.rolesHolding(ORG, 'carts.create'))].sort()).toEqual([ADMIN_ROLE, MEMBER_ROLE].sort());
    expect(await service.rolesHolding(ORG, 'carts.nothing')).toEqual([]);
  });

  it('answers the predefined role ids, and refuses an Organization it has no roles for', async () => {
    const { service } = port();
    expect(await service.predefinedRoleId(ORG, 'administrator')).toBe(ADMIN_ROLE);
    expect(await service.predefinedRoleId(ORG, 'member')).toBe(MEMBER_ROLE);
    await expect(service.predefinedRoleId(OTHER_ORG, 'member')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('findRole (WP-02b)', () => {
  it("answers a role of the Organization — name for a custom role, null for a predefined one — and null for another Organization's", async () => {
    const { service } = port();
    expect(await service.findRole(ORG, CUSTOM_ROLE)).toEqual({ id: CUSTOM_ROLE, kind: 'custom', name: 'Buyer' });
    expect(await service.findRole(ORG, ADMIN_ROLE)).toEqual({ id: ADMIN_ROLE, kind: 'administrator', name: null });
    expect(await service.findRole(OTHER_ORG, CUSTOM_ROLE)).toBeNull();
    expect(await service.findRole(ORG, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });
});

describe('roleRef (WP-03)', () => {
  it('names a predefined role in the requested language and a custom role by its own name (FR-008)', async () => {
    const service = new OrganizationRolePermissionService({
      cache: { get: async (organizationId) => (organizationId === ORG ? roles() : new Map()) },
      catalogue: new OrganizationRoleCatalogue({ manifests: () => MANIFESTS, isModulePresent: () => true }),
      resolveAccountRoleId: async () => null,
      permissionLabel: async (code) => code,
      predefinedRoleName: async (kind, language) => `${language}:${kind}`,
    });
    await expect(service.roleRef(ORG, MEMBER_ROLE, 'pl')).resolves.toEqual({ id: MEMBER_ROLE, kind: 'member', name: 'pl:member' });
    await expect(service.roleRef(ORG, CUSTOM_ROLE, 'pl')).resolves.toEqual({ id: CUSTOM_ROLE, kind: 'custom', name: 'Buyer' });
  });

  it("answers null for another Organization's role (FR-005)", async () => {
    const { service } = port();
    await expect(service.roleRef(OTHER_ORG, ADMIN_ROLE)).resolves.toBeNull();
  });

  it('falls back to the English names when no translation is wired', async () => {
    const { service } = port();
    await expect(service.roleRef(ORG, ADMIN_ROLE, 'pl')).resolves.toEqual({ id: ADMIN_ROLE, kind: 'administrator', name: 'Administrator' });
  });
});
