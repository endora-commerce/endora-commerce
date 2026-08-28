import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRolePort, AdminUserReadPort, SystemRoleCodePort } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { AdminRoleService } from '../../../../packages/modules/admin_roles/src/backend/services/admin-role-service.js';
import { createAdminRolePort } from '../../../../packages/modules/admin_roles/src/backend/services/admin-role-ports.js';
import { PermissionCatalogueService } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import {
  BLOG_ROLE_CODES,
  seedBlogRoles,
} from '../../../../packages/modules/blog/src/backend/services/seed-roles.js';

/**
 * `admin_roles`' deletion-protection registry, as the seeder receives it since
 * feature 075's Phase C — a port argument rather than a module-level function
 * imported out of `admin_roles`. Recording it here is what makes the
 * registration assertable at all: pushing into a process singleton was
 * invisible from this suite.
 */
function recordingSystemRoleCodes(): SystemRoleCodePort & { readonly registered: string[] } {
  const registered: string[] = [];
  return {
    registered,
    register: (code) => {
      registered.push(code);
    },
    list: () => [...registered],
  };
}

/**
 * The real `adminRolePort`, over this suite's transaction.
 *
 * The seeder writes its two rows through it since feature 075's boundary drain,
 * where it used to run three raw SQL statements against `admin_roles`' own
 * table. Building the owner's port here rather than faking it is the point of
 * keeping this file: `upsertByCode` assigns `name` from its input, so "the
 * admin's rename survives a rerun" is a claim about *that* implementation, and
 * a fake that got it wrong would agree with the seeder either way.
 * `test/unit/blog/seed-roles.test.ts` covers the seeder's own decisions.
 */
function realAdminRolePort(db: TestDb): AdminRolePort {
  const adminUsers: AdminUserReadPort = {
    findById: () => {
      throw new Error('the seeder never reads an admin user');
    },
    findByIds: () => {
      throw new Error('the seeder never reads an admin user');
    },
    findByEmail: () => {
      throw new Error('the seeder never reads an admin user');
    },
    listAll: () => {
      throw new Error('the seeder never reads an admin user');
    },
    listByRoleId: () => {
      throw new Error('the seeder never deletes a role, so nothing counts its holders');
    },
  };
  const service = new AdminRoleService(
    () => db.em(),
    new PermissionCatalogueService({ registryEntries: REGISTERED_MANIFESTS }),
    adminUsers,
  );
  return createAdminRolePort(() => db.em(), () => service);
}

async function loadRole(
  em: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  code: string,
): Promise<{ name: string; permissions: string[] }> {
  const rows = (await em.execute(
    'select name, permissions from admin_roles where code = ?',
    [code],
  )) as Array<{ name: string; permissions: string[] }>;
  if (rows.length === 0) throw new Error(`role ${code} not found`);
  return rows[0]!;
}

describe('seedBlogRoles (T024 — idempotent + admin-edit-safe)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    // Nothing to sweep: the seed writes belong to each test's transaction and
    // go away with `rollbackTx`. This used to delete the two role rows here
    // because the seed ran through a connection-level `execute`, which carries
    // no transaction context and committed them past the rollback (issue #200)
    // — and the delete then took the platform's own rows with it.
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    const em = db.em();
    // Each test starts from a clean slate for the two seeded codes.
    await em.execute(
      `delete from admin_users where admin_role_id in (select id from admin_roles where code in (?, ?))`,
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER],
    );
    await em.execute(
      `delete from admin_roles where code in (?, ?)`,
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER],
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('upserts both roles on first run with the canonical permission set', async () => {
    const codes = recordingSystemRoleCodes();
    const r = await seedBlogRoles(realAdminRolePort(db), codes);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.created)).toBe(true);
    // Both seeded codes are handed to the registry that refuses their deletion.
    expect([...codes.registered].sort()).toEqual(
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER].sort(),
    );

    const em = db.em();
    const blog = await loadRole(em, 'blog_manager');
    expect(blog.name).toBe('Blog Manager');
    expect([...blog.permissions].sort()).toEqual(['blog.read', 'blog.write']);

    const content = await loadRole(em, 'content_manager');
    expect(content.name).toBe('Content Manager');
    expect([...content.permissions].sort()).toEqual([
      'blog.read',
      'blog.write',
      'cms.read',
      'cms.write',
    ]);
  });

  it('preserves admin-edited name across reruns', async () => {
    await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const em = db.em();
    await em.execute(
      `update admin_roles set name = 'Bloger', updated_at = now() where code = 'blog_manager'`,
    );

    const r = await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const blogReloaded = await loadRole(em, 'blog_manager');
    expect(blogReloaded.name).toBe('Bloger');
    expect(r.find((x) => x.code === 'blog_manager')!.permissionsRefreshed).toBe(false);
  });

  it('preserves the admin-edited name even on the rerun that refreshes permissions', async () => {
    await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const em = db.em();
    // Both edits at once: the operator renamed the role, and its permissions
    // drifted. The refresh writes through `upsertByCode`, which assigns `name`
    // from its input — so this is the run where a blind upsert would rename
    // "Bloger" back to "Blog Manager" and nobody would notice until the
    // operator looked.
    await em.execute(
      `update admin_roles set name = 'Bloger', permissions = '["blog.read"]'::jsonb,
       updated_at = now() where code = 'blog_manager'`,
    );

    const r = await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const after = await loadRole(em, 'blog_manager');
    expect(after.name).toBe('Bloger');
    expect([...after.permissions].sort()).toEqual(['blog.read', 'blog.write']);
    expect(r.find((x) => x.code === 'blog_manager')!.permissionsRefreshed).toBe(true);
  });

  it('refreshes permissions if they drift from the canonical set', async () => {
    await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const em = db.em();
    await em.execute(
      `update admin_roles set permissions = '["blog.read"]'::jsonb, updated_at = now() where code = 'blog_manager'`,
    );

    const r = await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const after = await loadRole(em, 'blog_manager');
    expect([...after.permissions].sort()).toEqual(['blog.read', 'blog.write']);
    expect(r.find((x) => x.code === 'blog_manager')!.permissionsRefreshed).toBe(true);
  });

  it('is idempotent — second run when nothing changed marks created=false and permissionsRefreshed=false', async () => {
    await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    const r = await seedBlogRoles(realAdminRolePort(db), recordingSystemRoleCodes());
    expect(r.every((x) => !x.created)).toBe(true);
    expect(r.every((x) => !x.permissionsRefreshed)).toBe(true);
  });
});
