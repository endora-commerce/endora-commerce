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
    avatarAssetId: null,
    bio: null,
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

describe('PermissionService.isActiveAdministrator', () => {
  it('answers yes for an active account, with or without a role', async () => {
    expect(await serviceOver(admin({}), PLATFORM).isActiveAdministrator('a1')).toBe(true);
    expect(
      await serviceOver(admin({ adminRoleId: null }), PLATFORM).isActiveAdministrator('a1'),
    ).toBe(true);
  });

  it('answers no for a deactivated account and for an id that names nobody', async () => {
    expect(
      await serviceOver(admin({ status: 'inactive' }), PLATFORM).isActiveAdministrator('a1'),
    ).toBe(false);
    expect(await serviceOver(null, PLATFORM).isActiveAdministrator('nobody')).toBe(false);
  });

  it('asks for live accounts only, so a deleted one is not found', async () => {
    const asked: unknown[] = [];
    const adminUsers = {
      findById: async (_id: string, options: unknown) => {
        asked.push(options);
        return null;
      },
    } as unknown as AdminUserReadPort;
    const service = new PermissionService(() => ({}) as EntityManager, adminUsers);
    expect(await service.isActiveAdministrator('a1')).toBe(false);
    expect(asked).toEqual([{ activeOnly: true }]);
  });
});

/**
 * Issue #461 — the batched twins of `resolveRole` and `hasPermission`, for a
 * caller asking about many administrators at once (the Projects `@` list).
 * Each answers, per id, what the single call answers, in two statements
 * whatever the number of ids.
 */
describe('PermissionService — batched (issue #461)', () => {
  const OTHER_ROLE_ID = '00000000-0000-4000-8000-0000000000c2';
  const ROLES = [
    { ...PLATFORM, name: 'platform_admin', requiresTwoFactor: false, createdAt: new Date(0), updatedAt: new Date(0) },
    {
      id: OTHER_ROLE_ID,
      code: 'reader',
      name: 'reader',
      permissions: ['orders:read'],
      requiresTwoFactor: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ];
  const ACCOUNTS = [
    admin({ id: 'a1' }),
    admin({ id: 'a2', adminRoleId: OTHER_ROLE_ID }),
    admin({ id: 'a3', adminRoleId: OTHER_ROLE_ID, status: 'inactive' }),
    admin({ id: 'a4', adminRoleId: null }),
    admin({ id: 'a5', adminRoleId: '00000000-0000-4000-8000-0000000000ff' }),
  ];

  function batchedService(accounts: AdminUserRecord[] = ACCOUNTS) {
    const calls = { findByIds: 0, findById: 0, roleReads: 0 };
    const em = {
      find: async (_entity: unknown, where: { id: { $in: string[] } }) => {
        calls.roleReads += 1;
        return ROLES.filter((role) => where.id.$in.includes(role.id));
      },
      findOne: async (_entity: unknown, where: { id: string }) => {
        calls.roleReads += 1;
        return ROLES.find((role) => role.id === where.id) ?? null;
      },
    } as unknown as EntityManager;
    const adminUsers = {
      findById: async (id: string) => {
        calls.findById += 1;
        return accounts.find((account) => account.id === id) ?? null;
      },
      findByIds: async (ids: readonly string[], options: unknown) => {
        calls.findByIds += 1;
        expect(options).toEqual({ activeOnly: true });
        return accounts.filter((account) => ids.includes(account.id));
      },
    } as unknown as AdminUserReadPort;
    return { service: new PermissionService(() => em, adminUsers), calls };
  }

  it('resolveRoles answers, for every id asked, what resolveRole answers', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'nobody'];
    const { service, calls } = batchedService();
    const batched = await service.resolveRoles([...ids, 'a1']);
    expect(calls).toEqual({ findByIds: 1, findById: 0, roleReads: 1 });
    expect([...batched.keys()].sort()).toEqual([...ids].sort());
    const single = batchedService().service;
    for (const id of ids) {
      const one = await single.resolveRole(id);
      const many = batched.get(id)!;
      expect(many.role, id).toEqual(one.role);
      expect(many.refusal === undefined, id).toBe(one.refusal === undefined);
      if (many.refusal) expect(many.refusal).toMatchObject({ statusCode: 403, code: 'ADMIN_ROLE_REQUIRED' });
    }
  });

  it('resolveRoles asks nothing for no ids', async () => {
    const { service, calls } = batchedService();
    expect((await service.resolveRoles([])).size).toBe(0);
    expect(calls).toEqual({ findByIds: 0, findById: 0, roleReads: 0 });
  });

  it('holdersOf names the ids hasPermission answers yes for', async () => {
    const accounts = ACCOUNTS.filter((account) => account.id !== 'a4' && account.id !== 'a5');
    const ids = ['a1', 'a2', 'a3', 'nobody'];
    for (const code of ['orders:read', 'orders:write']) {
      const { service, calls } = batchedService(accounts);
      const holders = await service.holdersOf(ids, code);
      expect(calls).toEqual({ findByIds: 1, findById: 0, roleReads: 1 });
      const single = batchedService(accounts).service;
      const expected: string[] = [];
      for (const id of ids) if (await single.hasPermission(id, code)) expected.push(id);
      expect([...holders].sort(), code).toEqual(expected.sort());
    }
  });

  it('holdersOf refuses, as hasPermission does, an active administrator with no role', async () => {
    for (const roleless of ['a4', 'a5']) {
      await expect(batchedService().service.holdersOf(['a1', roleless], 'orders:read')).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_ROLE_REQUIRED',
      });
    }
  });
});
