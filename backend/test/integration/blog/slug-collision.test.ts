import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  assertSlugAvailable,
  type SlugCollisionCheckInput,
} from '../../../../packages/modules/blog/src/backend/services/blog-slug-collision.js';
import { HttpError } from '../../../src/http/error-envelope.js';

const CHANNEL_A = '11111111-1111-1111-1111-111111111111';
const CHANNEL_B = '22222222-2222-2222-2222-222222222222';

/**
 * Integration test for the cross-table slug-collision helper (T013 / R3).
 *
 * Uses the existing transaction-rollback fixture so each scenario starts
 * from a clean slate. Real sales_channels rows are seeded once at file
 * boot so the FKs resolve.
 */
describe('blog slug-collision (T013 — cross-table guard)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
    // Seed two sales channels at the suite level — these survive the
    // per-test rollback because they're outside the test transactions.
    const conn = db.orm.em.getConnection();
    await conn.execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values
         (?, 'blog-test-a', '{"en-US":"Blog Test A"}'::jsonb, 'en-US', 'USD', now(), now()),
         (?, 'blog-test-b', '{"en-US":"Blog Test B"}'::jsonb, 'en-US', 'USD', now(), now())
       on conflict (id) do nothing`,
      [CHANNEL_A, CHANNEL_B],
    );
  });

  afterAll(async () => {
    await db.orm.em.getConnection().execute(
      `delete from sales_channels where id in (?, ?)`,
      [CHANNEL_A, CHANNEL_B],
    );
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    const conn = db.em().getConnection();
    await conn.execute('truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade');
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  async function seedCategory(slug: string, channelId: string): Promise<string> {
    const id = randomUUID();
    const conn = db.em().getConnection();
    await conn.execute(
      `insert into blog_categories (id, slug, name, version, created_at, updated_at)
       values (?, ?, ?::jsonb, 1, now(), now())`,
      [id, slug, JSON.stringify({ 'en-US': slug })],
    );
    await conn.execute(
      `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, channelId, slug],
    );
    return id;
  }

  async function seedPost(slug: string, channelId: string): Promise<string> {
    const id = randomUUID();
    const conn = db.em().getConnection();
    await conn.execute(
      `insert into blog_posts (id, slug, name, content, version, created_at, updated_at)
       values (?, ?, ?::jsonb, '{}'::jsonb, 1, now(), now())`,
      [id, slug, JSON.stringify({ 'en-US': slug })],
    );
    await conn.execute(
      `insert into blog_post_sales_channels (blog_post_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, channelId, slug],
    );
    return id;
  }

  async function probe(input: SlugCollisionCheckInput): Promise<HttpError | null> {
    try {
      await assertSlugAvailable(db.em(), input);
      return null;
    } catch (err) {
      return err as HttpError;
    }
  }

  it('allows a free slug', async () => {
    const err = await probe({
      slug: 'free-slug',
      salesChannelIds: [CHANNEL_A],
      kind: 'post',
    });
    expect(err).toBeNull();
  });

  it('refuses a Post slug that collides with a Category slug in the same channel', async () => {
    await seedCategory('shared', CHANNEL_A);
    const err = await probe({
      slug: 'shared',
      salesChannelIds: [CHANNEL_A],
      kind: 'post',
    });
    expect(err).toBeInstanceOf(HttpError);
    expect(err!.code).toBe('BLOG_SLUG_TAKEN');
    const details1 = err!.details as Array<{ path: string; issue: string }> | undefined;
    expect(details1?.[0]?.issue).toContain('category');
  });

  it('refuses a Category slug that collides with a Post slug in the same channel', async () => {
    await seedPost('shared-2', CHANNEL_A);
    const err = await probe({
      slug: 'shared-2',
      salesChannelIds: [CHANNEL_A],
      kind: 'category',
    });
    expect(err).toBeInstanceOf(HttpError);
    expect(err!.code).toBe('BLOG_SLUG_TAKEN');
    const details2 = err!.details as Array<{ path: string; issue: string }> | undefined;
    expect(details2?.[0]?.issue).toContain('post');
  });

  it('allows the same slug across different channels', async () => {
    await seedCategory('cross-channel', CHANNEL_A);
    const err = await probe({
      slug: 'cross-channel',
      salesChannelIds: [CHANNEL_B],
      kind: 'post',
    });
    expect(err).toBeNull();
  });

  it('with excludeId, ignores self when probing for an update', async () => {
    const postId = await seedPost('self-update', CHANNEL_A);
    const err = await probe({
      slug: 'self-update',
      salesChannelIds: [CHANNEL_A],
      kind: 'post',
      excludeId: postId,
    });
    expect(err).toBeNull();
  });

  it('returns silently when salesChannelIds is empty', async () => {
    const err = await probe({
      slug: 'whatever',
      salesChannelIds: [],
      kind: 'post',
    });
    expect(err).toBeNull();
  });

  it('ignores soft-deleted scope rows', async () => {
    const em = db.em();
    const conn = em.getConnection();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_categories (id, slug, name, version, created_at, updated_at)
       values (?, 'tombstone', '{}'::jsonb, 1, now(), now())`,
      [categoryId],
    );
    await conn.execute(
      `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug, deleted_at)
       values (?, ?, 'tombstone', now())`,
      [categoryId, CHANNEL_A],
    );
    const err = await probe({
      slug: 'tombstone',
      salesChannelIds: [CHANNEL_A],
      kind: 'post',
    });
    expect(err).toBeNull();
  });
});
