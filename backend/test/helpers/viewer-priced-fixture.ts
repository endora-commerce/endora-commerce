import type { EntityManager } from '@mikro-orm/postgresql';
import { Asset, Organization } from './package-entities.js';
import { seedPriceBookSql } from './price-book-sql.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Category } from './package-entities.js';
import { GalleryItem } from './package-entities.js';
import { GalleryItemLabel } from './package-entities.js';
import { Product } from './package-entities.js';
import { ProductLink } from './package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from './test-actors.js';
import { bindOrganizationsToFixtureChannelsSql } from './sales-channel-access.js';

/**
 * One product, three prices, three viewers — the fixture behind the ruling that
 * an anonymous visitor sees the channel price and a signed-in buyer sees their
 * organisation's.
 *
 * The three price books are what make the three answers distinguishable
 * (feature 160): a book for everyone on the channel is the catalogue price
 * every caller meets, and two organization-set books each name exactly one
 * Organization, whose buyer tier outranks the catalogue price. So a listing
 * that lost the viewer quotes 88, a listing that priced everybody for whoever
 * asked first quotes one buyer's figure to the other, and only a listing that
 * resolves the caller quotes three different numbers to three callers.
 *
 * `defaultPrice` is set to a fourth value nobody should ever see: it is not a
 * price since feature 160 (FR-018), so a run that read it would quote 5 rather
 * than a plausible price.
 */

export const VIEWER_PRICED_SKU = 'VIEWER-PRICED-0001';
export const VIEWER_PRICED_SLUG = 'viewer-priced-0001';
export const VIEWER_PRICED_PRODUCT_ID = '00000000-0000-4000-8000-00000000f001';

/**
 * A second product that cross-sells the priced one, so the up-sell / cross-sell
 * strip can be asked the same question the listing is. It carries no price of
 * its own — it is a source, never a tile.
 */
export const VIEWER_PRICED_SOURCE_SKU = 'VIEWER-PRICED-SOURCE-0001';
export const VIEWER_PRICED_SOURCE_SLUG = 'viewer-priced-source-0001';
export const VIEWER_PRICED_SOURCE_ID = '00000000-0000-4000-8000-00000000f002';

/**
 * The two categories the priced product sits in, and the one the source product
 * sits in — fixed ids, because `ProductSummary.categorySlugs` comes back in the
 * `(product_id, category_id)` primary-key order of `product_categories` and a
 * random id would make the recorded shape a different array on every run.
 *
 * The source product's category is a *third* one for a reason: a page-wide slug
 * read that lost its key would hand the priced product's two slugs to both
 * cards, and only a card whose right answer is a different slug can tell.
 */
export const PRICED_CATEGORY_A = {
  id: '00000000-0000-4000-8000-00000000c001',
  slug: 'viewer-priced-category-a',
};
export const PRICED_CATEGORY_B = {
  id: '00000000-0000-4000-8000-00000000c002',
  slug: 'viewer-priced-category-b',
};
export const SOURCE_CATEGORY = {
  id: '00000000-0000-4000-8000-00000000c003',
  slug: 'viewer-priced-category-source',
};

/**
 * Four assets, so that both arms of the primary-asset chain are on one page.
 *
 * The priced product carries a gallery — a first-by-position item and a
 * `thumbnail`-labelled one — *and* a legacy `product_assets` row, so its card
 * proves the label wins over both the position and the legacy table. The source
 * product carries **only** a legacy row, so its card is the one that falls all
 * the way through, and it does so on the same request as a card that does not.
 */
export const PRICED_THUMBNAIL_URL = 'https://assets.test/viewer-priced-thumbnail.svg';
export const PRICED_FIRST_URL = 'https://assets.test/viewer-priced-first.svg';
export const PRICED_LEGACY_URL = 'https://assets.test/viewer-priced-legacy.svg';
export const SOURCE_LEGACY_URL = 'https://assets.test/viewer-priced-source-legacy.svg';

