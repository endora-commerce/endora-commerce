import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  permissionsNotHeld,
  type AdminUserReadPort,
  type UpsertAdminRoleOptions,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { AdminRole } from '../entities/admin-role.entity.js';
import { PLATFORM_ADMINISTRATOR_ROLE_CODE } from './platform-administrator-role.js';
import type { PermissionCatalogueService } from './permission-catalogue.service.js';

/**
 * AdminRoleService (T193). CRUD over AdminRole rows. Invariants:
 *
 *   - permissions referenced in `permissions` MUST be in the merged assignable
 *     catalogue (`PermissionCatalogueService`), OR be the wildcard `*` which
 *     grants full access. When `*` is present the permission set is normalised
 *     to exactly `['*']` (a role is either "full access" or an explicit list).
 *   - the bootstrap `platform_admin` role is locked to `['*']`: it always has
 *     full access and its permission set cannot be downgraded from the UI.
 *   - the `platform_admin` role cannot be deleted at all (409), assigned or not:
 *     it is the role installation guarantees.
 *   - a write made on an administrator's behalf (`options.grantor`) is held to
 *     that administrator's own permissions: a grantor without `*` may neither
 *     write a role holding a code they lack nor change a role that already
 *     holds one, and may not change a role the platform or a module seeds
 *     (`platform_admin` included). A write with no grantor — a module seeding
 *     its roles, the bootstrap CLI, an upgrade step — is a platform write and
 *     is not held to any ceiling.
 *   - a Role with assigned AdminUsers cannot be deleted (409); reassign or
 *     deactivate the users first. A **soft-deleted** admin still counts
 *     (issue #168): restoring the account restores its role, so the assignment
 *     survives the deletion and the role is still in use.
 */

/** Wildcard permission — grants access to every gated admin route. */
const WILDCARD = '*';

/**
 * The platform-administrator role. Its permission set is forced to the wildcard
 * on every upsert so it can never be locked out of the panel, and it is never
 * deletable — see `platform-administrator-role.ts`.
 */
const PLATFORM_ADMIN_CODE = PLATFORM_ADMINISTRATOR_ROLE_CODE;

export interface UpsertAdminRoleInput {
  code: string;
  name: string;
  permissions: string[];
  requiresTwoFactor?: boolean;
}

/**
 * Codes of seeded roles that other modules register as
 * deletion-protected. Modules call `registerSystemRoleCode(...)` from
 * their plugin to add their seeded codes to this set; once registered,
 * `remove` refuses to delete a role whose `code` is in the set with a
 * 409 ADMIN_ROLE_PROTECTED envelope (feature 016 / FR-025).
 */
const SYSTEM_ROLE_CODES = new Set<string>();

/**
 * Module-level registration for seeded role codes that should be
 * deletion-protected. Idempotent. Exposed as a top-level function so
 * modules can call it from their plugin without holding an
 * AdminRoleService instance.
 */
export function registerSystemRoleCode(code: string): void {
  SYSTEM_ROLE_CODES.add(code);
}

/**
 * The protected codes, in registration order. Published through
 * `SystemRoleCodePort` (feature 075, Phase P) so a contributor can read back
 * what the platform is protecting without reaching into this file.
 */
export function listSystemRoleCodes(): readonly string[] {
  return [...SYSTEM_ROLE_CODES];
}

/** Test helper — clears the protected-codes registry between suites. */
export function _resetSystemRoleCodesForTests(): void {
  SYSTEM_ROLE_CODES.clear();
}

/**
 * The refusal a role deletion earns from its assignees, or `null` when it has
 * none (issue #168).
 *
 * Exported and pure so the sentence's `{placeholders}` can be checked against
 * the `details` a real refusal carries — the agreement issue #161 found nothing
 * was checking, one code family over. `check:error-translations` sees that a
 * code *has* a sentence; only a test that renders one can see that the sentence
 * has anything to fill it.
 *
 * The token in `details.code` chooses the sentence, and the count fills it.
 * Both populations refuse, and they are separated because the remedy differs:
 * reassign a live admin; restore-and-reassign or purge a deleted one.
 */
