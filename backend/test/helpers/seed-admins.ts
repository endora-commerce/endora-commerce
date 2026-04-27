import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminUser } from '../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../../src/modules/admin_roles/entities/admin-role.entity.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import { TEST_ADMIN_ID } from './test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from './seed-organizations.js';

/** Restricted admin id used by T181 permissions test. */
export const TEST_RESTRICTED_ADMIN_ID = '00000000-0000-4000-8000-0000000000b2';
export const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-0000000000c1';
export const READ_ONLY_ROLE_ID = '00000000-0000-4000-8000-0000000000c2';

/**
 * Seeds two AdminRoles + two AdminUsers backing the stub-admin-session and
 * stub-restricted-admin-session cookies.
 *   - PlatformAdmin role: ['*'] → grants every permission.
 *   - ReadOnly role: ['orders:read'] → demonstrates 403 on writes.
 */
export async function seedTestAdmins(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);

  const platformRole = em.create(AdminRole, {
    id: PLATFORM_ADMIN_ROLE_ID,
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['*'],
  });
  const readOnlyRole = em.create(AdminRole, {
    id: READ_ONLY_ROLE_ID,
    code: 'read_only',
    name: 'Read-only Admin',
    permissions: ['orders:read'],
  });
  await em.persistAndFlush([platformRole, readOnlyRole]);

  const platformAdmin = em.create(AdminUser, {
    id: TEST_ADMIN_ID,
    email: 'platform-admin@example.com',
    passwordHash,
    firstName: 'Plat',
    lastName: 'Admin',
    adminRoleId: platformRole.id,
    status: 'active',
  });
  const restrictedAdmin = em.create(AdminUser, {
    id: TEST_RESTRICTED_ADMIN_ID,
    email: 'restricted-admin@example.com',
    passwordHash,
    firstName: 'Read',
    lastName: 'Only',
    adminRoleId: readOnlyRole.id,
    status: 'active',
  });
  await em.persistAndFlush([platformAdmin, restrictedAdmin]);
}