/** What every caller with no Organization is quoted. */
export const CHANNEL_AMOUNT = 88;
/** What a buyer of {@link TEST_ORGANIZATION_ID} is quoted. */
export const ORG_A_AMOUNT = 10;
/** What a buyer of {@link OTHER_TEST_ORGANIZATION_ID} is quoted. */
export const ORG_B_AMOUNT = 20;
/** The product's legacy own attribute — not a price (FR-018), and nobody's answer. */
export const FALLBACK_ATTRIBUTE_PRICE = 5;

/** The signed-in buyer of the seeded Organization. */
export const ORG_A_BUYER = { b2b_session: 'stub-customer-session' };
/** A signed-in buyer of a *different* Organization. */
export const ORG_B_BUYER = { b2b_session: 'stub-customer-session-other-org' };
export const RETAIL_CHANNEL = { 'x-sales-channel': 'pl_retail' };

/**
 * Seeds the product, its channel membership and the three price books.
 *
 * Idempotent per test database: the harness seeds one Organization and the
 * second one is created here, because `stub-customer-session-other-org`
 * resolves to an id the harness never wrote a row for — and a viewer whose
 * Organization has no row is priced at the channel price by design, which would
 * make the third viewer's assertion pass for the wrong reason.
 */
export async function seedViewerPricedFixture(em: EntityManager): Promise<void> {
  const existingOther = await em.findOne(Organization, { id: OTHER_TEST_ORGANIZATION_ID });
  if (!existingOther) {
    const other = em.create(Organization, {
      id: OTHER_TEST_ORGANIZATION_ID,
      name: 'Other Test Organization',
      taxId: 'PL0000000098',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 98',
        city: 'Warszawa',
        postalCode: '00-901',
        country: 'PL',
      },
    });
    await em.persistAndFlush(other);
  }
  // Feature 154 — an Organization with no sales channel may not shop anywhere;
  // bind the stores the harness seeds.
  await bindOrganizationsToFixtureChannelsSql(em, [OTHER_TEST_ORGANIZATION_ID]);

  const product = em.create(Product, {
    id: VIEWER_PRICED_PRODUCT_ID,
    sku: VIEWER_PRICED_SKU,
    slug: VIEWER_PRICED_SLUG,
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Viewer priced probe' },
    description: { 'en-US': 'One product, three viewers, three prices.' },
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: { defaultPrice: FALLBACK_ATTRIBUTE_PRICE },
  });
  await em.persistAndFlush(product);

  const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
  if (!retail) throw new Error('the harness seeds pl_retail');
  await em
    .getConnection()
    .execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
      [retail.id, VIEWER_PRICED_PRODUCT_ID],
    );

  const source = em.create(Product, {
    id: VIEWER_PRICED_SOURCE_ID,
    sku: VIEWER_PRICED_SOURCE_SKU,
    slug: VIEWER_PRICED_SOURCE_SLUG,
    type: 'simple',
    status: 'active',
    name: { 'en-US': 'Viewer priced probe source' },
    description: { 'en-US': 'Cross-sells the priced product.' },
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: {},
  });
  await em.persistAndFlush(source);
  await em
    .getConnection()
    .execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
      [retail.id, VIEWER_PRICED_SOURCE_ID],
    );
  em.create(ProductLink, {
    sourceProductId: VIEWER_PRICED_SOURCE_ID,
    targetProductId: VIEWER_PRICED_PRODUCT_ID,
    kind: 'cross_sell',
    position: 0,
  });
  await em.flush();

  await seedCardReads(em);

  // Feature 160 — three price books: the channel price for everyone (the
  // catalogue tier), and one organization-set book per Organization (the buyer
  // tier). No base price, so a resolution that lost the books quotes nothing.
  await seedPriceBookSql(em, {
    name: 'Viewer probe channel book',
    audience: 'everyone',
    rows: [{ productId: VIEWER_PRICED_PRODUCT_ID, fixed: `${CHANNEL_AMOUNT}.00` }],
  });
  await seedPriceBookSql(em, {
    name: 'Viewer probe organisation A',
    audience: { organizations: [TEST_ORGANIZATION_ID] },
    rows: [{ productId: VIEWER_PRICED_PRODUCT_ID, fixed: `${ORG_A_AMOUNT}.00` }],
  });
  await seedPriceBookSql(em, {
    name: 'Viewer probe organisation B',
    audience: { organizations: [OTHER_TEST_ORGANIZATION_ID] },
    rows: [{ productId: VIEWER_PRICED_PRODUCT_ID, fixed: `${ORG_B_AMOUNT}.00` }],
  });
}

