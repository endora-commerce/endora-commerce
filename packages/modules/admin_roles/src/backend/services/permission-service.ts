import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminRoleResolution,
  type AdminUserReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { AdminRole } from '../entities/admin-role.entity.js';
import { toAdminRoleRecord } from './admin-role-ports.js';

/**
 * PermissionService (T187). Looks up an AdminUser's Role and checks if a
 * specific permission string is present in the Role's permissions array.
 *
 * The wildcard `*` in a Role's permissions grants every permission — used for
 * the bootstrap "platform admin" Role.
 *
 * The admin identity comes from `adminUserReadPort` (feature 075, Phase C)
 * rather than from `em.findOne(AdminUser, …)`: the role assignment is a column
 * on a table `admin_users` owns, and this module owns only what the role says.
 * `activeOnly` is the `deletedAt: null` half of the query it replaced; the
 * `status` test below is the other half and stays here, because "may this admin
 * act" is this module's question.
 *
 * ## An administrator with no role is refused, not treated as holding nothing
 *
 * Every administrator holds exactly one role; installation guarantees a
 * platform-administrator role and the admin surface refuses to leave an account
 * without one. An account that has none anyway — one that predates that rule —
 * has no answer to "may this admin do this?", and answering `false` would show
 * its owner an empty panel with nothing saying why. So the check **throws** the
 * refusal for that one state, and the guard that called it answers 403
 * `ADMIN_ROLE_REQUIRED`. An unknown or inactive admin is still a plain `false`:
 * that is nobody, not an administrator in a state somebody has to repair.
 */

/**
 * The refusal an administrator without a role earns.
 *
 * One sentence for the two shapes it covers — an account with no role and a
 * session whose account is gone — because the remedy an operator is given is
 * the same: a platform administrator assigns a role.
 */
export function adminRoleRequiredRefusal(): HttpError {
  return new HttpError(
    403,
    ERROR_CODES.ADMIN_ROLE_REQUIRED,
    'This administrator account has no role, so it cannot be told what it may do or reach. ' +
      'A platform administrator must assign it a role.',
  );
}

export class PermissionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly adminUsers: AdminUserReadPort,
  ) {}

  async hasPermission(adminUserId: string, permission: string): Promise<boolean> {
    const admin = await this.adminUsers.findById(adminUserId, { activeOnly: true });
    if (!admin || admin.status !== 'active') return false;
    const role = await this.#roleById(admin.adminRoleId);
    if (!role) throw adminRoleRequiredRefusal();
    return role.permissions.includes('*') || role.permissions.includes(permission);
  }

  async listPermissions(adminUserId: string): Promise<string[]> {
    const admin = await this.adminUsers.findById(adminUserId, { activeOnly: true });
    const role = await this.#roleById(admin?.adminRoleId ?? null);
    return role?.permissions ?? [];
  }

  /**
   * The role an administrator acts under, or the refusal — returned rather
   * than thrown, for the caller that has to keep answering (`PermissionReadPort`).
   *
   * `activeOnly`: a deleted account is not an administrator, so a session that
   * outlived one resolves no role.
   */
  async resolveRole(adminUserId: string): Promise<AdminRoleResolution> {
    const admin = await this.adminUsers.findById(adminUserId, { activeOnly: true });
    const role = await this.#roleById(admin?.adminRoleId ?? null);
    return role ? { role: toAdminRoleRecord(role) } : { refusal: adminRoleRequiredRefusal() };
  }

  async #roleById(id: string | null | undefined): Promise<AdminRole | null> {
    if (!id) return null;
    return this.emFactory().findOne(AdminRole, { id });
  }
}
