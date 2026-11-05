/**
 * An administrator manages accounts only up to their own permissions.
 *
 * Assigning a role hands out every permission it holds, so an administrator
 * without full access may assign only a role whose permissions they hold
 * themselves. And an account whose role holds more than the administrator does
 * is out of their reach: they may not change it, set its password, deactivate
 * it or delete it.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminRolePort, AdminRoleRecord, AuthSessionPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminUserService } from './admin-user-service.js';

const ROLES: Record<string, string[]> = {
  'role-full': ['*'],
  'role-orders': ['orders:read', 'orders:write'],
  'role-catalog': ['catalog:read', 'catalog:write'],
};

const USER_MANAGER = { permissions: ['admin_users:manage', 'orders:read', 'orders:write'] };
const FULL_ACCESS = { permissions: ['*'] };

function serviceOver(existing?: AdminUser): {
  service: AdminUserService;
  persisted: AdminUser[];
  flushes: () => number;
  revoked: string[];
} {
  const persisted: AdminUser[] = [];
  const revoked: string[] = [];
  let flushes = 0;
  const em = {
    findOne: async () => existing ?? null,
    create: (_entity: unknown, data: Partial<AdminUser>) => Object.assign(new AdminUser(), data),
    persistAndFlush: async (row: AdminUser) => {
      persisted.push(row);
    },
    flush: async () => {
      flushes += 1;
    },
  } as unknown as EntityManager;
  const roles = {
    getById: async (id: string) =>
      ({ id, code: id, name: id, permissions: ROLES[id] ?? [] }) as unknown as AdminRoleRecord,
  } as unknown as AdminRolePort;
  const sessions = {
    destroyAllForAdmin: async (adminUserId: string) => {
      revoked.push(adminUserId);
    },
  } as unknown as AuthSessionPort;
  return {
    service: new AdminUserService(() => em, roles, sessions),
    persisted,
    flushes: () => flushes,
    revoked,
  };
}

const NEW_ADMIN = {
  email: 'new@example.com',
  password: 'a-password-they-remember',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

function account(adminRoleId: string | null): AdminUser {
  return Object.assign(new AdminUser(), {
    id: '00000000-0000-4000-8000-781000000003',
    email: 'held@example.com',
    passwordHash: 'unchanged',
    firstName: 'Held',
    lastName: 'Account',
    adminRoleId,
    status: 'active',
    deletedAt: null,
  });
}

describe('AdminUserService — assigning a role', () => {
  it('creates an account with a role the administrator holds every permission of', async () => {
    const { service, persisted } = serviceOver();
    await service.create({ ...NEW_ADMIN, adminRoleId: 'role-orders' }, USER_MANAGER);
    expect(persisted).toHaveLength(1);
  });

  it('refuses to create an account with a role holding more than the administrator', async () => {
    const { service, persisted } = serviceOver();
    for (const adminRoleId of ['role-full', 'role-catalog']) {
      await expect(
        service.create({ ...NEW_ADMIN, adminRoleId }, USER_MANAGER),
      ).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_GRANT_EXCEEDED' });
    }
    expect(persisted).toEqual([]);
  });

  it('refuses to move an account onto a role holding more than the administrator', async () => {
    const existing = account('role-orders');
    const { service, flushes } = serviceOver(existing);

    await expect(
      service.update('00000000-0000-4000-8000-781000000003', { adminRoleId: 'role-full' }, USER_MANAGER),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_ROLE_GRANT_EXCEEDED',
      details: { permissions: '*' },
    });
    expect(existing.adminRoleId).toBe('role-orders');
    expect(flushes()).toBe(0);
  });

  it('lets a full-access administrator assign any role, full access included', async () => {
    const existing = account('role-orders');
    const { service } = serviceOver(existing);
    await service.update('00000000-0000-4000-8000-781000000003', { adminRoleId: 'role-full' }, FULL_ACCESS);
    expect(existing.adminRoleId).toBe('role-full');
  });
});

describe('AdminUserService — an account whose role holds more than the administrator', () => {
  it('is not changed, renamed or deactivated', async () => {
    for (const edit of [
      { firstName: 'Mallory' },
      { status: 'inactive' as const },
      { adminRoleId: 'role-orders' },
    ]) {
      const existing = account('role-full');
      const { service, flushes, revoked } = serviceOver(existing);
      await expect(service.update('00000000-0000-4000-8000-781000000003', edit, USER_MANAGER)).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_USER_OUTRANKS_ACTOR',
        details: { permissions: '*' },
      });
      expect(existing.firstName).toBe('Held');
      expect(existing.status).toBe('active');
      expect(existing.adminRoleId).toBe('role-full');
      expect(flushes()).toBe(0);
      expect(revoked).toEqual([]);
    }
  });

  it('does not have its password set', async () => {
    const existing = account('role-catalog');
    const { service, flushes, revoked } = serviceOver(existing);
    await expect(
      service.resetPassword('00000000-0000-4000-8000-781000000003', 'a-new-password-for-them', USER_MANAGER),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_USER_OUTRANKS_ACTOR' });
    expect(existing.passwordHash).toBe('unchanged');
    expect(flushes()).toBe(0);
    expect(revoked).toEqual([]);
  });

  it('is not deleted', async () => {
    const existing = account('role-full');
    const { service, flushes } = serviceOver(existing);
    await expect(service.softDelete('00000000-0000-4000-8000-781000000003', USER_MANAGER)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_USER_OUTRANKS_ACTOR',
    });
    expect(existing.deletedAt).toBeNull();
    expect(flushes()).toBe(0);
  });

  it('is still managed by a full-access administrator', async () => {
    const existing = account('role-full');
    const { service, revoked } = serviceOver(existing);
    await service.update('00000000-0000-4000-8000-781000000003', { status: 'inactive' }, FULL_ACCESS);
    expect(existing.status).toBe('inactive');
    expect(revoked).toEqual(['00000000-0000-4000-8000-781000000003']);
  });

  it('within the administrator\'s permissions is managed as before', async () => {
    const existing = account('role-orders');
    const { service } = serviceOver(existing);
    await service.resetPassword('00000000-0000-4000-8000-781000000003', 'a-new-password-for-them', USER_MANAGER);
    expect(existing.passwordHash).not.toBe('unchanged');
    await service.softDelete('00000000-0000-4000-8000-781000000003', USER_MANAGER);
    expect(existing.deletedAt).not.toBeNull();
  });
});
