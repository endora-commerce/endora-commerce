import type { EntityManager } from '@mikro-orm/postgresql';
import { GALLERY_ROLE_LABELS, resolveScoped, type GalleryLabel, type ScopeLevel, type ScopeRef } from '@endora-commerce/contracts';
import { familyOverrideRows, galleryRoleRows } from './scoped-store-adapters.js';
import { uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * Feature 172 (`data-model.md` §6, research R1; FR-011, FR-013) — a product's gallery at one
 * scope: Global, a sales channel (C) or a channel × language (C×L).
 *
 * The image set is global (D-6). Each item's `hidden` flag and alt text, and each role
 * (`base_image`, `small_image`, `thumbnail`), resolve C×L → C → G, and an empty override stops
 * the chain. At the scope:
 *
 * - the items are the global items minus the ones effectively hidden there, in the global order
 *   (an item hidden at Global is left out of every scope that does not show it again);
 * - role R is held by the scope's own holder for R, else by the Global holder; an override that
 *   names no image means **no** image holds R there;
 * - a role whose holder is hidden there is held by nobody — the reader's own fallback applies
 *   (the listing card's chain moves on to the next role, then the first item);
 * - a holder that is not one of the product's items is ignored (the Global holder applies);
 * - an item's alt text is its override at the scope when one applies — `''` for an empty one,
 *   a decorative image — else its Global alt text.
 */

const LABELS: readonly GalleryLabel[] = GALLERY_ROLE_LABELS;
const ALL_LEVELS: readonly ScopeLevel[] = ['G', 'C', 'CL'];

/** One product's gallery overrides as they resolve at one scope. */
export interface GalleryScopeOverrides {
  /** role → the item holding it at the scope; `null` = no image holds it there (an empty override). */
  roles: ReadonlyMap<GalleryLabel, string | null>;
  /** The items effectively hidden at the scope, Global `hidden` included. */
  hidden: ReadonlySet<string>;
  /** item → its alt text from an override at the scope (`''` = empty override); absent = the Global alt text. */
  altText: ReadonlyMap<string, string>;
}

/** The scope a gallery read resolves at: `channelId` `null` = Global, `languageCode` `null` = the Channel level. */
export interface GalleryReadScope {
  channelId: string | null;
  languageCode: string | null;
}

export function effectiveGallery<T extends { id: string; labels: readonly GalleryLabel[] }>(
  items: readonly T[],
  overrides: GalleryScopeOverrides | undefined,
): Array<T & { labels: GalleryLabel[] }> {
  if (!overrides || (overrides.roles.size === 0 && overrides.hidden.size === 0)) {
    return items.map((item) => ({ ...item, labels: [...item.labels] }));
  }
  const ids = new Set(items.map((item) => item.id));
  const holder = new Map<GalleryLabel, string | null>();
  for (const item of items) for (const label of item.labels) holder.set(label, item.id);
  for (const [label, itemId] of overrides.roles) {
    if (itemId === null) holder.set(label, null);
    else if (ids.has(itemId)) holder.set(label, itemId);
  }
  return items
    .filter((item) => !overrides.hidden.has(item.id))
    .map((item) => ({
      ...item,
      labels: LABELS.filter((label) => holder.get(label) === item.id),
    }));
}

function toScopeRef(scope: GalleryReadScope): ScopeRef | null {
  if (scope.channelId === null) return null;
  return scope.languageCode === null
    ? { level: 'channel', channelId: scope.channelId }
    : { level: 'channel_language', channelId: scope.channelId, languageCode: scope.languageCode };
}

/** An override of the scope applies when the resolution came from a C or C×L row. */
const fromOverride = (source: string): boolean => source === 'set' || source === 'set_empty' || source === 'inherited_channel';

/**
 * The pure core of {@link loadGalleryScopes}: one product's items (their Global `hidden`) and
 * override rows resolved at `scope`.
 */
export function resolveGalleryScope(input: {
  items: ReadonlyArray<{ id: string; hidden: boolean }>;
  itemRows: ReadonlyArray<{ galleryItemId: string; channelId: string; languageCode: string | null; field: string; value: unknown }>;
  roleRows: ReadonlyArray<{ label: GalleryLabel; channelId: string; languageCode: string | null; galleryItemId: string | null }>;
  scope: GalleryReadScope;
}): GalleryScopeOverrides {
  const ref = toScopeRef(input.scope);
  const hidden = new Set<string>();
  const altText = new Map<string, string>();
  const roles = new Map<GalleryLabel, string | null>();
  const rows = input.itemRows.map((row) => ({
    subjectId: row.galleryItemId,
    salesChannelId: row.channelId,
    languageCode: row.languageCode,
    field: row.field,
    value: row.value,
  }));
  for (const item of input.items) {
    if (ref === null) {
      if (item.hidden) hidden.add(item.id);
      continue;
    }
    const isHidden = resolveScoped<boolean>({
      global: item.hidden,
      rows: familyOverrideRows<boolean>(rows, item.id, 'hidden'),
      scope: ref,
      levels: ALL_LEVELS,
    });
    if (isHidden.value === true) hidden.add(item.id);
    const alt = resolveScoped<string>({
      global: null,
      rows: familyOverrideRows<string>(rows, item.id, 'alt_text'),
      scope: ref,
      levels: ALL_LEVELS,
    });
    if (fromOverride(alt.source)) altText.set(item.id, typeof alt.value === 'string' ? alt.value : '');
  }
  if (ref !== null) {
    const roleRows = input.roleRows.map((row) => ({ ...row, salesChannelId: row.channelId }));
    for (const label of LABELS) {
      const resolved = resolveScoped<string>({ global: null, rows: galleryRoleRows(roleRows, label), scope: ref, levels: ALL_LEVELS });
      if (fromOverride(resolved.source)) roles.set(label, resolved.value);
    }
  }
  return { roles, hidden, altText };
}

/**
 * The gallery overrides of a page's products at one scope (`data-model.md` §6), read from
 * `gallery_items.hidden`, `gallery_item_scope_overrides` and `gallery_role_scope_overrides` —
 * three statements for the page. A product with no override and no hidden item gets an entry
 * whose sets are empty.
 */
export async function loadGalleryScopes(
  em: EntityManager,
  productIds: readonly string[],
  scope: GalleryReadScope,
): Promise<Map<string, GalleryScopeOverrides>> {
  const out = new Map<string, GalleryScopeOverrides>();
  if (productIds.length === 0) return out;
  const ids = uuidArrayLiteral([...new Set(productIds)]);
  // `em.execute`, so a caller inside a transaction reads its own writes (issue #200).
  const items = await em.execute<Array<{ id: string; product_id: string; hidden: boolean }>>(
    `select id::text as id, product_id::text as product_id, coalesce(hidden, false) as hidden
       from gallery_items where product_id = any(?::uuid[])`,
    [ids],
  );
  const scopeFilter = `sales_channel_id = ? and (language_code is null or lower(language_code) = lower(?::text))`;
  const [itemRows, roleRows] =
    scope.channelId === null || items.length === 0
      ? [[], []]
      : await Promise.all([
          em.execute<Array<{ gallery_item_id: string; product_id: string; language_code: string | null; field: string; value: unknown }>>(
            `select gallery_item_id::text as gallery_item_id, product_id::text as product_id, language_code, field, value
               from gallery_item_scope_overrides
              where product_id = any(?::uuid[]) and ${scopeFilter}`,
            [ids, scope.channelId, scope.languageCode],
          ),
          em.execute<Array<{ product_id: string; label: GalleryLabel; language_code: string | null; gallery_item_id: string | null }>>(
            `select product_id::text as product_id, label, language_code, gallery_item_id::text as gallery_item_id
               from gallery_role_scope_overrides
              where product_id = any(?::uuid[]) and ${scopeFilter}`,
            [ids, scope.channelId, scope.languageCode],
          ),
        ]);
  const channelId = scope.channelId ?? '';
  for (const productId of new Set(items.map((item) => item.product_id))) {
    out.set(
      productId,
      resolveGalleryScope({
        items: items.filter((item) => item.product_id === productId),
        itemRows: itemRows
          .filter((row) => row.product_id === productId)
          .map((row) => ({ galleryItemId: row.gallery_item_id, channelId, languageCode: row.language_code, field: row.field, value: row.value })),
        roleRows: roleRows
          .filter((row) => row.product_id === productId)
          .map((row) => ({ label: row.label, channelId, languageCode: row.language_code, galleryItemId: row.gallery_item_id })),
        scope,
      }),
    );
  }
  return out;
}

/**
 * The scope overview's media rows (163 T118c, feature 172 data-model §6): every (field, channel,
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
