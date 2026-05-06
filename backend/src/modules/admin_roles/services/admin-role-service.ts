import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES, PERMISSION_CATALOGUE } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { AdminRole } from '../entities/admin-role.entity.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';

/**
 * AdminRoleService (T193). CRUD over AdminRole rows. Two invariants:
 *
 *   - permissions referenced in `permissions` MUST be in PERMISSION_CATALOGUE
 *     (the wildcard `*` is intentionally rejected here — it's bootstrap-only,
 *     applied via a seed, never from the UI).
 *   - a Role with assigned AdminUsers cannot be deleted (409); reassign or
 *     deactivate the users first.
 */

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
  constructor(private readonly emFactory: () => EntityManager) {}

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
    this.#assertPermissionsKnown(input.permissions);
    const em = this.emFactory();
    let role = await em.findOne(AdminRole, { code: input.code });
    if (role) {
      role.name = input.name;
      role.permissions = input.permissions;
      role.requiresTwoFactor = input.requiresTwoFactor ?? role.requiresTwoFactor;
      await em.flush();
      return role;
    }
    role = em.create(AdminRole, {
      code: input.code,
      name: input.name,
      permissions: input.permissions,
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

  #assertPermissionsKnown(permissions: string[]): void {
    const known = new Set<string>(PERMISSION_CATALOGUE.map((p) => p.code));
    for (const p of permissions) {
      if (!known.has(p)) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Unknown permission: ${p}`);
      }
    }
  }
}
