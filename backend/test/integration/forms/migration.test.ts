import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { migrations } from '@endora-commerce/mod-forms/migrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMigratorTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `forms`' schema, read back from the database its migration produced
 * (`specs/170-forms-module/data-model.md` §§1–5, T013).
 *
 * Asserted from the catalogue rather than through the entity classes, as `tasks`' migration test
 * is: checks, cascades and indexes are properties no entity declaration carries. The last case
 * drives the init migration's `down` and `up` in place — nothing references the four tables, so
 * they can be replayed without reverting the modules ordered after `forms` — which is why the file
 * takes a database of its own (`setupMigratorTestDb`, `test/migrator-driving-tests.ts`).
 */

type MigrationClass = (typeof migrations)[number];

function initMigration(): MigrationClass {
  const found = migrations.find((migration) => /FormsInit$/.test(migration.name));
  if (!found) throw new Error('forms: the init migration is not exported from ./migrations.');
  return found;
}

const TABLES = ['form_entries', 'form_entry_notes', 'form_versions', 'forms'];

describe('forms schema (data-model §§1–5)', () => {
  let db: TestDb;
  let orm: MikroORM;

  beforeAll(async () => {
    db = await setupMigratorTestDb();
    orm = db.orm;
  });

  afterAll(async () => {
    await db.close();
  });

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await orm.em.getConnection().execute(sql, params)) as T[];
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const Migration = initMigration();
    const migration = new Migration(orm.em.getDriver(), orm.config);
    await migration[direction]();
    const connection = orm.em.getConnection();
    for (const query of migration.getQueries()) await connection.execute(query as string);
    migration.reset();
  }

  async function columns(
    table: string,
  ): Promise<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; len: number | null }[]> {
    return rows(
      `select column_name, data_type, is_nullable, column_default, character_maximum_length as len
         from information_schema.columns
        where table_schema = current_schema() and table_name = ?
        order by ordinal_position`,
      [table],
    );
  }

  async function indexDefinitions(table: string): Promise<string[]> {
    const found = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ?`,
      [table],
    );
    return found.map((row) => row.indexdef.replace(/\s+/g, ' '));
  }

  async function tables(): Promise<string[]> {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema() and table_name in (${TABLES.map(() => '?').join(', ')})
        order by table_name`,
      TABLES,
    );
    return found.map((row) => row.table_name);
  }

  const EMPTY_DEFINITION = JSON.stringify({ schemaVersion: 1, sections: [] });

  async function insertForm(key = `form_${randomUUID().slice(0, 8)}`): Promise<string> {
    const id = randomUUID();
    await rows(
      `insert into "forms" ("id", "key", "name", "default_language", "definition") values (?, ?, ?, 'en', ?::jsonb)`,
      [id, key, `Form ${key}`, EMPTY_DEFINITION],
    );
    return id;
  }

  async function insertVersion(formId: string, number: number): Promise<string> {
    const id = randomUUID();
    await rows(
      `insert into "form_versions" ("id", "form_id", "number", "definition", "default_language")
       values (?, ?, ?, ?::jsonb, 'en')`,
      [id, formId, number, EMPTY_DEFINITION],
    );
    return id;
  }

  async function insertEntry(
    formId: string,
    versionId: string,
    overrides: { customerAccountId?: string | null; organizationId?: string | null; status?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await rows(
      `insert into "form_entries"
         ("id", "form_id", "form_version_id", "form_version_number", "sales_channel_id", "language",
          "customer_account_id", "organization_id", "status")
       values (?, ?, ?, 1, ?, 'en', ?, ?, ?)`,
      [
        id,
        formId,
        versionId,
        randomUUID(),
        overrides.customerAccountId ?? null,
        overrides.organizationId ?? null,
        overrides.status ?? 'new',
      ],
    );
    return id;
  }

  async function insertNote(entryId: string): Promise<string> {
    const id = randomUUID();
    await rows(`insert into "form_entry_notes" ("id", "entry_id", "body") values (?, ?, 'Called back')`, [id, entryId]);
    return id;
  }

  async function count(table: string, where: string, params: unknown[]): Promise<number> {
    const [row] = await rows<{ n: string }>(`select count(*)::text as n from "${table}" where ${where}`, params);
    return Number(row!.n);
  }

  it('is a migration the migrator executed — the registration is the claim that it runs', async () => {
    const executed = await orm.getMigrator().getExecutedMigrations();
    expect(executed.map((migration) => migration.name)).toContain(initMigration().name);
  });

  it('creates the four tables of the module', async () => {
    expect(await tables()).toEqual(TABLES);
  });

  it('shapes `forms` per data-model §1', async () => {
    expect(await columns('forms')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()', len: null },
      { column_name: 'key', data_type: 'character varying', is_nullable: 'NO', column_default: null, len: 64 },
      { column_name: 'name', data_type: 'character varying', is_nullable: 'NO', column_default: null, len: 200 },
      { column_name: 'default_language', data_type: 'character varying', is_nullable: 'NO', column_default: null, len: 16 },
      {
        column_name: 'status',
        data_type: 'character varying',
        is_nullable: 'NO',
        column_default: "'draft'::character varying",
        len: 16,
      },
      { column_name: 'definition', data_type: 'jsonb', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'revision', data_type: 'integer', is_nullable: 'NO', column_default: '1', len: null },
      { column_name: 'published_version_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'published_version_number', data_type: 'integer', is_nullable: 'NO', column_default: '0', len: null },
      { column_name: 'recipients', data_type: 'jsonb', is_nullable: 'NO', column_default: "'[]'::jsonb", len: null },
      { column_name: 'channel_recipients', data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb", len: null },
      { column_name: 'retention_days', data_type: 'integer', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'accepted_entry_count', data_type: 'integer', is_nullable: 'NO', column_default: '0', len: null },
      { column_name: 'created_by_admin_user_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'updated_by_admin_user_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
    ]);
  });

  it('shapes `form_versions` per data-model §2', async () => {
    expect(await columns('form_versions')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()', len: null },
      { column_name: 'form_id', data_type: 'uuid', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'number', data_type: 'integer', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'definition', data_type: 'jsonb', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'default_language', data_type: 'character varying', is_nullable: 'NO', column_default: null, len: 16 },
      { column_name: 'published_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
      { column_name: 'published_by_admin_user_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
    ]);
  });

  it('shapes `form_entries` per data-model §4', async () => {
    expect(await columns('form_entries')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()', len: null },
      { column_name: 'form_id', data_type: 'uuid', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'form_version_id', data_type: 'uuid', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'form_version_number', data_type: 'integer', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'sales_channel_id', data_type: 'uuid', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'language', data_type: 'character varying', is_nullable: 'NO', column_default: null, len: 16 },
      { column_name: 'page_url', data_type: 'character varying', is_nullable: 'YES', column_default: null, len: 2048 },
      { column_name: 'submitted_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
      { column_name: 'answers', data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb", len: null },
      { column_name: 'consents', data_type: 'jsonb', is_nullable: 'NO', column_default: "'[]'::jsonb", len: null },
      { column_name: 'submitter_email', data_type: 'character varying', is_nullable: 'YES', column_default: null, len: 320 },
      { column_name: 'search_text', data_type: 'text', is_nullable: 'NO', column_default: "''::text", len: null },
      {
        column_name: 'status',
        data_type: 'character varying',
        is_nullable: 'NO',
        column_default: "'new'::character varying",
        len: 16,
      },
      { column_name: 'confirmation_sent_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'customer_account_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
    ]);
  });

  it('shapes `form_entry_notes` per data-model §5', async () => {
    expect(await columns('form_entry_notes')).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()', len: null },
      { column_name: 'entry_id', data_type: 'uuid', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'body', data_type: 'text', is_nullable: 'NO', column_default: null, len: null },
      { column_name: 'author_admin_user_id', data_type: 'uuid', is_nullable: 'YES', column_default: null, len: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', len: null },
    ]);
  });

  it('refuses a half-attributed entry in both directions (the Principle XI equivalence)', async () => {
    const formId = await insertForm();
    const versionId = await insertVersion(formId, 1);
    await expect(
      insertEntry(formId, versionId, { customerAccountId: randomUUID(), organizationId: null }),
    ).rejects.toThrow(/form_entries_attribution_chk/);
    await expect(
      insertEntry(formId, versionId, { customerAccountId: null, organizationId: randomUUID() }),
    ).rejects.toThrow(/form_entries_attribution_chk/);
    await expect(insertEntry(formId, versionId)).resolves.toBeDefined();
    await expect(
      insertEntry(formId, versionId, { customerAccountId: randomUUID(), organizationId: randomUUID() }),
    ).resolves.toBeDefined();
  });

  it('holds an entry status to its four values', async () => {
    const formId = await insertForm();
    const versionId = await insertVersion(formId, 1);
    for (const status of ['new', 'read', 'closed', 'spam']) {
      await expect(insertEntry(formId, versionId, { status })).resolves.toBeDefined();
    }
    await expect(insertEntry(formId, versionId, { status: 'archived' })).rejects.toThrow(/form_entries_status_chk/);
  });

  it('holds a form status and retention to their values', async () => {
    const formId = await insertForm();
    await expect(rows(`update "forms" set "status" = 'archived' where "id" = ?`, [formId])).rejects.toThrow(
      /check constraint/i,
    );
    await expect(rows(`update "forms" set "retention_days" = 0 where "id" = ?`, [formId])).rejects.toThrow(
      /check constraint/i,
    );
    await expect(rows(`update "forms" set "retention_days" = 3651 where "id" = ?`, [formId])).rejects.toThrow(
      /check constraint/i,
    );
    await expect(rows(`update "forms" set "retention_days" = 30 where "id" = ?`, [formId])).resolves.toBeDefined();
  });

  it('keeps a form key unique', async () => {
    const key = `unique_${randomUUID().slice(0, 8)}`;
    await insertForm(key);
    await expect(insertForm(key)).rejects.toThrow(/forms_key_unique/);
  });

  it('keeps a version number unique per form', async () => {
    const formId = await insertForm();
    await insertVersion(formId, 1);
    await expect(insertVersion(formId, 1)).rejects.toThrow(/form_versions_form_id_number_unique/);
    const otherForm = await insertForm();
    await expect(insertVersion(otherForm, 1)).resolves.toBeDefined();
  });

  it('points a form at its published version and lets the version go first (`on delete set null`)', async () => {
    const formId = await insertForm();
    const versionId = await insertVersion(formId, 1);
    await rows(`update "forms" set "published_version_id" = ? where "id" = ?`, [versionId, formId]);
    await expect(
      rows(`update "forms" set "published_version_id" = ? where "id" = ?`, [randomUUID(), formId]),
    ).rejects.toThrow(/foreign key/i);
    await rows(`delete from "form_versions" where "id" = ?`, [versionId]);
    const [form] = await rows<{ published_version_id: string | null }>(
      `select "published_version_id" from "forms" where "id" = ?`,
      [formId],
    );
    expect(form?.published_version_id).toBeNull();
  });

  it('cascades a deleted form to its versions, entries and notes, and a deleted entry to its notes', async () => {
    const formId = await insertForm();
    const versionId = await insertVersion(formId, 1);
    await rows(`update "forms" set "published_version_id" = ? where "id" = ?`, [versionId, formId]);
    const kept = await insertEntry(formId, versionId);
    const keptNote = await insertNote(kept);
    const removed = await insertEntry(formId, versionId);
    await insertNote(removed);

    await rows(`delete from "form_entries" where "id" = ?`, [removed]);
    expect(await count('form_entry_notes', `"entry_id" = ?`, [removed])).toBe(0);
    expect(await count('form_entry_notes', `"id" = ?`, [keptNote])).toBe(1);

    await rows(`delete from "forms" where "id" = ?`, [formId]);
    expect(await count('form_versions', `"form_id" = ?`, [formId])).toBe(0);
    expect(await count('form_entries', `"form_id" = ?`, [formId])).toBe(0);
    expect(await count('form_entry_notes', `"id" = ?`, [keptNote])).toBe(0);
  });

  it('indexes the list, the keyset and the filters (data-model §4)', async () => {
    const entries = await indexDefinitions('form_entries');
    for (const expected of [
      /\(form_id, submitted_at DESC, id DESC\)/,
      /form_entries_submitted_idx .*\(submitted_at DESC, id DESC\)/,
      /form_entries_status_idx .*\(status\)/,
      /form_entries_channel_idx .*\(sales_channel_id\)/,
      /form_entries_organization_idx .*\(organization_id\)/,
      /form_entries_customer_account_id_index .*\(customer_account_id\)/,
    ]) {
      expect(entries.some((definition) => expected.test(definition))).toBe(true);
    }
    expect(await indexDefinitions('forms')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/forms_status_idx .*\(status\)/),
        expect.stringMatching(/forms_retention_idx .*\(retention_days\) WHERE \(retention_days IS NOT NULL\)/),
      ]),
    );
    expect((await indexDefinitions('form_entry_notes')).some((d) => /\(entry_id\)/.test(d))).toBe(true);
  });

  it('backs the search with trigram indexes, pg_trgm present (R-18)', async () => {
    const [extension] = await rows<{ extname: string }>(`select extname from pg_extension where extname = 'pg_trgm'`);
    expect(extension?.extname).toBe('pg_trgm');
    const entries = await indexDefinitions('form_entries');
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/form_entries_email_trgm_idx .*USING gin \(submitter_email gin_trgm_ops\)/),
        expect.stringMatching(/form_entries_search_trgm_idx .*USING gin \(search_text gin_trgm_ops\)/),
      ]),
    );
  });

  it('removes all four tables on `down` and restores them on `up`', async () => {
    await run('down');
    expect(await tables()).toEqual([]);
    await run('up');
    expect(await tables()).toEqual(TABLES);
  });
});
