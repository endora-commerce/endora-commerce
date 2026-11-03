import type { ProductBrowserItem } from './types.js';

/**
 * The two line helpers every product-browser host shares (feature 145): one name
 * and one quantity rule, so the order, quote-request and price-list screens and
 * the kit's own picker cannot drift apart on either.
 */

/**
 * The name a product is shown under: its Global name (feature 170, FR-031 — the admin list
 * has no channel, so it answers one string), else the slug, else the SKU.
 */
export function productDisplayName(
  item: Pick<ProductBrowserItem, 'name'> & { slug?: string | undefined; sku?: string | undefined },
): string {
  return item.name || item.slug || item.sku || '';
}

/** A whole number of at least 1, or `null` when the input is not one. */
export function parsePositiveInt(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
