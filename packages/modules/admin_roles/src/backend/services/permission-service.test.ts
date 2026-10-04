/**
 * An administrator always acts under a role.
 *
 * The permission check and the tenant reach of an admin are both read off the
 * role the admin holds. An admin with no role is therefore not "an admin with
 * no permissions" — it is a state with no answer, and it is refused by name so
 * the operator is told what to repair rather than shown an empty panel.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort, AdminUserRecord } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { PermissionService } from './permission-service.js';

const ROLE_ID = '00000000-0000-4000-8000-0000000000c1';

function admin(overrides: Partial<AdminUserRecord>): AdminUserRecord {
  return {
    id: 'a1',
    email: 'admin@example.com',
    firstName: 'Ada',
    lastName: 'Admin',
    adminRoleId: ROLE_ID,
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    deletedAt: null,
    ...overrides,
  } as AdminUserRecord;
}

function serviceOver(
  found: AdminUserRecord | null,
  role: { id: string; code: string; permissions: string[] } | null,
): PermissionService {
  const em = {
    findOne: async (_entity: unknown, where: { id: string }) =>
      role && role.id === where.id
        ? { ...role, name: role.code, requiresTwoFactor: false, createdAt: new Date(0), updatedAt: new Date(0) }
        : null,
  } as unknown as EntityManager;
  const adminUsers = { findById: async () => found } as unknown as AdminUserReadPort;
  return new PermissionService(() => em, adminUsers);
}

const PLATFORM = { id: ROLE_ID, code: 'platform_admin', permissions: ['*'] };
const READER = { id: ROLE_ID, code: 'reader', permissions: ['orders:read'] };

describe('PermissionService.resolveRole', () => {
  it('answers the role an administrator holds', async () => {
    const resolution = await serviceOver(admin({}), PLATFORM).resolveRole('a1');
    expect(resolution.role?.code).toBe('platform_admin');
    expect(resolution.refusal).toBeUndefined();
  });

  it('answers a refusal for an administrator with no role', async () => {
    const resolution = await serviceOver(admin({ adminRoleId: null }), PLATFORM).resolveRole('a1');
    expect(resolution.role).toBeUndefined();
    expect(resolution.refusal).toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });
  });

  it('answers a refusal for a role that no longer exists', async () => {
    const resolution = await serviceOver(admin({}), null).resolveRole('a1');
    expect(resolution.refusal).toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });
  });

  it('answers a refusal for an id that names no administrator', async () => {
    const resolution = await serviceOver(null, PLATFORM).resolveRole('nobody');
    expect(resolution.refusal).toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });
  });
});

describe('PermissionService.hasPermission', () => {
  it('grants what the role holds, and everything under the wildcard', async () => {
    expect(await serviceOver(admin({}), PLATFORM).hasPermission('a1', 'anything:at-all')).toBe(true);
    expect(await serviceOver(admin({}), READER).hasPermission('a1', 'orders:read')).toBe(true);
    expect(await serviceOver(admin({}), READER).hasPermission('a1', 'orders:write')).toBe(false);
  });

  it('refuses an active administrator with no role by name, rather than answering "no"', async () => {
    await expect(
      serviceOver(admin({ adminRoleId: null }), PLATFORM).hasPermission('a1', 'orders:read'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });
  });

  it('still answers "no" for an unknown or inactive administrator', async () => {
    expect(await serviceOver(null, PLATFORM).hasPermission('nobody', 'orders:read')).toBe(false);
    expect(
      await serviceOver(admin({ status: 'inactive' }), PLATFORM).hasPermission('a1', 'orders:read'),
    ).toBe(false);
  });

  it('lists no permission for an administrator with no role', async () => {
    expect(await serviceOver(admin({ adminRoleId: null }), PLATFORM).listPermissions('a1')).toEqual([]);
  });
});
