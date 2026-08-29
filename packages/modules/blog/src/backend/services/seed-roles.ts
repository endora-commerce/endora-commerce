import type { AdminRolePort, SystemRoleCodePort } from '@endora-commerce/contracts';

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
 *
 * **Both rows are written through `adminRolePort`** since feature 075 drained
 * `blog`'s cross-module-import shard. Until then this file selected, inserted
 * and updated the `admin_roles` table in raw SQL — a boundary that compiled and
 * returned rows, because a statement in a string names no import specifier, and
 * the one entry the shard carried. Two things follow from the port that the SQL
 * did not give us: the seeded rows now carry an audit entry like every other
 * role write (Constitution XIII), and their permission codes are validated
 * against the platform's catalogue rather than trusted.
 *
 * `upsertByCode` assigns `name` from its input unconditionally, so preserving
 * an operator's rename is this seeder's job and is done the only way the port's
 * shape allows: read the row first, and hand its current name straight back on
 * the refresh. A blind upsert here would silently rename "Bloger" to
 * "Blog Manager" at every boot.
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

function hasDrifted(want: readonly string[], have: readonly string[]): boolean {
  const wanted = [...want].sort();
  const held = [...have].sort();
  return wanted.length !== held.length || wanted.some((code, i) => code !== held[i]);
}

export async function seedBlogRoles(
  adminRoles: AdminRolePort,
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

  const results: BlogRoleSeedResult[] = [];

  for (const def of SEED_DEFINITIONS) {
    const existing = await adminRoles.findByCode(def.code);

    if (existing === null) {
      const created = await adminRoles.upsertByCode({
        code: def.code,
        name: def.defaultName,
        permissions: def.permissions,
        requiresTwoFactor: false,
      });
      results.push({ code: def.code, id: created.id, created: true, permissionsRefreshed: false });
      continue;
    }

    const drifted = hasDrifted(def.permissions, existing.permissions);
    if (drifted) {
      await adminRoles.upsertByCode({
        code: def.code,
        // The operator's own name and two-factor choice, handed back
        // unchanged: this call exists to correct the permission array and
        // nothing else.
        name: existing.name,
        permissions: def.permissions,
        requiresTwoFactor: existing.requiresTwoFactor,
      });
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
