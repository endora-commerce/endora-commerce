import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import { Asset } from '../../src/modules/assets_library/entities/asset.entity.js';
import { Category } from '../../src/modules/catalog/entities/category.entity.js';
import { GalleryItem } from '../../src/modules/catalog/entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../../src/modules/catalog/entities/gallery-item-label.entity.js';
import { Product } from '../../src/modules/catalog/entities/product.entity.js';
import { PriceList } from '../../src/modules/price_lists/entities/price-list.entity.js';
import { PriceListPriceBracket } from '../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import { PriceListProduct } from '../../src/modules/price_lists/entities/price-list-product.entity.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../src/modules/price_lists/services/default-price-list-migration.js';
import { TEST_ORGANIZATION_ID } from './test-actors.js';

/**
 * A catalogue page **whose cards carry the rows a card reads** — a page many
 * cards wide, unlike `viewer-priced-fixture.ts`, which is the two-card version
 * of the same idea and is where the per-card *values* are pinned.
 *
 * Every other multi-card listing corpus in `test/perf/` seeds bare `Product`
 * rows: no gallery, no `product_assets`, no categories. A page over that corpus
 * still runs the gallery query, the legacy-asset query and the category-slug
 * join — and gets **zero rows** from all three, so both `assets.findByIds`
 * calls short-circuit on an empty id list and are never issued at all, and the
 * price-list resolution skips its category-override lookup for the same reason.
 * Measured on `origin/master` (6f95d4f4): 11 statements for a 50-card page over
 * the bare corpus, 14 over this one. Three of the fourteen reads the shop's
 * page issues were invisible to the measurement pinning it, and two of those
 * three are the asset half of the very thing issue #263 hoisted — so a
 * re-opened per-card `assets.findByIds` cost the bare corpus nothing and passed.
 *
 * That is issue #140's lesson one level down: the page had products, and the
 * reads under measurement had nothing to read.
 *
 * So this corpus gives every card its rows:
 *
 * - **two categories each**, drawn from a pool, so the slug join comes back
 *   with `2 × page` rows and a per-card re-open shows up as `page` statements;
 * - **a gallery** on every second product — a first-by-position item and a
 *   `thumbnail`-labelled one, each pointing at that product's **own** asset, so
 *   the gallery arm's `findByIds` is handed one id per card rather than one
 *   shared id a per-card loop could serve out of the identity map;
 * - **a legacy `product_assets` row** on the others, so the fallback arm and
 *   its own `findByIds` run on the same page as the gallery arm.
 *
 * Priced through the seeded system Default list, because an unpriced page skips
 * the pricing resolution and would time a page the shop never serves.
 */

/** How many distinct categories the corpus rotates its cards through. */
export const RICH_CORPUS_CATEGORY_POOL = 8;

/** What every card is quoted, through the seeded Default price list. */
export const RICH_CORPUS_AMOUNT = 99;

/**
 * How far apart two consecutive cards' `created_at` values are placed, in
 * milliseconds. Enough to order them, small enough that the corpus stays the
 * newest block in the database — a listing with no `q` pages the whole
 * `products` table, so a corpus back-dated to a fixed epoch would sit behind
 * whatever the harness seeded and the page under measurement would be somebody
 * else's rows.
 */
const CARD_SPACING_MS = 1;

export interface RichListingCorpus {
  /**
   * Every seeded product id, in creation order — which is `created_at`
   * ascending, so a default listing returns them in exactly the reverse.
   */
  productIds: string[];
  /** The ids seeded `organization_restricted`, allow-listed to one Organization. */
  restrictedProductIds: string[];
  /** Product id -> the url its card must render. */
  expectedAssetUrl: Map<string, string>;
  /**
   * Product id -> the `assets` row behind that url. It is the binding a caller
   * asserts on when the question is which rows of **another module's** table a
   * page read, which a url cannot answer.
   */
  expectedAssetId: Map<string, string>;
  /** Product id -> the slugs its card must render, in `category_id` order. */
  expectedCategorySlugs: Map<string, string[]>;
}

