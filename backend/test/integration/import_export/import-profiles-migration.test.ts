import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T078, T085; `data-model.md` §11, R14) —
 * the `import_profiles` table `import_export` owns: its columns, the case-insensitive unique name
 * (a raw `lower(name)` index), the `entity` check and no foreign key on the target channels.
 */
describe('172 — import_profiles migration [integration]', () => {
  let h: BackendServerHandle;
  const sql = <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(query, params);

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from import_profiles where name like 'mig170-%'`);
    await teardownBackendServer(h);
  });

  it('creates the table with the data-model columns', async () => {
    const columns = await sql<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_name = 'import_profiles' order by column_name`,
    );
    expect(columns.map((c) => [c.column_name, c.data_type, c.is_nullable])).toEqual([
      ['created_at', 'timestamp with time zone', 'NO'],
      ['entity', 'character varying', 'NO'],
      ['id', 'uuid', 'NO'],
      ['locale_mapping', 'jsonb', 'NO'],
      ['name', 'character varying', 'NO'],
      ['source_language_for_global', 'character varying', 'YES'],
      ['updated_at', 'timestamp with time zone', 'NO'],
    ]);
  });

  it('refuses a second profile whose name differs only in case', async () => {
    await sql(
      `insert into import_profiles (id, name, entity, locale_mapping, created_at, updated_at)
       values (?, 'mig170-Akeneo', 'products', '[]'::jsonb, now(), now())`,
      [randomUUID()],
    );
    await expect(
      sql(
        `insert into import_profiles (id, name, entity, locale_mapping, created_at, updated_at)
         values (?, 'MIG170-akeneo', 'products', '[]'::jsonb, now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/import_profiles_name_lower_unique/);
  });

  it('refuses an entity other than products', async () => {
    await expect(
      sql(
        `insert into import_profiles (id, name, entity, locale_mapping, created_at, updated_at)
         values (?, 'mig170-stock', 'stock', '[]'::jsonb, now(), now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/import_profiles_entity_check/);
  });

  it('holds no foreign key: a target channel is validated at import, not at save (FR-042)', async () => {
    const keys = await sql(
      `select constraint_name from information_schema.table_constraints
        where table_name = 'import_profiles' and constraint_type = 'FOREIGN KEY'`,
    );
    expect(keys).toEqual([]);
  });
});