/**
 * The two reads a listing card needs beyond the product row and its price: the
 * category slugs and the primary asset url.
 *
 * Both are page-wide reads keyed by product id, and both used to run once per
 * card, so the fixture is built for the failure a batched read has and a loop
 * does not — one card's answer served for another's. Hence three categories
 * across two products, and a gallery on one product only.
 */
async function seedCardReads(em: EntityManager): Promise<void> {
  for (const category of [PRICED_CATEGORY_A, PRICED_CATEGORY_B, SOURCE_CATEGORY]) {
    em.create(Category, {
      id: category.id,
      name: { 'en-US': category.slug },
      slug: category.slug,
    });
  }
  await em.flush();

  const conn = em.getConnection();
  await conn.execute(
    `insert into product_categories (product_id, category_id) values (?, ?), (?, ?), (?, ?)`,
    [
      VIEWER_PRICED_PRODUCT_ID,
      PRICED_CATEGORY_A.id,
      VIEWER_PRICED_PRODUCT_ID,
      PRICED_CATEGORY_B.id,
      VIEWER_PRICED_SOURCE_ID,
      SOURCE_CATEGORY.id,
    ],
  );

  const assets = [
    { id: '00000000-0000-4000-8000-00000000a001', url: PRICED_FIRST_URL },
    { id: '00000000-0000-4000-8000-00000000a002', url: PRICED_THUMBNAIL_URL },
    { id: '00000000-0000-4000-8000-00000000a003', url: PRICED_LEGACY_URL },
    { id: '00000000-0000-4000-8000-00000000a004', url: SOURCE_LEGACY_URL },
  ];
  for (const asset of assets) {
    em.create(Asset, {
      id: asset.id,
      kind: 'image',
      filename: `${asset.id}.svg`,
      mimeType: 'image/svg+xml',
      sizeBytes: '128',
      storageUrl: asset.url,
    });
  }
  await em.flush();

  // Position 0 is the *first* item and position 1 carries the `thumbnail`
  // label, so a card that returned the first gallery row would quote
  // PRICED_FIRST_URL and a card that applied the label chain quotes
  // PRICED_THUMBNAIL_URL. The two are distinguishable on purpose.
  const galleryItems = [
    { id: '00000000-0000-4000-8000-00000000b001', assetId: assets[0]!.id, position: 0 },
    { id: '00000000-0000-4000-8000-00000000b002', assetId: assets[1]!.id, position: 1 },
  ];
  for (const item of galleryItems) {
    em.create(GalleryItem, {
      id: item.id,
      productId: VIEWER_PRICED_PRODUCT_ID,
      assetId: item.assetId,
      position: item.position,
    });
  }
  await em.flush();
  em.create(GalleryItemLabel, {
    galleryItemId: galleryItems[1]!.id,
    productId: VIEWER_PRICED_PRODUCT_ID,
    label: 'thumbnail',
  });
  await em.flush();

  await conn.execute(
    `insert into product_assets (product_id, asset_id, position) values (?, ?, 0), (?, ?, 0)`,
    [VIEWER_PRICED_PRODUCT_ID, assets[2]!.id, VIEWER_PRICED_SOURCE_ID, assets[3]!.id],
  );
}
