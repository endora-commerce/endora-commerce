import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { AdminRole } from '../entities/admin-role.entity.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
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
 *   - a Role with assigned AdminUsers cannot be deleted (409); reassign or
 *     deactivate the users first.
 */

/** Wildcard permission — grants access to every gated admin route. */
const WILDCARD = '*';

/**
 * The bootstrap super-admin role. Its permission set is forced to the wildcard
 * on every upsert so it can never be locked out of the panel.
 */
const PLATFORM_ADMIN_CODE = 'platform_admin';

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

/** Test helper — clears the protected-codes registry between suites. */
export function _resetSystemRoleCodesForTests(): void {
  SYSTEM_ROLE_CODES.clear();
}

export class AdminRoleService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly permissionCatalogue: PermissionCatalogueService,
  ) {}

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
    const row = await em.findOne(AdminRole, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    return row;
  }

  async upsertByCode(input: UpsertAdminRoleInput): Promise<AdminRole> {
    // The platform_admin role is always full-access; ignore any narrower
    // payload so the bootstrap super-admin can never be downgraded. Every
    // other role may opt into the wildcard or carry an explicit list.
    const permissions =
      input.code === PLATFORM_ADMIN_CODE
        ? [WILDCARD]
        : this.#normalizePermissions(input.permissions);
    const em = this.emFactory();
    let role = await em.findOne(AdminRole, { code: input.code });
    if (role) {
      role.name = input.name;
      role.permissions = permissions;
      role.requiresTwoFactor = input.requiresTwoFactor ?? role.requiresTwoFactor;
      await em.flush();
      return role;
    }
    role = em.create(AdminRole, {
      code: input.code,
      name: input.name,
      permissions,
      requiresTwoFactor: input.requiresTwoFactor ?? false,
    });
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

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const role = await em.findOne(AdminRole, { id });
    if (!role) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    if (SYSTEM_ROLE_CODES.has(role.code)) {
      throw new HttpError(
        409,
        ERROR_CODES.ADMIN_ROLE_PROTECTED,
        `Cannot delete the system-protected role "${role.code}". Modules' seeded roles are immutable.`,
      );
    }
    const assignees = await em.count(AdminUser, { adminRoleId: role.id, deletedAt: null });
    if (assignees > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ADMIN_ROLE_IN_USE,
        `Cannot delete role: ${assignees} admin user(s) still assigned.`,
      );
    }
    await em.removeAndFlush(role);
  }

  /**
   * Validate an explicit permission list and collapse the wildcard. A list
   * containing `*` is "full access" — it normalises to exactly `['*']` and the
   * catalogue check is skipped. Otherwise every code must exist in the merged
   * assignable catalogue, else a 400 VALIDATION_FAILED is raised.
   */
  #normalizePermissions(permissions: string[]): string[] {
    if (permissions.includes(WILDCARD)) return [WILDCARD];
    const known = new Set(this.permissionCatalogue.listAssignableCodes());
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
