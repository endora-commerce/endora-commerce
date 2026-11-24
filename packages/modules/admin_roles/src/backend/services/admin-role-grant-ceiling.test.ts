/**
 * A role written on an administrator's behalf is held to that administrator's
 * own permissions, and the roles the platform or a module seeds are changed
 * only by an administrator with full access. A write made with no acting
 * administrator — a module seeding its roles, the bootstrap command — is not.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdminRoleService,
  _resetSystemRoleCodesForTests,
  registerSystemRoleCode,
} from './admin-role-service.js';
import type { PermissionCatalogueService } from './permission-catalogue.service.js';

const KNOWN = [
  'orders:read',
  'orders:write',
  'catalog:read',
  'catalog:write',
  'admin_users:manage',
  'blog.read',
  'blog.write',
];

interface StoredRole {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  requiresTwoFactor: boolean;
}

function serviceOver(existing: StoredRole | null): {
  service: AdminRoleService;
  flushes: () => number;
  stored: () => StoredRole | null;
} {
  let flushes = 0;
  let row = existing;
  const em = {
    findOne: async () => row,
    create: (_entity: unknown, data: Omit<StoredRole, 'id'>) => {
      row = { id: 'new-role', ...data };
      return row;
    },
    persist: () => ({
      flush: async () => {
        flushes += 1;
      },
    }),
    flush: async () => {
      flushes += 1;
    },
  } as unknown as EntityManager;
  const service = new AdminRoleService(
    () => em,
    { listKnownCodes: () => KNOWN } as unknown as PermissionCatalogueService,
    { listByRoleId: async () => [] } as unknown as AdminUserReadPort,
  );
  return { service, flushes: () => flushes, stored: () => row };
}

const ROLE_MANAGER = { permissions: ['admin_users:manage', 'orders:read', 'blog.read', 'blog.write'] };
const FULL_ACCESS = { permissions: ['*'] };

afterEach(() => {
  _resetSystemRoleCodesForTests();
});

describe('AdminRoleService.upsertByCode — on behalf of an administrator', () => {
  it('creates a role whose permissions the administrator holds', async () => {
    const { service, stored } = serviceOver(null);

    await service.upsertByCode(
      { code: 'order_desk', name: 'Order desk', permissions: ['orders:read'] },
      { grantor: ROLE_MANAGER },
    );

    expect(stored()?.permissions).toEqual(['orders:read']);
  });

  it('refuses a role carrying a permission the administrator does not hold', async () => {
    const { service, flushes } = serviceOver(null);

    await expect(
      service.upsertByCode(
        { code: 'order_desk', name: 'Order desk', permissions: ['orders:read', 'catalog:write'] },
        { grantor: ROLE_MANAGER },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_ROLE_GRANT_EXCEEDED',
      details: { permissions: 'catalog:write' },
    });
    expect(flushes()).toBe(0);
  });

  it('refuses full access to an administrator who does not have it', async () => {
    const { service, flushes } = serviceOver(null);

    await expect(
      service.upsertByCode(
        { code: 'everything', name: 'Everything', permissions: ['*'] },
        { grantor: ROLE_MANAGER },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_GRANT_EXCEEDED' });
    expect(flushes()).toBe(0);
  });

  it('refuses to change a role that already holds more than the administrator', async () => {
    const { service, stored } = serviceOver({
      id: 'r-senior',
      code: 'senior_ops',
      name: 'Senior ops',
      permissions: ['orders:read', 'orders:write', 'catalog:write'],
      requiresTwoFactor: true,
    });

    await expect(
      service.upsertByCode(
        {
          code: 'senior_ops',
          name: 'Senior ops',
          permissions: ['orders:read'],
          requiresTwoFactor: false,
        },
        { grantor: ROLE_MANAGER },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_ROLE_GRANT_EXCEEDED',
      details: { permissions: 'orders:write, catalog:write' },
    });
    expect(stored()?.requiresTwoFactor).toBe(true);
    expect(stored()?.permissions).toEqual(['orders:read', 'orders:write', 'catalog:write']);
  });

  it('refuses to change a role a module seeds, even within the administrator\'s permissions', async () => {
    registerSystemRoleCode('blog_manager');
    const { service, stored } = serviceOver({
      id: 'r-blog',
      code: 'blog_manager',
      name: 'Blog Manager',
      permissions: ['blog.read', 'blog.write'],
      requiresTwoFactor: false,
    });

    await expect(
      service.upsertByCode(
        { code: 'blog_manager', name: 'Bloggers', permissions: ['blog.read'] },
        { grantor: ROLE_MANAGER },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ROLE_PROTECTED',
      details: { role: 'blog_manager', code: 'modify' },
    });
    expect(stored()?.name).toBe('Blog Manager');
  });

  it('refuses any change to the platform-administrator role, its two-factor flag included', async () => {
    const { service, stored } = serviceOver({
      id: 'r-pa',
      code: 'platform_admin',
      name: 'Platform administrator',
      permissions: ['*'],
      requiresTwoFactor: true,
    });

    await expect(
      service.upsertByCode(
        {
          code: 'platform_admin',
          name: 'Platform administrator',
          permissions: ['*'],
          requiresTwoFactor: false,
        },
        { grantor: ROLE_MANAGER },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ADMIN_ROLE_PROTECTED' });
    expect(stored()?.requiresTwoFactor).toBe(true);
  });

  it('lets a full-access administrator rename a seeded role and set the platform role\'s two-factor flag', async () => {
    registerSystemRoleCode('blog_manager');
    const blog = serviceOver({
      id: 'r-blog',
      code: 'blog_manager',
      name: 'Blog Manager',
      permissions: ['blog.read', 'blog.write'],
      requiresTwoFactor: false,
    });
    await blog.service.upsertByCode(
      { code: 'blog_manager', name: 'Bloggers', permissions: ['blog.read', 'blog.write'] },
      { grantor: FULL_ACCESS },
    );
    expect(blog.stored()?.name).toBe('Bloggers');

    const platform = serviceOver({
      id: 'r-pa',
      code: 'platform_admin',
      name: 'Platform administrator',
      permissions: ['*'],
      requiresTwoFactor: true,
    });
    await platform.service.upsertByCode(
      {
        code: 'platform_admin',
        name: 'Platform administrator',
        permissions: ['*'],
        requiresTwoFactor: false,
      },
      { grantor: FULL_ACCESS },
    );
    expect(platform.stored()?.requiresTwoFactor).toBe(false);
  });
});

describe('AdminRoleService.upsertByCode — a platform write', () => {
  it('still lets a module refresh the role it seeds', async () => {
    registerSystemRoleCode('blog_manager');
    const { service, stored } = serviceOver({
      id: 'r-blog',
      code: 'blog_manager',
      name: 'Bloggers',
      permissions: ['blog.read'],
      requiresTwoFactor: false,
    });

    await service.upsertByCode({
      code: 'blog_manager',
      name: 'Bloggers',
      permissions: ['blog.read', 'blog.write'],
      requiresTwoFactor: false,
    });

    expect(stored()?.permissions).toEqual(['blog.read', 'blog.write']);
  });

  it('still lets the bootstrap command create the full-access platform role', async () => {
    const { service, stored } = serviceOver(null);

    await service.upsertByCode({
      code: 'platform_admin',
      name: 'Platform administrator',
      permissions: ['*'],
      requiresTwoFactor: false,
    });

    expect(stored()?.permissions).toEqual(['*']);
  });
});
