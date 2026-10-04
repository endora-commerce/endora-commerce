/**
 * An administrator account always holds a role.
 *
 * The admin surface is the ordinary way an account is created and edited, so it
 * is where the two ways of leaving one without a role are refused: creating an
 * account with none, and clearing the role of an account that has one.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminRolePort, AuthSessionPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminUserService, describeAdministratorsWithoutRole } from './admin-user-service.js';

const ROLE_ID = '00000000-0000-4000-8000-0000000000c1';

function serviceOver(existing?: AdminUser): { service: AdminUserService; persisted: AdminUser[] } {
  const persisted: AdminUser[] = [];
  const em = {
    findOne: async () => existing ?? null,
    create: (_entity: unknown, data: Partial<AdminUser>) => Object.assign(new AdminUser(), data),
    persistAndFlush: async (row: AdminUser) => {
      persisted.push(row);
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
  const roles = {
    getById: async (id: string) => ({ id, code: 'platform_admin' }),
  } as unknown as AdminRolePort;
  return {
    service: new AdminUserService(() => em, roles, {} as AuthSessionPort),
    persisted,
  };
}

const NEW_ADMIN = {
  email: 'new@example.com',
  password: 'a-password-they-remember',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

describe('AdminUserService — a role is required', () => {
  it('refuses to create an administrator with no role', async () => {
    const { service, persisted } = serviceOver();

    for (const adminRoleId of [undefined, null]) {
      await expect(
        service.create({ ...NEW_ADMIN, ...(adminRoleId === undefined ? {} : { adminRoleId }) }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'ADMIN_USER_ROLE_REQUIRED' });
    }
    expect(persisted).toEqual([]);
  });

  it('creates an administrator who is given a role', async () => {
    const { service, persisted } = serviceOver();
    await service.create({ ...NEW_ADMIN, adminRoleId: ROLE_ID });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.adminRoleId).toBe(ROLE_ID);
  });

  it('refuses to clear the role of an administrator', async () => {
    const existing = Object.assign(new AdminUser(), { id: 'a1', adminRoleId: ROLE_ID });
    const { service } = serviceOver(existing);

    await expect(service.update('a1', { adminRoleId: null })).rejects.toMatchObject({
      statusCode: 400,
      code: 'ADMIN_USER_ROLE_REQUIRED',
    });
    expect(existing.adminRoleId).toBe(ROLE_ID);
  });

  it('still changes one role for another, and edits that leave the role alone', async () => {
    const existing = Object.assign(new AdminUser(), { id: 'a1', adminRoleId: ROLE_ID });
    const { service } = serviceOver(existing);
    const other = '00000000-0000-4000-8000-0000000000c2';

    await service.update('a1', { firstName: 'Grace' });
    expect(existing.adminRoleId).toBe(ROLE_ID);
    await service.update('a1', { adminRoleId: other });
    expect(existing.adminRoleId).toBe(other);
  });
});

describe('the boot-time notice for administrators without a role', () => {
  it('says nothing when every administrator holds a role', () => {
    expect(describeAdministratorsWithoutRole(0)).toBeNull();
  });

  it('names how many are affected and how to repair it, from the Admin UI and the CLI', () => {
    const notice = describeAdministratorsWithoutRole(2);
    expect(notice).toContain('2 administrator account(s)');
    expect(notice).toContain('refused');
    expect(notice).toContain('admin_users create');
    expect(notice).toContain('platform_admin');
  });
});
