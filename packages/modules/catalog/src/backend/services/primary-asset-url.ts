import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReadPort, GalleryLabel } from '@endora-commerce/contracts';
import { effectiveGallery, loadGalleryScopes, type GalleryScopeOverrides } from './gallery-scopes.js';

/**
 * "Which image represents this product" — resolved once, in one place
 * (feature 075, the `assets_library` cut).
 *
 * The chain is T096's and is unchanged: the gallery's `thumbnail`, else its
 * `base_image`, else its first item by position, else the first legacy
 * `product_assets` row by position, else nothing.
 *
 * What changed is where the URL comes from. This lived in **three** places —
 * `catalog-query.service.ts` twice (the per-product summary and the batch
 * listing) and `product-link.service.ts` once — and every one of them wrote
 * `join assets a on a.id = gi.asset_id`, six joins in total. `assets` is
 * `assets_library`'s table, and a raw `SELECT` names no import specifier, so
 * `check:module-boundary` could not see any of them while it counted this
 * module's `import { Asset }` statements one file away. That is plan.md trap 6
 * exactly: two modules querying one table, invisible to every check in the
 * tree. D-87 is the ruling that gives the check a second predicate for it.
 *
 * The bridge rows still come from this module's own tables — `gallery_items`,
 * `gallery_item_labels` and `product_assets` are `catalog`'s — and only the
 * asset **row** is asked of its owner, in one batched `findByIds` per stage.
 *
 * The label chain is applied *after* the assets resolve, so a gallery item
 * whose asset row is gone falls through to the next candidate, and a product
 * whose whole gallery falls through takes the legacy fallback — which is what
 * the inner join did. (The foreign key is `RESTRICT`, so it cannot happen
 * today; reproducing the behaviour is cheaper than arguing it away.)
 *
 * **Is the legacy fallback dead?** Asked and answered while hoisting these
 * reads to the page (issue #263): no. Nothing in the application writes
 * `product_assets` — the only `insert` in the tree is the host's demo
 * composition, which mirrors every row it writes into `gallery_items` — but the
 * table is
 * still *read* on the PDP (`ProductDetail.assets`), still rendered by the
 * storefront gallery and by the admin product editor, and the seeded rows
 * outlive their gallery twins: deleting a gallery item through the admin
 * touches no `product_assets` row, so a seeded product whose gallery an
 * operator emptied resolves its card through this fallback. So the read is
 * batched here rather than deleted, and it costs one statement per page for
 * whatever the gallery did not answer instead of one per card.
 *
 * Both statements order by `product_id` first, which is what lets a page-wide
 * call take the same first row per product that a one-id call took.
 *
 * **Per scope (feature 163 FR-076, feature 170).** The chain runs over the gallery as
 * the card's (channel, language) shows it (`effectiveGallery`): a hidden item is never
 * a candidate, and a role is its scope holder's. Three statements more per page, and
 * only for a page whose products have a gallery.
 */

interface CandidateRow {
  product_id: string;
  asset_id: string;
  label: string | null;
}

interface GalleryRow extends CandidateRow {
  item_id: string;
}

