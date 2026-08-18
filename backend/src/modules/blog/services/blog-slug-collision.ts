import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { createHash } from 'crypto';

/**
 * Cross-table slug-uniqueness probe — feature 016 / R3.
 *
 * Postgres cannot enforce UNIQUE across two tables; the per-table partial
 * unique indexes are defensive. The cross-table check (Post slug colliding
 * with a Category slug in the same Sales Channel — they share the
 * `<prefix>/<slug>` URL space) lives here.
 *
 * Each probe runs inside the caller's transaction and acquires a Postgres
 * advisory lock keyed on (channel, slug) so a concurrent save cannot
 * sneak between probe and write. The lock is released automatically when
 * the transaction commits or rolls back.
 *
 * Callers MUST be inside an `em.transactional(...)` block.
 */

export interface SlugCollisionCheckInput {
  /** Slug being asserted. */
  slug: string;
  /** Sales-channel ids the entity is being attached to. */
  salesChannelIds: string[];
  /** Which side is calling — drives the row-id exclusion below. */
  kind: 'post' | 'category';
  /** When updating an existing row, exclude it from the probe. */
  excludeId?: string | undefined;
}

/**
 * Probe `blog_post_sales_channels` ∪ `blog_category_sales_channels` for
 * any non-soft-deleted row in any of the supplied channels with the same
 * slug. Throws BLOG_SLUG_TAKEN with `details.colliding[]` populated.
 *
 * Returns silently when no collision exists.
 */
export async function assertSlugAvailable(
  em: EntityManager,
  input: SlugCollisionCheckInput,
): Promise<void> {
  if (input.salesChannelIds.length === 0) return;


  // 1. Take per-(channel, slug) advisory locks so a concurrent transaction
  // cannot squeeze a colliding write between this probe and the upcoming
  // INSERT. The lock is released when the transaction completes.
  for (const channelId of input.salesChannelIds) {
    const lockKey = advisoryLockKeyFor(channelId, input.slug);
    await em.execute('select pg_advisory_xact_lock(?)', [lockKey]);
  }

  const placeholders = input.salesChannelIds.map(() => '?').join(', ');
  const params: unknown[] = [input.slug, ...input.salesChannelIds];

  // 2. Check the post side. Exclude the calling row if updating.
  let postSql = `select p.id::text as id, psc.sales_channel_id::text as channel_id
                   from blog_post_sales_channels psc
                   join blog_posts p on p.id = psc.blog_post_id
                  where psc.slug = ?
                    and psc.sales_channel_id in (${placeholders})
                    and psc.deleted_at is null`;
  if (input.kind === 'post' && input.excludeId) {
    postSql += ' and p.id <> ?';
    params.push(input.excludeId);
  }
  postSql += ' limit 5';
  const postRows = (await em.execute(postSql, params)) as Array<{
    id: string;
    channel_id: string;
  }>;

  // 3. Check the category side.
  const catParams: unknown[] = [input.slug, ...input.salesChannelIds];
  let categorySql = `select c.id::text as id, csc.sales_channel_id::text as channel_id
                       from blog_category_sales_channels csc
                       join blog_categories c on c.id = csc.blog_category_id
                      where csc.slug = ?
                        and csc.sales_channel_id in (${placeholders})
                        and csc.deleted_at is null`;
  if (input.kind === 'category' && input.excludeId) {
    categorySql += ' and c.id <> ?';
    catParams.push(input.excludeId);
  }
  categorySql += ' limit 5';
  const categoryRows = (await em.execute(categorySql, catParams)) as Array<{
    id: string;
    channel_id: string;
  }>;

  if (postRows.length === 0 && categoryRows.length === 0) return;

  // Surface each colliding owner as a separate detail entry so the admin
  // UI can render a friendly list. `path: 'slug'` keeps the field
  // attribution consistent with other slug errors; `issue` carries the
  // colliding kind + id + channel.
  const details = [
    ...postRows.map((r) => ({
      path: 'slug',
      issue: `taken by post id=${r.id} in sales-channel id=${r.channel_id}`,
    })),
    ...categoryRows.map((r) => ({
      path: 'slug',
      issue: `taken by category id=${r.id} in sales-channel id=${r.channel_id}`,
    })),
  ];

  throw new HttpError(
    409,
    ERROR_CODES.BLOG_SLUG_TAKEN,
    `Slug "${input.slug}" is already taken in at least one of the assigned Sales Channels.`,
    details,
  );
}

/**
 * Hash `(channelId, slug)` into a `bigint` namespace acceptable to
 * `pg_advisory_xact_lock(bigint)`. We use SHA-256 then take the first
 * 8 bytes interpreted as a signed bigint (Postgres `bigint` range).
 */
function advisoryLockKeyFor(channelId: string, slug: string): string {
  const digest = createHash('sha256').update(`blog-slug:${channelId}:${slug}`).digest();
  // Take the first 8 bytes as a 64-bit big-endian integer; force the
  // sign bit so the value fits in Postgres's signed bigint range. The
  // exact mapping doesn't matter — we just need a stable bigint.
   
  let hi = digest.readUInt32BE(0);
  // Clear the top bit so the resulting bigint is positive.
  hi = hi & 0x7fffffff;
  const lo = digest.readUInt32BE(4);
  return ((BigInt(hi) << 32n) | BigInt(lo)).toString();
}