export interface RichListingCorpusOptions {
  /**
   * Mark every n-th product `organization_restricted` and allow-list it to
   * {@link TEST_ORGANIZATION_ID}, so a caller can ask what an anonymous page
   * reads for rows it may not see. `0` (the default) seeds a public corpus.
   */
  restrictedEvery?: number;
  /** Distinguishes two corpora in one database; also the SKU prefix. */
  prefix?: string;
}

/**
 * Seeds `size` channel-visible, priced products with the card data above and
 * returns what each card's right answer is.
 */
export async function seedRichListingCorpus(
  em: EntityManager,
  size: number,
  options?: RichListingCorpusOptions,
): Promise<RichListingCorpus> {
  const prefix = options?.prefix ?? 'RICH';
  const restrictedEvery = options?.restrictedEvery ?? 0;
  const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

  const categories = Array.from({ length: RICH_CORPUS_CATEGORY_POOL }, (_, i) => {
    const slug = `${prefix.toLowerCase()}-category-${String(i).padStart(2, '0')}`;
    return em.create(Category, { name: { 'en-US': slug }, slug });
  });
  await em.flush();
  const slugByCategoryId = new Map(categories.map((c) => [c.id, c.slug]));

  const restrictedProductIds: string[] = [];
  const products = Array.from({ length: size }, (_, i) => {
    const idx = String(i).padStart(6, '0');
    const restricted = restrictedEvery > 0 && i % restrictedEvery === 0;
    return em.create(Product, {
      sku: `${prefix}-${idx}`,
      slug: `${prefix.toLowerCase()}-${idx}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': `${prefix} product ${idx}` },
      description: { 'en-US': `Synthetic product ${idx}.` },
      visibility: restricted ? 'organization_restricted' : 'public',
      allowedOrganizationIds: restricted ? [TEST_ORGANIZATION_ID] : [],
      attributeValues: { defaultPrice: 10 + (i % 100) },
    });
  });
  await em.persistAndFlush(products);
  products.forEach((p, i) => {
    if (restrictedEvery > 0 && i % restrictedEvery === 0) restrictedProductIds.push(p.id);
  });
  const productIds = products.map((p) => p.id);

  // A listing sorts by `(created_at desc, id desc)`, and a corpus written in one
  // pass ties on the first key — which leaves the *composition* of any page
  // narrower than the corpus up to whatever uuids Postgres happened to
  // generate. A page whose composition varies cannot be measured: the gallery
  // arm's `assets.findByIds` is skipped when no card on that page has a
  // gallery, so the statement count would flap by one between runs. One second
  // apart, ascending with the index, makes page order the reverse of creation
  // order and every card's position knowable.
  await em.execute(
    `update products set created_at = ?::timestamptz + make_interval(secs => v.idx::float8) ` +
      `from (values ${productIds.map(() => '(?::uuid,?::float8)').join(',')}) as v(id, idx) ` +
      `where products.id = v.id`,
    [
      new Date().toISOString(),
      ...productIds.flatMap((id, i) => [id, (i * CARD_SPACING_MS) / 1000]),
    ],
  );

  await em.execute(
    `insert into sales_channel_products (sales_channel_id, product_id) values ${productIds
      .map(() => '(?,?)')
      .join(',')}`,
    productIds.flatMap((id) => [channel.id, id]),
  );

  // Two categories per card, rotating through the pool, so no two neighbouring
  // cards carry the same pair and a page-wide read that lost its key is visible
  // on the card next door.
  const assignments = productIds.map((id, i) => ({
    productId: id,
    categoryIds: [categories[i % categories.length]!.id, categories[(i + 1) % categories.length]!.id],
  }));
  await em.execute(
    `insert into product_categories (product_id, category_id) values ${assignments
      .flatMap((a) => a.categoryIds)
      .map(() => '(?,?)')
      .join(',')}`,
    assignments.flatMap((a) => a.categoryIds.flatMap((categoryId) => [a.productId, categoryId])),
  );
  const expectedCategorySlugs = new Map<string, string[]>();
  for (const assignment of assignments) {
    // `ProductSummary.categorySlugs` comes back in `(product_id, category_id)`
    // primary-key order, and Postgres orders `uuid` byte-wise — which is the
    // order of the canonical lowercase text, so sorting the ids as strings is
    // the same order the row read hands back.
    expectedCategorySlugs.set(
      assignment.productId,
      [...assignment.categoryIds].sort().map((id) => slugByCategoryId.get(id)!),
    );
  }

  const expectedAssetUrl = new Map<string, string>();
  const expectedAssetId = new Map<string, string>();
  const labelledGalleryAssetIds = new Set<string>();
  const legacyRows: Array<[string, string]> = [];
  const galleryItems: Array<{ productId: string; assetId: string; position: number }> = [];
  const asset = (name: string): Asset =>
    em.create(Asset, {
      kind: 'image',
      filename: `${name}.svg`,
      mimeType: 'image/svg+xml',
      sizeBytes: '128',
      storageUrl: `https://assets.test/${name}.svg`,
    });
  productIds.forEach((productId, i) => {
    const base = `${prefix.toLowerCase()}-${String(i).padStart(6, '0')}`;
    if (i % 2 === 0) {
      // Position 0 is the first item and position 1 carries the `thumbnail`
      // label, so a card that took the first gallery row quotes the wrong url.
      const first = asset(`${base}-first`);
      const thumbnail = asset(`${base}-thumbnail`);
      galleryItems.push(
        { productId, assetId: first.id, position: 0 },
        { productId, assetId: thumbnail.id, position: 1 },
      );
      labelledGalleryAssetIds.add(thumbnail.id);
      expectedAssetUrl.set(productId, thumbnail.storageUrl);
      expectedAssetId.set(productId, thumbnail.id);
    } else {
      const legacy = asset(`${base}-legacy`);
      legacyRows.push([productId, legacy.id]);
      expectedAssetUrl.set(productId, legacy.storageUrl);
      expectedAssetId.set(productId, legacy.id);
    }
  });
  await em.flush();

  const items = galleryItems.map((item) => em.create(GalleryItem, item));
  await em.flush();
  for (const item of items) {
    if (!labelledGalleryAssetIds.has(item.assetId)) continue;
    em.create(GalleryItemLabel, {
      galleryItemId: item.id,
      productId: item.productId,
      label: 'thumbnail',
    });
  }
  await em.flush();

  if (legacyRows.length > 0) {
    await em.execute(
      `insert into product_assets (product_id, asset_id, position) values ${legacyRows
        .map(() => '(?,?,0)')
        .join(',')}`,
      legacyRows.flat(),
    );
  }

  await priceThroughDefaultList(em, productIds);

  return {
    productIds,
    restrictedProductIds,
    expectedAssetUrl,
    expectedAssetId,
    expectedCategorySlugs,
  };
}

/**
 * The channel answer every card is quoted: the seeded system Default list, one
 * bracket per product. Written as entities rather than through
 * `PriceListService` because that service is a per-product round trip and this
 * corpus is sized for a page, not for a unit test.
 */
async function priceThroughDefaultList(em: EntityManager, productIds: string[]): Promise<void> {
  const existing = await em.findOne(PriceList, { id: DEFAULT_PRICE_LIST_ID });
  if (!existing) await new DefaultPriceListMigrator(() => em).seedDefault();
  for (const productId of productIds) {
    em.create(PriceListProduct, { priceListId: DEFAULT_PRICE_LIST_ID, productId });
  }
  await em.flush();
  for (const productId of productIds) {
    em.create(PriceListPriceBracket, {
      priceListId: DEFAULT_PRICE_LIST_ID,
      productId,
      currencyCode: 'PLN',
      minQuantity: 1,
      maxQuantity: null,
      amount: `${RICH_CORPUS_AMOUNT}.00`,
    });
  }
  await em.flush();
}
