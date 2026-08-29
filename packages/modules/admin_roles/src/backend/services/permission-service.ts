import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import { AdminRole } from '../entities/admin-role.entity.js';

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
 */
export class PermissionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly adminUsers: AdminUserReadPort,
  ) {}

  async hasPermission(adminUserId: string, permission: string): Promise<boolean> {
    const admin = await this.adminUsers.findById(adminUserId, { activeOnly: true });
    if (!admin || admin.status !== 'active' || !admin.adminRoleId) return false;
    const role = await this.emFactory().findOne(AdminRole, { id: admin.adminRoleId });
    if (!role) return false;
    return role.permissions.includes('*') || role.permissions.includes(permission);
  }

  async listPermissions(adminUserId: string): Promise<string[]> {
    const admin = await this.adminUsers.findById(adminUserId, { activeOnly: true });
    if (!admin?.adminRoleId) return [];
    const role = await this.emFactory().findOne(AdminRole, { id: admin.adminRoleId });
    return role?.permissions ?? [];
  }
}
