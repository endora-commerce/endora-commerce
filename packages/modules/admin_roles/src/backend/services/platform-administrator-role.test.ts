/**
 * Every instance has the platform-administrator role.
 *
 * An administrator must hold a role, so there has to be one to hold before the
 * first administrator exists. Installation and boot both ensure it, and both
 * may run any number of times.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { AdminRole } from '../entities/admin-role.entity.js';
import {
  PLATFORM_ADMINISTRATOR_ROLE_CODE,
  ensurePlatformAdministratorRole,
} from './platform-administrator-role.js';

function tableOver(rows: AdminRole[]): EntityManager {
  return {
    findOne: async (_entity: unknown, where: { code: string }) =>
      rows.find((row) => row.code === where.code) ?? null,
    create: (_entity: unknown, data: Partial<AdminRole>) => Object.assign(new AdminRole(), data),
    persist(row: AdminRole) {
      rows.push(row);
      return this;
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
}

describe('ensurePlatformAdministratorRole', () => {
  it('creates the role with full access on an instance that has none', async () => {
    const rows: AdminRole[] = [];
    const outcome = await ensurePlatformAdministratorRole(tableOver(rows));

    expect(outcome).toBe('created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: PLATFORM_ADMINISTRATOR_ROLE_CODE,
      name: 'Platform administrator',
      permissions: ['*'],
    });
  });

  it('keeps the code operators already hold rows for', () => {
    expect(PLATFORM_ADMINISTRATOR_ROLE_CODE).toBe('platform_admin');
  });

  it('is idempotent, and leaves an operator rename alone', async () => {
    const rows: AdminRole[] = [];
    const em = tableOver(rows);
    await ensurePlatformAdministratorRole(em);
    rows[0]!.name = 'Owner';

    expect(await ensurePlatformAdministratorRole(em)).toBe('unchanged');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Owner');
  });

  it('restores full access to a role that lost it', async () => {
    const narrowed = Object.assign(new AdminRole(), {
      code: PLATFORM_ADMINISTRATOR_ROLE_CODE,
      name: 'Platform Admin',
      permissions: ['orders:read'],
    });
    const rows = [narrowed];

    expect(await ensurePlatformAdministratorRole(tableOver(rows))).toBe('restored');
    expect(rows[0]!.permissions).toEqual(['*']);
    expect(rows[0]!.name).toBe('Platform Admin');
  });
});
