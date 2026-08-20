import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import type { SystemRoleCodePort } from '@b2b/contracts';

/**
 * SeedBlogRoles — feature 016 / R8 / T025.
 *
 * Idempotent boot reconciler. Upserts two seeded admin roles:
 *
 *   blog_manager     ['blog.read', 'blog.write']
 *   content_manager  ['blog.read', 'blog.write', 'cms.read', 'cms.write']
 *
 * On rerun, the reconciler keeps the admin-edited `name` field intact
 * (FR-025 idempotency) and only refreshes the canonical permission array
 * if it has drifted from the documented set. This mirrors feature 014's
 * Hooks-seeder pattern.
 */

export const BLOG_ROLE_CODES = {
  BLOG_MANAGER: 'blog_manager',
  CONTENT_MANAGER: 'content_manager',
} as const;

const SEED_DEFINITIONS: Array<{
  code: string;
  defaultName: string;
  permissions: string[];
}> = [
  {
    code: BLOG_ROLE_CODES.BLOG_MANAGER,
    defaultName: 'Blog Manager',
    permissions: ['blog.read', 'blog.write'],
  },
  {
    code: BLOG_ROLE_CODES.CONTENT_MANAGER,
    defaultName: 'Content Manager',
    permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
  },
];

export interface BlogRoleSeedResult {
  code: string;
  id: string;
  created: boolean;
  permissionsRefreshed: boolean;
}

export async function seedBlogRoles(
  emFactory: () => EntityManager,
  systemRoleCodes: SystemRoleCodePort,
): Promise<BlogRoleSeedResult[]> {
  // Register the seeded codes as system-protected up-front. Idempotent,
  // and the registration must happen even when the rows already exist
  // (a fresh process boot starts with an empty in-memory registry).
  //
  // Through `systemRoleCodePort` since feature 075's Phase C, where this used
  // to import `admin_roles`' module-level `registerSystemRoleCode`. The seam is
  // the same one and its classification is unchanged: a contribution into an
  // ungated registry, so a `blog` that is off registers nothing and its seeded
  // roles are simply not protected — which is the right answer, because a
  // module that is not there has no seeded role to protect.
  for (const def of SEED_DEFINITIONS) {
    systemRoleCodes.register(def.code);
  }

  const em = emFactory();
  const results: BlogRoleSeedResult[] = [];

  for (const def of SEED_DEFINITIONS) {
    const rows = (await em.execute(
      'select id::text as id, permissions from admin_roles where code = ?',
      [def.code],
    )) as Array<{ id: string; permissions: string[] }>;

    if (rows.length === 0) {
      const id = randomUUID();
      await em.execute(
        `insert into admin_roles (id, code, name, permissions, requires_two_factor, created_at, updated_at)
         values (?, ?, ?, ?::jsonb, false, now(), now())`,
        [id, def.code, def.defaultName, JSON.stringify(def.permissions)],
      );
      results.push({ code: def.code, id, created: true, permissionsRefreshed: false });
      continue;
    }

    const existing = rows[0]!;
    const wantPerms = [...def.permissions].sort();
    const havePerms = [...(existing.permissions ?? [])].sort();
    const drifted =
      wantPerms.length !== havePerms.length ||
      wantPerms.some((p, i) => p !== havePerms[i]);
    if (drifted) {
      await em.execute(
        `update admin_roles set permissions = ?::jsonb, updated_at = now() where id = ?`,
        [JSON.stringify(def.permissions), existing.id],
      );
    }
    results.push({
      code: def.code,
      id: existing.id,
      created: false,
      permissionsRefreshed: drifted,
    });
  }

  return results;
}
