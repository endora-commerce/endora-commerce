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

/**
 * An EntityManager over an in-memory table whose insert is the statement the
 * function is required to issue: `on conflict ("code") do nothing`. A plain
 * insert of a code that is already there throws, as the unique index would.
 *
 * `beforeInsert` runs between the function's read and its insert, which is
 * where a second process gets in.
 */
function tableOver(rows: AdminRole[], beforeInsert: () => void = () => {}): EntityManager {
  const find = (code: string): AdminRole | null => rows.find((row) => row.code === code) ?? null;
  return {
    findOne: async (_entity: unknown, where: { code: string }) => find(where.code),
    findOneOrFail: async (_entity: unknown, where: { code: string }) => {
      const row = find(where.code);
      if (row === null) throw new Error('not found');
      return row;
    },
    createQueryBuilder: () => {
      let data: Partial<AdminRole> = {};
      let ignoreConflictOn: string | null = null;
      const builder = {
        insert(payload: Partial<AdminRole>) {
          data = payload;
          return builder;
        },
        onConflict(field: string) {
          ignoreConflictOn = field;
          return builder;
        },
        ignore: () => builder,
        execute: async () => {
          beforeInsert();
          if (find(data.code!) !== null) {
            if (ignoreConflictOn !== 'code') throw new Error(`duplicate key: ${data.code}`);
            return { affectedRows: 0 };
          }
          rows.push(Object.assign(new AdminRole(), data));
          return { affectedRows: 1 };
        },
      };
      return builder;
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

  it('finds the row another process created between its read and its insert', async () => {
    const rows: AdminRole[] = [];
    const winner = Object.assign(new AdminRole(), {
      code: PLATFORM_ADMINISTRATOR_ROLE_CODE,
      name: 'Platform administrator',
      permissions: ['*'],
    });
    const em = tableOver(rows, () => {
      if (rows.length === 0) rows.push(winner);
    });

    await expect(ensurePlatformAdministratorRole(em)).resolves.toBe('unchanged');
    expect(rows).toEqual([winner]);
  });

  it('runs concurrently against an empty table without failing either caller', async () => {
    const rows: AdminRole[] = [];
    const outcomes = await Promise.all([
      ensurePlatformAdministratorRole(tableOver(rows)),
      ensurePlatformAdministratorRole(tableOver(rows)),
    ]);

    expect(rows).toHaveLength(1);
    expect([...outcomes].sort()).toEqual(['created', 'unchanged']);
  });
});
