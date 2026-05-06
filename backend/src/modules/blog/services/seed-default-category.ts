import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';

/**
 * SeedDefaultCategory — feature 016 / R11.
 *
 * Idempotent boot reconciler. On first run, creates a single
 * `is_system = true` Category named "Default" (slug: 'default') and
 * attaches it to every existing Sales Channel. On subsequent runs, when
 * a system row already exists, the reconciler **does nothing** — admin
 * edits to name / slug / scope / description / image / metadata are
 * preserved (FR-004).
 *
 * Newly added Sales Channels do NOT get auto-attached to `Default` —
 * the admin attaches them explicitly through the Categories editor. This
 * matches the spec's R11 decision and avoids re-attaching a channel an
 * admin has intentionally detached.
 *
 * The reconciler runs all reads + writes through a single connection
 * (raw SQL) so its behaviour is consistent across MikroORM transaction
 * boundaries (tests + production share the same path).
 */
export async function seedDefaultCategory(
  emFactory: () => EntityManager,
): Promise<{ categoryId: string; created: boolean }> {
  const conn = emFactory().getConnection();

  const existingRows = (await conn.execute(
    'select id::text as id from blog_categories where is_system = true and deleted_at is null limit 1',
  )) as Array<{ id: string }>;
  if (existingRows.length > 0) {
    return { categoryId: existingRows[0]!.id, created: false };
  }

  const categoryId = randomUUID();
  await conn.execute(
    `insert into blog_categories
       (id, slug, name, enabled, is_system, position, version, created_at, updated_at)
       values
       (?, 'default', '{"en-US":"Default"}'::jsonb, true, true, 0, 1, now(), now())`,
    [categoryId],
  );

  const channelRows = (await conn.execute(
    'select id::text as id from sales_channels',
  )) as Array<{ id: string }>;

  for (const row of channelRows) {
    await conn.execute(
      `insert into blog_category_sales_channels
         (blog_category_id, sales_channel_id, slug)
         values (?, ?, 'default')`,
      [categoryId, row.id],
    );
  }

  return { categoryId, created: true };
}
