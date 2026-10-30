import type { EntityManager } from '@mikro-orm/postgresql';
import type { GalleryLabel } from '@endora-commerce/contracts';
import { uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/` data-model §7, research R14; FR-076) —
 * a product's gallery in one sales channel.
 *
 * The image set is global (D-6). A channel may hide an item and may give a role
 * (`base_image`, `small_image`, `thumbnail`) to another item. In the channel:
 *
 * - the items are the global items minus the ones hidden there, in the global order;
 * - role R is held by the channel's own holder for R, else by the global holder;
 * - a role whose holder is hidden there is held by nobody — the reader's own fallback
 *   applies (the listing card's chain moves on to the next role, then the first item);
 * - a channel holder that is not one of the product's items is ignored.
 *
 * With no override — every channel today, and every read that names no channel — the
 * answer is the global gallery unchanged.
 */

const LABELS: readonly GalleryLabel[] = ['base_image', 'small_image', 'thumbnail'];

/** One product's overrides in one channel. */
export interface GalleryChannelOverrides {
  /** role → the item holding it in this channel. */
  roles: ReadonlyMap<GalleryLabel, string>;
  /** The items hidden in this channel. */
  hidden: ReadonlySet<string>;
}

export function effectiveGallery<T extends { id: string; labels: readonly GalleryLabel[] }>(
  items: readonly T[],
  overrides: GalleryChannelOverrides | undefined,
): Array<T & { labels: GalleryLabel[] }> {
  if (!overrides || (overrides.roles.size === 0 && overrides.hidden.size === 0)) {
    return items.map((item) => ({ ...item, labels: [...item.labels] }));
  }
  const ids = new Set(items.map((item) => item.id));
  const holder = new Map<GalleryLabel, string>();
  for (const item of items) for (const label of item.labels) holder.set(label, item.id);
  for (const [label, itemId] of overrides.roles) {
    if (ids.has(itemId)) holder.set(label, itemId);
  }
  return items
    .filter((item) => !overrides.hidden.has(item.id))
    .map((item) => ({
      ...item,
      labels: LABELS.filter((label) => holder.get(label) === item.id),
    }));
}

/**
 * Feature 168 (data-model §6) — the role holders and hidden items of a page's products at one
 * channel, read from `gallery_role_scope_overrides` and `gallery_item_scope_overrides`.
 *
 * 168-shim: the **Channel** rows only, and a Global-hidden item is not yet dropped; the full
 * C×L → C → G chain (Global `hidden`, Channel × language rows, an empty role override meaning
 * "no image") is T041's rewrite on the scoped store adapters.
 */
export async function loadGalleryChannelOverrides(
  em: EntityManager,
  productIds: readonly string[],
  channelId: string | null,
): Promise<Map<string, GalleryChannelOverrides>> {
  const out = new Map<string, { roles: Map<GalleryLabel, string>; hidden: Set<string> }>();
  if (channelId === null || productIds.length === 0) return out;
  const ids = [...new Set(productIds)];
  const entry = (productId: string): { roles: Map<GalleryLabel, string>; hidden: Set<string> } => {
    let found = out.get(productId);
    if (!found) {
      found = { roles: new Map(), hidden: new Set() };
      out.set(productId, found);
    }
    return found;
  };
  // One statement for the page; `em.execute`, so a caller inside a transaction reads
  // its own writes (issue #200).
  const rows = await em.execute<
    Array<{ product_id: string; gallery_item_id: string; label: GalleryLabel | null }>
  >(
    `select product_id::text as product_id, gallery_item_id::text as gallery_item_id, label
       from gallery_role_scope_overrides
      where sales_channel_id = ? and language_code is null and gallery_item_id is not null
        and product_id = any(?::uuid[])
     union all
     select product_id::text, gallery_item_id::text, null
       from gallery_item_scope_overrides
      where sales_channel_id = ? and language_code is null and field = 'hidden'
        and value -> 'v' = 'true'::jsonb and product_id = any(?::uuid[])`,
    [channelId, uuidArrayLiteral(ids), channelId, uuidArrayLiteral(ids)],
  );
  for (const row of rows) {
    if (row.label === null) entry(row.product_id).hidden.add(row.gallery_item_id);
    else entry(row.product_id).roles.set(row.label, row.gallery_item_id);
  }
  return out;
}

/**
 * The scope overview's media rows (163 T118c, feature 168 data-model §6): every (field, channel,
 * language) at which the product's gallery holds an override.
 */
export async function loadMediaScopedFields(
  em: EntityManager,
  productId: string,
): Promise<Array<{ field: string; channelId: string | null; languageCode: string | null }>> {
  const rows = await em.execute<Array<{ field: string; channel_id: string | null; language_code: string | null }>>(
    `select distinct 'media:roles' as field, sales_channel_id::text as channel_id, language_code
       from gallery_role_scope_overrides where product_id = ?
     union
     select distinct case field when 'hidden' then 'media:hidden' else 'media:altText' end,
            sales_channel_id::text, language_code
       from gallery_item_scope_overrides where product_id = ?
     order by 1, 2, 3`,
    [productId, productId],
  );
  return rows.map((row) => ({ field: row.field, channelId: row.channel_id, languageCode: row.language_code }));
}
