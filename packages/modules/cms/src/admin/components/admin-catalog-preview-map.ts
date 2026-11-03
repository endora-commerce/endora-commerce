/** Pure helpers for admin CMS catalog preview mapping (testable without React). */

import { productSummaryText } from '@endora-commerce/contracts';

export function pickAdminLocalizedName(
  name: Record<string, string> | string,
  fallback: string,
): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

/**
 * A product of the admin catalogue API as a preview card's product. Feature
 * 163, T196: the card's summary is derived from the description by the rule
 * the storefront's listing uses (`productSummaryText`), so a listing's "text
 * under the product name" shows the same line in the editor as on the page.
 * Feature 170 (FR-031): the editor has no channel, so both are the Global strings.
 */
export function mapAdminProductToCmsSummary(product: {
  id: string;
  slug: string;
  name: string;
  sku: string;
  description?: string | null;
}): {
  id: string;
  slug: string;
  name: string;
  sku: string;
  primaryAssetUrl: null;
  price: null;
  stockLevel: null;
  summary: string | null;
} {
  const description = product.description;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name || product.slug,
    sku: product.sku,
    primaryAssetUrl: null,
    price: null,
    stockLevel: null,
    summary: description === null || description === undefined ? null : productSummaryText(description),
  };
}
