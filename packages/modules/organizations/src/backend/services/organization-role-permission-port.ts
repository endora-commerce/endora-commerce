import {
  ERROR_CODES,
  type OrganizationEffectivePermissions,
  type OrganizationPermissionPort,
  type OrganizationPermissionSubject,
  type OrganizationRoleReadPort,
  type OrganizationRoleRef,
  type OrganizationRoleSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CachedOrganizationRole, CachedOrganizationRoles } from './organization-role-cache.js';
import { effectiveCodes, type OrganizationRoleCatalogue } from './organization-role-catalogue.js';

/**
 * `organizationPermissionPort` and `organizationRoleReadPort` — `organizations`'
 * answer to "may this member do that?" (`specs/170-organization-roles/`,
 * `contracts/organization-permission-port.md` §1–§3; research R-7, R-15, R-20;
 * FR-002, FR-007, FR-055).
 *
 * The subject's role is the one its actor carries (`organizationRoleId`, R-15);
 * when it carries none, {@link OrganizationRolePermissionServiceDeps.resolveAccountRoleId}
 * reads the account. The role itself — kind, grants, ledger — comes from the
 * per-process {@link OrganizationRoleCache}; presence from the catalogue, at
 * call time. A role that cannot be found **in the subject's own Organization**
 * fails closed and is logged: `can` and `isAdministrator` answer `false` and
 * `effective` an empty set.
 *
 * The administrator capability (members, invitations, roles, the MFA policy,
 * Organization one-click defaults) is {@link isAdministrator}, never a code
 * (data-model §6, "Reserved administrator capabilities").
 */

export interface OrganizationRolePermissionServiceDeps {
  readonly cache: { get(organizationId: string): Promise<CachedOrganizationRoles> };
  readonly catalogue: OrganizationRoleCatalogue;
  /**
   * The role id of the subject's account, for a subject that does not carry one
   * (a service judging somebody other than the requester, or a request whose
   * actor was resolved without it). `null` when the account is not found in the
   * subject's Organization.
   */
  readonly resolveAccountRoleId: (subject: OrganizationPermissionSubject) => Promise<string | null>;
  /** The translated label of a declared code, in `language` (R-31). */
  readonly permissionLabel: (code: string, language?: string) => Promise<string>;
  /**
   * The translated name of a predefined role, in `language` (FR-008; WP-03).
   * Absent, the English one — a composition that wires no bundle still names
   * the role rather than answering its key.
   */
  readonly predefinedRoleName?: (kind: 'administrator' | 'member', language?: string) => Promise<string>;
  readonly logError?: (message: string, context: Record<string, unknown>) => void;
}

/**
 * The refusal of a member lacking `code` (§3): `403
 * ORGANIZATION_PERMISSION_REQUIRED`, with the code and its translated label in
 * `details`, which the error envelope interpolates into the sentence as
 * `{permissionLabel}`. `details` deliberately carries no `code` member — that
 * key is the envelope's refusal token and would re-key the sentence lookup.
 */
export function permissionRequiredRefusal(code: string, permissionLabel: string): HttpError {
  return new HttpError(
    403,
    ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
    `Your role does not allow this: “${permissionLabel}”.`,
    { permission: code, permissionLabel },
  );
}

/** The predefined roles' English names, the last tier when no bundle answers. */
const PREDEFINED_ROLE_ENGLISH_NAMES: Readonly<Record<'administrator' | 'member', string>> = {
  administrator: 'Administrator',
  member: 'Member',
};

export class OrganizationRolePermissionService implements OrganizationPermissionPort, OrganizationRoleReadPort {
  private readonly logError: (message: string, context: Record<string, unknown>) => void;

  constructor(private readonly deps: OrganizationRolePermissionServiceDeps) {
    this.logError = deps.logError ?? ((message, context) => console.error(`[organizations] ${message}`, context));
  }

  async can(subject: OrganizationPermissionSubject, code: string): Promise<boolean> {
    if (!this.deps.catalogue.isPresent(code)) return false;
    const role = await this.roleOf(subject);
    if (role === null) return false;
    return effectiveCodes(role, this.deps.catalogue).includes(code);
  }

  async assert(
    subject: OrganizationPermissionSubject,
    code: string,
    options: { language?: string } = {},
  ): Promise<void> {
    if (!this.deps.catalogue.isKnown(code)) {
      // A programming error: a gate naming a code no manifest declares. The
      // permission inventory refuses it statically as well.
      throw new HttpError(500, ERROR_CODES.INTERNAL, `Unknown organization permission "${code}".`);
    }
    if (await this.can(subject, code)) return;
    throw permissionRequiredRefusal(code, await this.deps.permissionLabel(code, options.language));
  }

  async isAdministrator(subject: OrganizationPermissionSubject): Promise<boolean> {
    return (await this.roleOf(subject))?.kind === 'administrator';
  }

  async effective(subject: OrganizationPermissionSubject): Promise<OrganizationEffectivePermissions> {
    const role = await this.roleOf(subject);
    if (role === null) {
      // Fail closed. `kind: 'custom'` with nothing granted is the least a
      // role can hold; the id is whatever the subject named, or empty.
      return { role: { id: subject.organizationRoleId ?? '', kind: 'custom' }, permissions: [] };
    }
    return { role: { id: role.id, kind: role.kind }, permissions: effectiveCodes(role, this.deps.catalogue) };
  }

  async rolesHolding(organizationId: string, code: string): Promise<readonly string[]> {
    if (!this.deps.catalogue.isPresent(code)) return [];
    const roles = await this.deps.cache.get(organizationId);
    return [...roles.values()]
      .filter((role) => effectiveCodes(role, this.deps.catalogue).includes(code))
      .map((role) => role.id);
  }

  async predefinedRoleId(organizationId: string, kind: 'administrator' | 'member'): Promise<string> {
    const roles = await this.deps.cache.get(organizationId);
    for (const role of roles.values()) if (role.kind === kind) return role.id;
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }

  async findRole(organizationId: string, roleId: string): Promise<OrganizationRoleSummary | null> {
    const role = (await this.deps.cache.get(organizationId)).get(roleId);
    return role ? { id: role.id, kind: role.kind, name: role.kind === 'custom' ? (role.name ?? null) : null } : null;
  }

  async roleRef(organizationId: string, roleId: string, language?: string): Promise<OrganizationRoleRef | null> {
    const role = (await this.deps.cache.get(organizationId)).get(roleId);
    if (!role) return null;
    const name =
      role.kind === 'custom'
        ? (role.name ?? '')
        : this.deps.predefinedRoleName
          ? await this.deps.predefinedRoleName(role.kind, language)
          : PREDEFINED_ROLE_ENGLISH_NAMES[role.kind];
    return { id: role.id, kind: role.kind, name };
  }

  /** The subject's role in its own Organization, or `null` (logged). */
  private async roleOf(subject: OrganizationPermissionSubject): Promise<CachedOrganizationRole | null> {
    const roleId = subject.organizationRoleId ?? (await this.deps.resolveAccountRoleId(subject));
    const role =
      roleId && subject.organizationId ? (await this.deps.cache.get(subject.organizationId)).get(roleId) ?? null : null;
    if (role === null) {
      this.logError('organization role not found — permission check fails closed', {
        customerAccountId: subject.customerAccountId,
        organizationId: subject.organizationId,
        organizationRoleId: roleId ?? null,
      });
    }
    return role;
  }
}
