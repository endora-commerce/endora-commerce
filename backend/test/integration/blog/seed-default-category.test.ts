import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { seedDefaultCategory } from '../../../src/modules/blog/services/seed-default-category.js';

const CHANNEL_X = '55555555-5555-5555-5555-555555555555';
const CHANNEL_Y = '66666666-6666-6666-6666-666666666666';

describe('seedDefaultCategory (T022 — idempotent + admin-edit-safe)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
    const em = db.orm.em;
    await em.execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values
         (?, 'seed-default-x', '{"en-US":"X"}'::jsonb, 'en-US', 'USD', now(), now()),
         (?, 'seed-default-y', '{"en-US":"Y"}'::jsonb, 'en-US', 'USD', now(), now())
       on conflict (id) do nothing`,
      [CHANNEL_X, CHANNEL_Y],
    );
  });

  afterAll(async () => {
    const em = db.orm.em;
    await em.execute(
      'truncate blog_category_sales_channels, blog_categories cascade',
    );
    await em.execute(`delete from sales_channels where id in (?, ?)`, [CHANNEL_X, CHANNEL_Y]);
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    const em = db.em();
    await em.execute(
      'truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade',
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('creates the Default category on first run with system flag set', async () => {
    const r = await seedDefaultCategory(() => db.em());
    expect(r.created).toBe(true);
    const rows = (await db.em().execute(
      'select slug, name, enabled from blog_categories where is_system = true',
    )) as Array<{ slug: string; name: Record<string, string>; enabled: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe('default');
    expect(rows[0]!.name).toEqual({ 'en-US': 'Default' });
    expect(rows[0]!.enabled).toBe(true);
  });

  it('attaches the Default category to every existing Sales Channel', async () => {
    await seedDefaultCategory(() => db.em());
    const rows = (await db.em().execute(
      'select sales_channel_id::text as id from blog_category_sales_channels order by sales_channel_id',
    )) as Array<{ id: string }>;
    const channelIds = rows.map((r) => r.id);
    expect(channelIds).toContain(CHANNEL_X);
    expect(channelIds).toContain(CHANNEL_Y);
  });

  it('is idempotent — second run is a no-op when the system row exists', async () => {
    const first = await seedDefaultCategory(() => db.em());
    const second = await seedDefaultCategory(() => db.em());
    expect(second.created).toBe(false);
    expect(second.categoryId).toBe(first.categoryId);
  });

  it('preserves admin edits to name/slug across reruns', async () => {
    await seedDefaultCategory(() => db.em());
    const em = db.em();
    await em.execute(
      `update blog_categories
         set name = '{"pl-PL":"Aktualności"}'::jsonb,
             slug = 'aktualnosci'
       where is_system = true`,
    );
    await seedDefaultCategory(() => db.em());
    const rows = (await em.execute(
      'select slug, name from blog_categories where is_system = true',
    )) as Array<{ slug: string; name: Record<string, string> }>;
    expect(rows[0]!.name).toEqual({ 'pl-PL': 'Aktualności' });
    expect(rows[0]!.slug).toBe('aktualnosci');
  });
});
