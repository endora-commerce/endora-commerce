import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T006 — Migration test for feature 004 / `005_settings_init.ts`. Verifies that
 * the settings tables, the `setting_value_type` enum, the foreign-key cascades,
 * and the unique/indices listed in `data-model.md` exist after `migration:up`.
 *
 * Constitution Principle III: real Postgres, no DB mocking.
 */
describe('settings migration (T006 — 005_settings_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the five settings tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('setting_groups','settings','setting_values',
                            'setting_group_sales_channels','setting_sales_channels')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'setting_group_sales_channels',
      'setting_groups',
      'setting_sales_channels',
      'setting_values',
      'settings',
    ]);
  });

  it('creates the setting_value_type enum with the six expected values', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ enumlabel: string }>>(
      `select e.enumlabel
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       where t.typname = 'setting_value_type'
       order by e.enumsortorder`,
    );
    // 'secret' appended by migration 069 (feature 043 — write-only settings).
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'string',
      'number',
      'boolean',
      'json',
      'string_list',
      'secret',
    ]);
  });

  it('enforces UNIQUE (setting_id, sales_channel_id) on setting_values', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'setting_values'`,
    );
    const hasUnique = rows.some(
      (r) =>
        /UNIQUE/i.test(r.indexdef) &&
        /setting_id/.test(r.indexdef) &&
        /sales_channel_id/.test(r.indexdef),
    );
    expect(hasUnique).toBe(true);
  });

  it('cascades setting_values when its setting or its sales_channel is deleted', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ conname: string; confrelid_name: string; confdeltype: string }>
    >(
      `select c.conname,
              cl.relname as confrelid_name,
              c.confdeltype
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid and t.relname = 'setting_values'
       join pg_class cl on cl.oid = c.confrelid
       where c.contype = 'f'`,
    );
    const settingFk = rows.find((r) => r.confrelid_name === 'settings');
    const channelFk = rows.find((r) => r.confrelid_name === 'sales_channels');
    expect(settingFk?.confdeltype).toBe('c'); // 'c' = CASCADE
    expect(channelFk?.confdeltype).toBe('c');
  });
});
