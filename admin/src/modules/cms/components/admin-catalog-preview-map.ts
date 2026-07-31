/** Pure helpers for admin CMS catalog preview mapping (testable without React). */

export function pickAdminLocalizedName(
  name: Record<string, string> | string,
  fallback: string,
): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

export function mapAdminProductToCmsSummary(product: {
  id: string;
  slug: string;
  name: Record<string, string> | string;
  sku: string;
}): {
  id: string;
  slug: string;
  name: string;
  sku: string;
  primaryAssetUrl: null;
  price: null;
  stockLevel: null;
} {
  return {
    id: product.id,
    slug: product.slug,
    name: pickAdminLocalizedName(product.name, product.slug),
    sku: product.sku,
    primaryAssetUrl: null,
    price: null,
    stockLevel: null,
  };
}
