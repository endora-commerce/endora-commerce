import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261103T171312SeoProductMetaThreeLevels } from '@endora-commerce/mod-seo/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T117; `data-model.md` §8, research R9,
 * R22; FR-020, FR-026) — `seo`'s `product_meta_three_levels`: the Language-only product rows go
 * (there is no Language scope any more, FR-010), the scope CHECK lets a product hold a Global row
 * (no channel, no locale) and nothing else does, one Global row per product, and category /
 * CMS-page rows are untouched.
 *
 * The migration has already run against the template, so each test runs its `down`, seeds the
 * rows `up` meets on a database deployed before 170, and runs `up` — in one transaction the test
 * rolls back, with the statements taken off the shipped class (the T015 harness).
 */
type MigrationClass = new (driver: unknown, config: unknown) => {
  up(): Promise<void>;
  down(): Promise<void>;
  getQueries(): unknown[];
};
const MIGRATION = Migration20261103T171312SeoProductMetaThreeLevels as unknown as MigrationClass;

describe('seo product_meta_three_levels migration (170 T117)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function run(direction: 'up' | 'down'): Promise<void> {
    const m = new MIGRATION(em.getDriver(), em.config);
    await m[direction]();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
    em.clear();
  }
  const rows = <T>(sql: string, params: unknown[] = []): Promise<T[]> => em.execute(sql, params) as Promise<T[]>;

  async function insert(entityType: string, entityId: string, channelId: string | null, locale: string | null, title: string) {
    await em.execute(
      `insert into seo_meta_overrides (id, entity_type, entity_id, sales_channel_id, locale, title, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, now(), now())`,
      [randomUUID(), entityType, entityId, channelId, locale, title],
    );
  }
  async function anyChannelId(): Promise<string> {
    const [row] = await rows<{ id: string }>(`select id from sales_channels order by code limit 1`);
    return row!.id;
  }

  it('deletes the Language-only product rows and keeps every other row', async () => {
    await run('down');
    const channelId = await anyChannelId();
    const product = randomUUID();
    const category = randomUUID();
    const page = randomUUID();
    await insert('product', product, null, 'en-US', 'language row');
    await insert('product', product, channelId, null, 'channel row');
    await insert('product', product, channelId, 'pl-PL', 'channel x language row');
    await insert('category', category, null, 'en-US', 'category row');
    await insert('cms_page', page, null, 'pl-PL', 'page row');

    await run('up');

    const left = await rows<{ entity_type: string; title: string }>(
      `select entity_type, title from seo_meta_overrides where entity_id in (?, ?, ?) order by title`,
      [product, category, page],
    );
    expect(left).toEqual([
      { entity_type: 'category', title: 'category row' },
      { entity_type: 'product', title: 'channel row' },
      { entity_type: 'product', title: 'channel x language row' },
      { entity_type: 'cms_page', title: 'page row' },
    ]);
  });

  it('lets a product hold one Global row, and refuses a second one', async () => {
    const product = randomUUID();
    await insert('product', product, null, null, 'global');
    await expect(insert('product', product, null, null, 'global again')).rejects.toThrow(
      /seo_meta_overrides_product_global_unique/,
    );
  });

  // One refusal per test: a refused statement aborts the test's transaction.
  it.each([
    ['a Language-only product row', 'product', 'en-US'],
    ['a scope-less category row', 'category', null],
    ['a scope-less CMS-page row', 'cms_page', null],
  ] as const)('refuses %s', async (_label, entityType, locale) => {
    await expect(insert(entityType, randomUUID(), null, locale, 'refused')).rejects.toThrow(/seo_meta_overrides_scope_check/);
  });

  it('keeps the category and CMS-page Language rows writable as before', async () => {
    await insert('category', randomUUID(), null, 'en-US', 'category');
    await insert('cms_page', randomUUID(), null, 'pl-PL', 'page');
  });

  it('adds a plain (entity_type, entity_id) index', async () => {
    const [index] = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'seo_meta_overrides' and indexname = 'seo_meta_overrides_entity_idx'`,
    );
    expect(index?.indexdef).toMatch(/\(entity_type, entity_id\)$/);
  });

  it('is a no-op when run a second time', async () => {
    const product = randomUUID();
    await insert('product', product, null, null, 'global');
    await run('up');
    const [count] = await rows<{ n: string }>(`select count(*)::text as n from seo_meta_overrides where entity_id = ?`, [product]);
    expect(count?.n).toBe('1');
  });
});
