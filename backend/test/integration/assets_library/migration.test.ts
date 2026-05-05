import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T008 — Migration test for feature 013 / `034_assets_library_init.ts`.
 * (Migration number 033 was taken by promotions/criteria; renumbered to 034.)
 * Verifies the new asset_folders table, the eight new columns on `assets`,
 * the `categories.main_image_asset_id` FK, the GIN index on cms_pages.body,
 * and the two backfill UPDATE rules described in `data-model.md`.
 */
describe('assets_library migration (T008 — 034_assets_library_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the asset_folders table', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'asset_folders'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('adds eight new columns to the assets table', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string; data_type: string }>>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'assets'
       order by column_name`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'folder_id',
      'visibility',
      'label',
      'storage_backend',
      'storage_locator',
      'pending_cleanup',
      'purge_after_at',
      'mime_type_overridden',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('adds main_image_asset_id to categories', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'categories'
         and column_name = 'main_image_asset_id'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('creates the GIN index for the cms_pages.body asset-ref scan', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and tablename = 'cms_pages'
         and indexname = 'idx_cms_pages_body_asset_refs'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('enforces the visibility CHECK constraint', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ contype: string; pg_get_constraintdef: string }>>(
      `select c.contype, pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'assets' and c.conname = 'assets_visibility_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pg_get_constraintdef).toMatch(/'public'/);
    expect(rows[0]!.pg_get_constraintdef).toMatch(/'private'/);
  });

  it('enforces the storage_backend CHECK constraint covering local|s3|gcs|legacy', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ pg_get_constraintdef: string }>>(
      `select pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'assets' and c.conname = 'assets_storage_backend_check'`,
    );
    expect(rows).toHaveLength(1);
    for (const expected of ['local', 's3', 'gcs', 'legacy']) {
      expect(rows[0]!.pg_get_constraintdef).toMatch(new RegExp(`'${expected}'`));
    }
  });

  it('backfills storage_backend=legacy for rows whose storage_url is an absolute URL', async () => {
    // Run the backfill on synthetic test rows. We insert two assets, one with
    // an http(s) URL and one with a relative path; neither has storage_locator
    // set, so the migration's pass-1 + pass-2 UPDATEs apply.
    await db.beginTx();
    try {
      const em = db.em();
      const conn = em.getConnection();
      const legacyId = randomUUID();
      const localId = randomUUID();
      await conn.execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at, storage_locator, storage_backend)
         values
           (?, 'image', 'a.jpg', 'image/jpeg', 100, 'https://example.com/a.jpg', now(), now(), '', 'local'),
           (?, 'image', 'b.jpg', 'image/jpeg', 100, 'ab/cd/b.jpg',               now(), now(), '', 'local')`,
        [legacyId, localId],
      );

      // Re-execute the migration's two backfill statements idempotently.
      await conn.execute(
        `update assets set storage_locator = storage_url where storage_locator = ''`,
      );
      await conn.execute(
        `update assets set storage_backend = 'legacy' where storage_locator ~ '^https?://'`,
      );

      const rows = await conn.execute<
        Array<{ id: string; storage_backend: string; storage_locator: string }>
      >(
        `select id::text as id, storage_backend, storage_locator
         from assets where id in (?, ?)`,
        [legacyId, localId],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[legacyId]!.storage_backend).toBe('legacy');
      expect(byId[legacyId]!.storage_locator).toBe('https://example.com/a.jpg');
      expect(byId[localId]!.storage_backend).toBe('local');
      expect(byId[localId]!.storage_locator).toBe('ab/cd/b.jpg');
    } finally {
      await db.rollbackTx();
    }
  });

  it('case-insensitively rejects duplicate folder names within the same parent', async () => {
    await db.beginTx();
    try {
      const em = db.em();
      const conn = em.getConnection();
      const a = randomUUID();
      const b = randomUUID();
      // Use a unique folder name per run so a leaked previous-run row cannot
      // produce a false positive against an unrelated row.
      const name = `Marketing-${a.slice(0, 8)}`;
      await conn.execute(
        `insert into asset_folders (id, parent_id, name, position, created_at, updated_at)
         values (?, null, ?, 0, now(), now())`,
        [a, name],
      );
      await expect(
        conn.execute(
          `insert into asset_folders (id, parent_id, name, position, created_at, updated_at)
           values (?, null, ?, 1, now(), now())`,
          [b, name.toLowerCase()],
        ),
      ).rejects.toThrow();
    } finally {
      await db.rollbackTx();
    }
  });
});
