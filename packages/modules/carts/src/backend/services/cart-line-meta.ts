import { type CatalogProductRecord } from '@endora-commerce/contracts';

/** What a basket line shows of its product. */
export interface ProductMeta {
  name: string;
  /** `null` when the product is not available at the basket's (channel, language) — no page to link to. */
  slug: string | null;
  sku: string | null;
}

/**
 * Per-product display metadata, the name resolved from the record's per-locale
 * `name` in the response's language, through the `pickLocalized` fallback
 * chain. A product without a record has no entry (the serializer treats it as
 * an unknown name and the storefront falls back to the productId).
 *
 * Feature 163 (owner decision S1 = A) — a product that is no longer available
 * at the basket's (channel, language) keeps its name and SKU, so the buyer can
 * tell which line it is, and has no slug: its product page answers the absent
 * product's 404 there, so the storefront renders no link. The line itself reads
 * `unavailable` and placement refuses it, as before.
 */
export function productMetaOf(
  products: readonly CatalogProductRecord[],
  _preferredLanguage: string | undefined,
  /** The ids available at the basket's (channel, language) to this buyer now. */
  available: ReadonlySet<string>,
  /** The effective names at the basket's (channel, language), where known. */
  effectiveNames: ReadonlyMap<string, string> = new Map(),
  /**
   * Feature 163 (T113a, R28) — the effective URL key at the basket's (channel,
   * language), where known; else the global key.
   */
  effectiveKeys: ReadonlyMap<string, string> = new Map(),
): Map<string, ProductMeta> {
  const meta = new Map<string, ProductMeta>();
  for (const p of products) {
    meta.set(p.id, {
      name: effectiveNames.get(p.id) || p.name, // 168-shim: Global text
      slug: available.has(p.id) ? (effectiveKeys.get(p.id) ?? p.slug) : null,
      sku: p.sku,
    });
  }
  return meta;
}
