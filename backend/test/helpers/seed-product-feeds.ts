import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceList } from '../../src/modules/price_lists/entities/price-list.entity.js';
import { PriceListProduct } from '../../src/modules/price_lists/entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../../src/modules/price_lists/entities/price-list-price-bracket.entity.js';
import type { BackendServerHandle } from './test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from './seed-catalog.js';

/**
 * Fixture for the Product Feed tests (feature 067).
 *
 * A feed only publishes when it actually emits items, and the shipped Google
 * template marks `g:link` and `g:price` as provider-required. So a test that
 * wants a *published* artefact has to give the catalogue both — a storefront
 * origin for the channel and a price for each product. Doing it in one helper
 * keeps that coupling visible instead of scattering it across test files.
 */

/** The origin the feed's `link` field is built on. */
export const TEST_STOREFRONT_ORIGIN = 'https://shop.test.example.com';

/**
 * Points the generator at a storefront origin, by writing the **per-channel
 * setting** the generator actually reads.
 *
 * Deliberately NOT `process.env.STOREFRONT_BASE_URL`: `setupBackendServer()`
 * runs once per test file inside a single fork, so an env mutation is visible
 * to every other file in the run. An earlier version of this helper did that
 * and broke `test/contract/seo/sitemap.test.ts`, which reads the same setting
 * and falls back to its own origin — a leak a targeted run never shows.
 */
export async function setChannelStorefrontUrl(
  h: BackendServerHandle,
  channelCode: string,
  url: string = TEST_STOREFRONT_ORIGIN,
): Promise<void> {
  await h.settings.adminService.setValueForSubset(
    'sales_channels.storefront_url',
    [channelCode],
    url,
    null,
    { actorAdminUserId: null },
  );
}

/**
 * Seeds an active, rule-less base price list covering the three products from
 * `seedUs1Catalog`, so the anonymous channel resolution has something to
 * resolve.
 *
 * The list is a **catch-all, not the system list** (issue #50). What the
 * anonymous resolution lands on is `{kind:'all'}` plus `status: 'active'`; the
 * `is_system` flag it used to raise was never read on this path and marks the
 * platform's one seeded `Default` row, which is now a database singleton. Every
 * caller committed such a row and every one of them left it behind, so the next
 * file to seed `Default` saw two — which is how the guard in
 * `default-seed-and-migration` started failing. The flag was also never
 * overridden by a caller, so the option it hung off is gone with it.
 */
export async function seedFeedPrices(
  em: EntityManager,
  options: { code?: string; amount?: string } = {},
): Promise<string> {
  const list = em.create(PriceList, {
    code: options.code ?? 'feed_test_default',
    name: 'Feed test list',
    currency: 'PLN',
    type: 'base',
    status: 'active',
    applicationRule: { kind: 'all' },
    modifiedAt: new Date(),
  });
  await em.persistAndFlush(list);

  const productIds = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID];
  // The assignment rows must land before the brackets: the bracket table's
  // foreign key cascades off `price_list_products`, and MikroORM batches
  // inserts by entity type rather than in persist order.
  for (const productId of productIds) {
    em.create(PriceListProduct, { priceListId: list.id, productId });
  }
  await em.flush();

  for (const productId of productIds) {
    em.create(PriceListPriceBracket, {
      priceListId: list.id,
      productId,
      currencyCode: 'PLN',
      minQuantity: 1,
      amount: options.amount ?? '100.0000',
    });
  }
  await em.flush();
  return list.id;
}
