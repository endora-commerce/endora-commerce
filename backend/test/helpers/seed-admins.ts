import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminRole, AdminUser } from './package-entities.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import { TEST_ADMIN_ID } from './test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from './seed-organizations.js';

/** Restricted admin id used by T181 permissions test. */
export const TEST_RESTRICTED_ADMIN_ID = '00000000-0000-4000-8000-0000000000b2';
export const TEST_BLOG_MANAGER_ID = '00000000-0000-4000-8000-0000000000b3';
export const TEST_CONTENT_MANAGER_ID = '00000000-0000-4000-8000-0000000000b4';
export const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-0000000000c1';
export const READ_ONLY_ROLE_ID = '00000000-0000-4000-8000-0000000000c2';
export const BLOG_MANAGER_ROLE_ID = '00000000-0000-4000-8000-0000000000c3';
export const CONTENT_MANAGER_ROLE_ID = '00000000-0000-4000-8000-0000000000c4';

/**
 * Seeds four AdminRoles + four AdminUsers backing the test session cookies.
 *   - PlatformAdmin role: ['*'] → grants every permission.
 *   - ReadOnly role: ['orders:read'] → demonstrates 403 on writes.
 *   - BlogManager role (feature 016): ['blog.read', 'blog.write'].
 *   - ContentManager role (feature 016): ['blog.*', 'cms.*'].
 *
 * The Blog and Content Manager roles share their `code` with the
 * seeded codes the blog plugin's reconciler manages (`blog_manager`,
 * `content_manager`). The reconciler probes by code, finds the row,
 * refreshes the canonical permissions if drifted, and otherwise leaves
 * it alone — making the test seeder + the runtime reconciler co-operate
 * idempotently.
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
  const blogManagerRole = em.create(AdminRole, {
    id: BLOG_MANAGER_ROLE_ID,
    code: 'blog_manager',
    name: 'Blog Manager',
    permissions: ['blog.read', 'blog.write'],
  });
  const contentManagerRole = em.create(AdminRole, {
    id: CONTENT_MANAGER_ROLE_ID,
    code: 'content_manager',
    name: 'Content Manager',
    permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
  });
  await em.persistAndFlush([
    platformRole,
    readOnlyRole,
    blogManagerRole,
    contentManagerRole,
  ]);

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
  const blogManager = em.create(AdminUser, {
    id: TEST_BLOG_MANAGER_ID,
    email: 'blog-manager@example.com',
    passwordHash,
    firstName: 'Blog',
    lastName: 'Manager',
    adminRoleId: blogManagerRole.id,
    status: 'active',
  });
  const contentManager = em.create(AdminUser, {
    id: TEST_CONTENT_MANAGER_ID,
    email: 'content-manager@example.com',
    passwordHash,
    firstName: 'Content',
    lastName: 'Manager',
    adminRoleId: contentManagerRole.id,
    status: 'active',
  });
  await em.persistAndFlush([platformAdmin, restrictedAdmin, blogManager, contentManager]);
}
