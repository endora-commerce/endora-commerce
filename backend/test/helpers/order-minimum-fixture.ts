import { seedBasePriceSql } from './price-book-sql.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product, ProductPackagingUnit, ProductVariant } from './package-entities.js';

/**
 * Feature 155 — per-run catalogue fixtures for the cart minimum tests
 * (`specs/155-catalog-order-constraints/`, Phase 6).
 *
 * A product carries an English and a Polish name, so a refusal can be checked
 * for naming it in the request's language, a `defaultPrice` attribute, and a
 * `sales_channel_products` row on every channel the caller names — without the
 * bridge row the add is refused by the channel gate, not by the minimum.
 */

/** A unique suffix for this run's SKUs, slugs and unit names. */
export function minimumFixtureRun(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface MinimumProductFixture {
  id: string;
  sku: string;
  nameEn: string;
  namePl: string;
}

/** The `pl_retail` channel and the system default — the two a buyer request resolves to. */
export async function buyerChannelIds(em: EntityManager): Promise<string[]> {
  const channels = await em.find(SalesChannel, {
    $or: [{ code: 'pl_retail' }, { systemDefault: true }],
  });
  return Array.from(new Set(channels.map((c) => c.id)));
}

export async function createMinimumProduct(
  em: EntityManager,
  input: {
    sku: string;
    nameEn: string;
    namePl: string;
    type?: 'simple' | 'configurable';
    minOrderQuantity?: number | null;
    /** The product's returnable flag (feature 155, FR-003); `false` when omitted, the column default. */
    returnable?: boolean;
    /** Channels publishing the product; empty = sold nowhere (hidden from every buyer request). */
    channelIds: readonly string[];
  },
): Promise<MinimumProductFixture> {
  const product = em.create(Product, {
    sku: input.sku,
    slug: input.sku.toLowerCase(),
    type: input.type ?? 'simple',
    status: 'active',
    name: { en: input.nameEn, pl: input.namePl },
    description: { en: '' },
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: {},
    minOrderQuantity: input.minOrderQuantity ?? null,
    returnable: input.returnable ?? false,
  });
  await em.persistAndFlush(product);
  // Feature 160 — its price is a base-book row (the legacy `defaultPrice` it
  // carried is not a price any more, FR-018).
  await seedBasePriceSql(em, product.id, '10');
  for (const channelId of input.channelIds) {
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
        [channelId, product.id],
      );
  }
  return { id: product.id, sku: input.sku, nameEn: input.nameEn, namePl: input.namePl };
}

export async function createMinimumVariant(
  em: EntityManager,
  parentProductId: string,
  sku: string,
): Promise<string> {
  const variant = em.create(ProductVariant, {
    parentProductId,
    sku,
    variantAttributeValues: { color: sku },
  });
  await em.persistAndFlush(variant);
  return variant.id;
}

export async function createMinimumPackagingUnit(
  em: EntityManager,
  input: { productId: string; name: string; baseQuantity: number; minOrderUnits?: number | null },
): Promise<string> {
  const unit = em.create(ProductPackagingUnit, {
    productId: input.productId,
    name: input.name,
    baseQuantity: input.baseQuantity,
    minOrderUnits: input.minOrderUnits ?? null,
  });
  await em.persistAndFlush(unit);
  return unit.id;
}

/** Sets a product's pieces minimum straight in the table (`null` clears it). */
export async function setProductMinimum(
  em: EntityManager,
  productId: string,
  minOrderQuantity: number | null,
): Promise<void> {
  await em.nativeUpdate(Product, { id: productId }, { minOrderQuantity });
}