export function roleInUseRefusal(live: number, deleted: number): HttpError | null {
  if (live > 0) {
    return new HttpError(
      409,
      ERROR_CODES.ADMIN_ROLE_IN_USE,
      `Cannot delete role: ${live} admin user(s) still assigned.`,
      { code: 'assigned', assigned: live },
    );
  }
  if (deleted > 0) {
    return new HttpError(
      409,
      ERROR_CODES.ADMIN_ROLE_IN_USE,
      `Cannot delete role: ${deleted} deleted admin account(s) still hold it, ` +
        `and restoring one restores the assignment.`,
      { code: 'assigned_to_deleted', deleted },
    );
  }
  return null;
}

/**
 * The refusal a seeded role's deletion earns, with the role's own code on it.
 *
 * Exported and pure for the reason {@link roleInUseRefusal} is: the sentence
 * that replaces this message carries a `{role}` placeholder, and only a test
 * that renders a **real** refusal against the bundle can see that the
 * placeholder has something to fill it (issue #161, and !1181's finding that a
 * translated sentence with no placeholder loses an interpolated value silently).
 *
 * `details.role`, never `details.code`: the latter is the refusal token the
 * envelope keys `errors.<CODE>.<token>` on, so putting a role code there would
 * send it looking for a sentence named after the role.
 */
export function protectedRoleRefusal(code: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ADMIN_ROLE_PROTECTED,
    `Cannot delete the system-protected role "${code}". Roles the platform or a module seeds are immutable.`,
    { role: code },
  );
}

/**
 * The refusal an administrator without full access earns by changing a role the
 * platform or a module seeds.
 *
 * The same code as the deletion refusal, told apart by `details.code`, which
 * keys `errors.ADMIN_ROLE_PROTECTED.modify`. A full-access administrator may
 * still rename a seeded role or set its two-factor flag, which is why this is
 * not raised for one: the seeders keep an operator's name and flag on purpose.
 */
export function protectedRoleModificationRefusal(code: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ADMIN_ROLE_PROTECTED,
    `The system-protected role "${code}" can only be changed by an administrator with full access.`,
    { role: code, code: 'modify' },
  );
}

/**
 * The refusal a role write earns when it would hand out, or change a role
 * holding, permissions the acting administrator's own role lacks.
 *
 * `details.permissions` is the missing codes as one string, so the sentence can
 * name them. Exported because `admin_users` raises the same refusal when an
 * administrator assigns such a role to an account.
 */
export function grantExceededRefusal(missing: readonly string[]): HttpError {
  const permissions = missing.join(', ');
  return new HttpError(
    403,
    ERROR_CODES.ADMIN_ROLE_GRANT_EXCEEDED,
    `Your own role does not hold these permissions, so you cannot grant them or change a role ` +
      `that holds them: ${permissions}.`,
    { permissions },
  );
}

