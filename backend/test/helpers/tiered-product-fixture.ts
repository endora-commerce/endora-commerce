import { expect } from 'vitest';
import type { BackendServerHandle } from './test-server.js';
import { Product } from './package-entities.js';
import { seedBaseTiersSql } from './price-book-sql.js';

/** The list price below the volume bracket. */
export const TIER_UNIT_PRICE = '11.49';
/** The list price from {@link TIER_VOLUME_FROM} pieces up. */
export const TIER_VOLUME_PRICE = '1.00';
export const TIER_VOLUME_FROM = 100;

/**
 * A product of its own, created for the calling file, priced in the PLN base
 * book in two quantity tiers — {@link TIER_UNIT_PRICE} below
 * {@link TIER_VOLUME_FROM} pieces and {@link TIER_VOLUME_PRICE} from there up —
 * with unmanaged stock, so a placement is refused for nothing but its price.
 *
 * A fresh product rather than a seeded one, so the brackets reach no other file
 * that prices the seeded catalogue.
 */
export async function createTieredProduct(h: BackendServerHandle, suffix: string): Promise<string> {
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/catalog/products',
    payload: {
      sku: `TIER-${suffix}`,
      type: 'simple',
      // Feature 170 (`contracts/readers.md` §2) — the Global texts are one string each.
      name: `Tiered product ${suffix}`,
      description: '',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
      // Feature 163 (Q1-d) — a product created without a status is `inactive`,
      // which no basket or placement accepts; this one is meant to be on sale.
      status: 'active',
    },
    cookies: { b2b_session: 'stub-admin-session' },
  });
  expect(created.statusCode).toBe(201);
  const productId = (created.json() as { data: { id: string } }).data.id;
  // The admin create route does not take the stock flags.
  await h.em().nativeUpdate(Product, { id: productId }, { manageStock: false });

  await seedBaseTiersSql(h.em(), productId, [
    { minQuantity: 1, maxQuantity: TIER_VOLUME_FROM - 1, amount: TIER_UNIT_PRICE },
    { minQuantity: TIER_VOLUME_FROM, maxQuantity: null, amount: TIER_VOLUME_PRICE },
  ]);
  // The engine's caches are per process and the write above is not audited:
  // tell the engine, as an audited write would.
  await (h.container as unknown as { resolve<T>(name: string): T })
    .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
    .handle.pricingGeneration.bump();
  return productId;
}

/** A product no price book prices. */
export async function createUnpricedProduct(h: BackendServerHandle, suffix: string): Promise<string> {
  const created = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/catalog/products',
    payload: {
      sku: `NOPRICE-${suffix}`,
      type: 'simple',
      name: `Unpriced product ${suffix}`,
      description: '',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
      // Feature 163 (Q1-d) — a product created without a status is `inactive`,
      // which no basket or placement accepts; this one is meant to be on sale.
      status: 'active',
    },
    cookies: { b2b_session: 'stub-admin-session' },
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { data: { id: string } }).data.id;
}