export async function resolvePrimaryAssetUrls(
  em: EntityManager,
  assets: AssetReadPort,
  productIds: readonly string[],
  /**
   * Feature 163 (FR-076, R14) — the sales channel the card is shown in: its hidden
   * items are skipped and its own role holders replace the global ones
   * (`effectiveGallery`). `null` = the global gallery (no channel to ask about).
   */
  channelId: string | null,
  /**
   * Feature 170 — the card's scope language: with it, the C×L → C → G chain of each item's
   * `hidden` flag and each role; `null` = the Channel level.
   */
  languageCode: string | null = null,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const id of productIds) result.set(id, null);
  if (productIds.length === 0) return result;

  const ids = [...productIds];
  const galleryRows = await em.execute<GalleryRow[]>(
    `select gi.id::text as item_id,
            gi.product_id::text as product_id,
            gi.asset_id::text as asset_id,
            gil.label
       from gallery_items gi
       left join gallery_item_labels gil on gil.gallery_item_id = gi.id
      where gi.product_id in (${ids.map(() => '?').join(',')})
      order by gi.product_id, gi.position asc, gi.id asc`,
    ids,
  );
  // Only a page with a gallery asks about the scope's overrides of it.
  const overrides =
    galleryRows.length > 0
      ? await loadGalleryScopes(em, [...new Set(galleryRows.map((row) => row.product_id))], { channelId, languageCode })
      : new Map<string, GalleryScopeOverrides>();

  // One product's items in gallery order, each with its global labels.
  const itemsByProduct = new Map<string, Array<{ id: string; assetId: string; labels: GalleryLabel[] }>>();
  for (const row of galleryRows) {
    const items = itemsByProduct.get(row.product_id) ?? [];
    itemsByProduct.set(row.product_id, items);
    let item = items.find((candidate) => candidate.id === row.item_id);
    if (!item) {
      item = { id: row.item_id, assetId: row.asset_id, labels: [] };
      items.push(item);
    }
    if (row.label) item.labels.push(row.label as GalleryLabel);
  }
  const visible = new Map(
    [...itemsByProduct].map(([productId, items]) => [productId, effectiveGallery(items, overrides.get(productId))]),
  );

  // One call to the owner for every gallery candidate on the page.
  // `assets_library` is a binding dependency of this module, so an absent owner
  // fails closed here rather than quietly rendering an imageless catalogue.
  const galleryUrls = await urlsFor(
    assets,
    [...visible.values()].flat().map((item) => ({ asset_id: item.assetId })),
  );

  const galleryByProduct = new Map<string, Array<{ assetId: string; labels: GalleryLabel[] }>>();
  for (const [productId, items] of visible) {
    const withAsset = items.filter((item) => galleryUrls.has(item.assetId));
    if (withAsset.length > 0) galleryByProduct.set(productId, withAsset);
  }

  for (const [productId, items] of galleryByProduct) {
    const byLabel = (label: GalleryLabel): string | undefined =>
      galleryUrls.get(items.find((item) => item.labels.includes(label))?.assetId ?? '');
    const first = items[0] ? galleryUrls.get(items[0].assetId) : undefined;
    result.set(productId, byLabel('thumbnail') ?? byLabel('base_image') ?? first ?? null);
  }

  const missing = ids.filter((id) => !galleryByProduct.has(id));
  if (missing.length === 0) return result;

  const legacyRows = await em.execute<CandidateRow[]>(
    `select pa.product_id::text as product_id, pa.asset_id::text as asset_id, null::text as label
       from product_assets pa
      where pa.product_id in (${missing.map(() => '?').join(',')})
      order by pa.product_id, pa.position asc`,
    missing,
  );
  // An image hidden in the channel stays hidden when the legacy row names the same
  // asset (the demo composition mirrors every legacy row into the gallery).
  const hiddenAssets = new Set(
    [...itemsByProduct].flatMap(([productId, items]) => {
      const hidden = overrides.get(productId)?.hidden;
      return hidden ? items.filter((item) => hidden.has(item.id)).map((item) => `${productId}|${item.assetId}`) : [];
    }),
  );
  const legacyCandidates = legacyRows.filter((row) => !hiddenAssets.has(`${row.product_id}|${row.asset_id}`));
  const legacyUrls = await urlsFor(assets, legacyCandidates);
  for (const row of legacyCandidates) {
    if (result.get(row.product_id)) continue;
    const url = legacyUrls.get(row.asset_id);
    if (url !== undefined) result.set(row.product_id, url);
  }

  return result;
}

async function urlsFor(
  assets: AssetReadPort,
  rows: ReadonlyArray<Pick<CandidateRow, 'asset_id'>>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.asset_id))];
  if (ids.length === 0) return new Map();
  return new Map((await assets.findByIds(ids)).map((asset) => [asset.id, asset.storageUrl]));
}
