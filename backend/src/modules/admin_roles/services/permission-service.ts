import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../entities/admin-role.entity.js';

/**
 * PermissionService (T187). Looks up an AdminUser's Role and checks if a
 * specific permission string is present in the Role's permissions array.
 *
 * The wildcard `*` in a Role's permissions grants every permission — used for
 * the bootstrap "platform admin" Role.
 */
export class PermissionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async hasPermission(adminUserId: string, permission: string): Promise<boolean> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { id: adminUserId, deletedAt: null });
    if (!admin || admin.status !== 'active' || !admin.adminRoleId) return false;
    const role = await em.findOne(AdminRole, { id: admin.adminRoleId });
    if (!role) return false;
    return role.permissions.includes('*') || role.permissions.includes(permission);
  }

  async listPermissions(adminUserId: string): Promise<string[]> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { id: adminUserId, deletedAt: null });
    if (!admin?.adminRoleId) return [];
    const role = await em.findOne(AdminRole, { id: admin.adminRoleId });
    return role?.permissions ?? [];
  }
}
