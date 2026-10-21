import type { EntityManager } from '@mikro-orm/postgresql';
import { seedPriceBookSql } from './price-book-sql.js';
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
 * Seeds an active price book for everyone on every channel covering the three
 * products from `seedUs1Catalog`, so the anonymous channel resolution has
 * something to resolve (feature 160: a channel catalogue book, which overrides
 * their base prices). Answers the book's id, which a feed may also name.
 */
export async function seedFeedPrices(
  em: EntityManager,
  options: { code?: string; amount?: string } = {},
): Promise<string> {
  const amount = options.amount ?? '100.0000';
  return seedPriceBookSql(em, {
    name: options.code ?? 'Feed test book',
    audience: 'everyone',
    rows: [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID].map((productId) => ({ productId, fixed: amount })),
  });
}
