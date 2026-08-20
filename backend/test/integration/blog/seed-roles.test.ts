import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SystemRoleCodePort } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  BLOG_ROLE_CODES,
  seedBlogRoles,
} from '../../../src/modules/blog/services/seed-roles.js';

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
    const r = await seedBlogRoles(() => db.em(), codes);
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
    await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    const em = db.em();
    await em.execute(
      `update admin_roles set name = 'Bloger', updated_at = now() where code = 'blog_manager'`,
    );

    const r = await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    const blogReloaded = await loadRole(em, 'blog_manager');
    expect(blogReloaded.name).toBe('Bloger');
    expect(r.find((x) => x.code === 'blog_manager')!.permissionsRefreshed).toBe(false);
  });

  it('refreshes permissions if they drift from the canonical set', async () => {
    await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    const em = db.em();
    await em.execute(
      `update admin_roles set permissions = '["blog.read"]'::jsonb, updated_at = now() where code = 'blog_manager'`,
    );

    const r = await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    const after = await loadRole(em, 'blog_manager');
    expect([...after.permissions].sort()).toEqual(['blog.read', 'blog.write']);
    expect(r.find((x) => x.code === 'blog_manager')!.permissionsRefreshed).toBe(true);
  });

  it('is idempotent — second run when nothing changed marks created=false and permissionsRefreshed=false', async () => {
    await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    const r = await seedBlogRoles(() => db.em(), recordingSystemRoleCodes());
    expect(r.every((x) => !x.created)).toBe(true);
    expect(r.every((x) => !x.permissionsRefreshed)).toBe(true);
  });
});