export class AdminRoleService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly permissionCatalogue: PermissionCatalogueService,
    /** `adminUserReadPort` — who still holds a role (feature 075, Phase C). */
    private readonly adminUsers: AdminUserReadPort,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'admin_role', objectId, stateBefore, stateAfter });
    }
  }

  /**
   * Register a role code as system-protected. Called by modules at
   * plugin startup for their seeded roles. Idempotent.
   */
  registerSystemRoleCode(code: string): void {
    SYSTEM_ROLE_CODES.add(code);
  }

  async list(): Promise<AdminRole[]> {
    const em = this.emFactory();
    return em.find(AdminRole, {}, { orderBy: { name: 'asc' } });
  }

  async getById(id: string): Promise<AdminRole> {
    const em = this.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    const row = await em.findOne(AdminRole, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    return row;
  }

  async upsertByCode(
    input: UpsertAdminRoleInput,
    options: UpsertAdminRoleOptions = {},
  ): Promise<AdminRole> {
    // The platform_admin role is always full-access; ignore any narrower
    // payload so the bootstrap super-admin can never be downgraded. Every
    // other role may opt into the wildcard or carry an explicit list.
    const permissions =
      input.code === PLATFORM_ADMIN_CODE
        ? [WILDCARD]
        : this.#normalizePermissions(input.permissions);
    const em = this.emFactory();
    let role = await em.findOne(AdminRole, { code: input.code });
    if (options.grantor) {
      this.#assertWithinGrantorCeiling(options.grantor.permissions, input.code, role, permissions);
    }
    if (role) {
      role.name = input.name;
      role.permissions = permissions;
      role.requiresTwoFactor = input.requiresTwoFactor ?? role.requiresTwoFactor;
      this.#audit(em, 'admin_role.upsert', role.id, null, { code: role.code, name: role.name });
      await em.flush();
      return role;
    }
    role = em.create(AdminRole, {
      code: input.code,
      name: input.name,
      permissions,
      requiresTwoFactor: input.requiresTwoFactor ?? false,
    });
    this.#audit(em, 'admin_role.upsert', role.id, null, { code: role.code, name: role.name });
    try {
      await em.persistAndFlush(role);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.ADMIN_ROLE_CODE_TAKEN,
          'A role with that code already exists.',
        );
      }
      throw err;
    }
    return role;
  }

  /**
   * The grant ceiling for an operator write. Nothing is assigned before it
   * runs, so a refused write leaves the stored role exactly as it was.
   *
   * Checked in this order, because the first answer is the one the operator can
   * act on: a seeded role is not theirs to change at all, a role already above
   * them is not theirs to change either, and only then does the requested set
   * matter.
   */
  #assertWithinGrantorCeiling(
    grantorPermissions: readonly string[],
    code: string,
    existing: AdminRole | null,
    requested: readonly string[],
  ): void {
    if (grantorPermissions.includes(WILDCARD)) return;
    if (existing && (code === PLATFORM_ADMIN_CODE || SYSTEM_ROLE_CODES.has(code))) {
      throw protectedRoleModificationRefusal(code);
    }
    const heldNow = existing ? permissionsNotHeld(existing.permissions ?? [], grantorPermissions) : [];
    const missing = [
      ...heldNow,
      ...permissionsNotHeld(requested, grantorPermissions).filter((p) => !heldNow.includes(p)),
    ];
    if (missing.length > 0) throw grantExceededRefusal(missing);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    const role = await em.findOne(AdminRole, { id });
    if (!role) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    // The platform-administrator role is protected by its code, not by the
    // registry: that set is filled at boot by the modules that seed a role, and
    // the role installation guarantees must not depend on a hook having run.
    if (role.code === PLATFORM_ADMIN_CODE || SYSTEM_ROLE_CODES.has(role.code)) {
      throw protectedRoleRefusal(role.code);
    }
    // Every assignee a restore returns, live or binned (issue #168).
    //
    // A soft delete does not release the assignment: the row keeps its
    // `admin_role_id`, and restoring the account restores the role with it. So
    // counting live assignees only made the guard pass on a role that was still
    // held — and the delete it let through hit `admin_users_admin_role_fk`
    // (`on delete restrict`) and answered 500. The operator was told the role
    // was unused, confirmed, and got a server error.
    //
    // The two populations are still counted apart, because the remedy differs:
    // reassign a live admin, purge or restore-and-reassign a deleted one. Each
    // refusal carries its token in `details.code` — that is what keys the
    // sentence — and its count, which the sentence interpolates.
    const assignees = await this.adminUsers.listByRoleId(role.id);
    const live = assignees.filter((admin) => admin.deletedAt === null).length;
    const refusal = roleInUseRefusal(live, assignees.length - live);
    if (refusal) throw refusal;
    this.#audit(em, 'admin_role.delete', role.id, { code: role.code }, null);
    await em.removeAndFlush(role);
  }

  /**
   * Validate an explicit permission list and collapse the wildcard. A list
   * containing `*` is "full access" — it normalises to exactly `['*']` and the
   * catalogue check is skipped. Otherwise every code must exist in the merged
   * catalogue, else a 400 VALIDATION_FAILED is raised.
   *
   * Issue #213 — validated against the **known** vocabulary, not the grantable
   * set. Since the grantable set became presence-filtered, the two differ
   * exactly while a module is off, and validating against the narrower one
   * would refuse to save any role that still holds a switched-off module's
   * code. Off is non-destructive and reversible; a 400 on an unrelated rename
   * is neither. See `PermissionCatalogueService.listKnownCodes`.
   */
  #normalizePermissions(permissions: string[]): string[] {
    if (permissions.includes(WILDCARD)) return [WILDCARD];
    const known = new Set(this.permissionCatalogue.listKnownCodes());
    const invalid = permissions.filter((p) => !known.has(p));
    if (invalid.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Unknown permission(s): ${invalid.join(', ')}`,
      );
    }
    return permissions;
  }
}
