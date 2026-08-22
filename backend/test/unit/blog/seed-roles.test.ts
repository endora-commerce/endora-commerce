import { describe, expect, it } from 'vitest';
import type {
  AdminRolePort,
  AdminRoleRecord,
  SystemRoleCodePort,
  UpsertAdminRoleInput,
} from '@endora-commerce/contracts';
import { BLOG_ROLE_CODES, seedBlogRoles } from '../../../src/modules/blog/services/seed-roles.js';

/**
 * `seedBlogRoles` reaches `admin_roles` through `adminRolePort` (feature 075).
 *
 * It used to write the `admin_roles` table in three raw SQL statements — a
 * boundary that compiled and returned rows, since SQL names no import
 * specifier, and the one entry `blog`'s cross-module-import shard carried. What
 * the seeder does over that seam is what this file pins, because the port's
 * `upsertByCode` **overwrites** `name` and the seeder must not (FR-025): the
 * name an operator edited has to survive every rerun.
 *
 * A fake port rather than the real one: the seeder's own decisions — create,
 * leave alone, refresh drifted permissions — are the subject, and each is
 * observable as a call it did or did not make.
 * `test/integration/blog/seed-roles.test.ts` runs the same seeder over
 * `admin_roles`' real port and a real database, so "hands the existing name
 * back" is checked against the implementation that would overwrite it.
 */

interface RecordingAdminRolePort extends AdminRolePort {
  readonly upserts: UpsertAdminRoleInput[];
}

function fakeAdminRolePort(seed: readonly AdminRoleRecord[] = []): RecordingAdminRolePort {
  const rows = new Map<string, AdminRoleRecord>(seed.map((role) => [role.code, role]));
  const upserts: UpsertAdminRoleInput[] = [];
  const notNeeded = (method: string) => (): never => {
    throw new Error(`the seeder must not call ${method}`);
  };
  return {
    upserts,
    findByCode: async (code) => rows.get(code) ?? null,
    upsertByCode: async (input) => {
      upserts.push(input);
      const existing = rows.get(input.code);
      // Faithful to `AdminRoleService.upsertByCode`: `name` is assigned from
      // the input on an existing row, which is exactly the overwrite the
      // seeder has to avoid asking for.
      const row: AdminRoleRecord = {
        id: existing?.id ?? `id-${input.code}`,
        code: input.code,
        name: input.name,
        permissions: input.permissions,
        requiresTwoFactor: input.requiresTwoFactor ?? existing?.requiresTwoFactor ?? false,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      rows.set(input.code, row);
      return row;
    },
    list: notNeeded('list'),
    getById: notNeeded('getById'),
    remove: notNeeded('remove'),
  };
}

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

function roleRecord(overrides: Partial<AdminRoleRecord> & { code: string }): AdminRoleRecord {
  return {
    id: `id-${overrides.code}`,
    name: 'Seeded',
    permissions: [],
    requiresTwoFactor: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('seedBlogRoles over adminRolePort', () => {
  it('creates both roles with the canonical names and permission sets', async () => {
    const roles = fakeAdminRolePort();
    const codes = recordingSystemRoleCodes();

    const results = await seedBlogRoles(roles, codes);

    expect(results.map((r) => r.code).sort()).toEqual(
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER].sort(),
    );
    expect(results.every((r) => r.created)).toBe(true);
    expect(results.every((r) => !r.permissionsRefreshed)).toBe(true);
    expect(results.every((r) => r.id.length > 0)).toBe(true);

    expect(roles.upserts).toEqual([
      {
        code: BLOG_ROLE_CODES.BLOG_MANAGER,
        name: 'Blog Manager',
        permissions: ['blog.read', 'blog.write'],
        requiresTwoFactor: false,
      },
      {
        code: BLOG_ROLE_CODES.CONTENT_MANAGER,
        name: 'Content Manager',
        permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
        requiresTwoFactor: false,
      },
    ]);
  });

  it('registers both seeded codes as deletion-protected', async () => {
    const codes = recordingSystemRoleCodes();
    await seedBlogRoles(fakeAdminRolePort(), codes);
    expect([...codes.registered].sort()).toEqual(
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER].sort(),
    );
  });

  it('registers the codes even when every role row already exists', async () => {
    const codes = recordingSystemRoleCodes();
    await seedBlogRoles(
      fakeAdminRolePort([
        roleRecord({
          code: BLOG_ROLE_CODES.BLOG_MANAGER,
          permissions: ['blog.read', 'blog.write'],
        }),
        roleRecord({
          code: BLOG_ROLE_CODES.CONTENT_MANAGER,
          permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
        }),
      ]),
      codes,
    );
    expect([...codes.registered].sort()).toEqual(
      [BLOG_ROLE_CODES.BLOG_MANAGER, BLOG_ROLE_CODES.CONTENT_MANAGER].sort(),
    );
  });

  it('writes nothing on a rerun where nothing drifted', async () => {
    const roles = fakeAdminRolePort([
      roleRecord({
        code: BLOG_ROLE_CODES.BLOG_MANAGER,
        name: 'Bloger',
        permissions: ['blog.write', 'blog.read'],
      }),
      roleRecord({
        code: BLOG_ROLE_CODES.CONTENT_MANAGER,
        permissions: ['cms.write', 'blog.read', 'cms.read', 'blog.write'],
      }),
    ]);

    const results = await seedBlogRoles(roles, recordingSystemRoleCodes());

    expect(roles.upserts, 'an idempotent seeder rewrote rows it had nothing to change').toEqual([]);
    expect(results.every((r) => !r.created && !r.permissionsRefreshed)).toBe(true);
  });

  it('hands the admin-edited name back when it refreshes drifted permissions', async () => {
    const roles = fakeAdminRolePort([
      roleRecord({
        code: BLOG_ROLE_CODES.BLOG_MANAGER,
        name: 'Bloger',
        permissions: ['blog.read'],
        requiresTwoFactor: true,
      }),
      roleRecord({
        code: BLOG_ROLE_CODES.CONTENT_MANAGER,
        permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
      }),
    ]);

    const results = await seedBlogRoles(roles, recordingSystemRoleCodes());

    expect(roles.upserts).toEqual([
      {
        code: BLOG_ROLE_CODES.BLOG_MANAGER,
        // `upsertByCode` assigns `name` unconditionally, so the only way to
        // preserve the operator's edit is to send it back unchanged.
        name: 'Bloger',
        permissions: ['blog.read', 'blog.write'],
        requiresTwoFactor: true,
      },
    ]);
    const blogManager = results.find((r) => r.code === BLOG_ROLE_CODES.BLOG_MANAGER)!;
    expect(blogManager.created).toBe(false);
    expect(blogManager.permissionsRefreshed).toBe(true);
    expect(blogManager.id).toBe(`id-${BLOG_ROLE_CODES.BLOG_MANAGER}`);
  });

  it('refreshes a permission set that gained a code it should not carry', async () => {
    const roles = fakeAdminRolePort([
      roleRecord({
        code: BLOG_ROLE_CODES.BLOG_MANAGER,
        name: 'Blog Manager',
        permissions: ['blog.read', 'blog.write', 'catalog.write'],
      }),
      roleRecord({
        code: BLOG_ROLE_CODES.CONTENT_MANAGER,
        permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
      }),
    ]);

    await seedBlogRoles(roles, recordingSystemRoleCodes());

    expect(roles.upserts.map((u) => u.permissions)).toEqual([['blog.read', 'blog.write']]);
  });
});
