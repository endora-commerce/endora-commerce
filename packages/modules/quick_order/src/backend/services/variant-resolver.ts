/**
 * Variant resolution for quick-order imports (feature 039, FR-003).
 *
 * Given the variants of a parent product and the attribute values supplied
 * on an import row (the columns beyond `sku` / `quantity`), decide which
 * concrete variant the row refers to. Matching is exact-after-normalize
 * against the parent's variant-axis attribute keys
 * (`ProductVariant.variantAttributeValues`).
 *
 * Pure function — no DB access. The caller fetches the variants and feeds
 * them in, which keeps the matching rule unit-testable.
 */

export interface VariantLike {
  id: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
}

export type VariantResolution =
  | { kind: 'no_variants' }
  | { kind: 'resolved'; variantId: string; variantSku: string }
  | { kind: 'not_resolved' }
  | { kind: 'ambiguous' };

/** Lower-case + trim for case-insensitive axis comparison. */
function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve a variant from the row's attribute columns.
 *
 * - No variants on the product → `no_variants` (caller adds the base product;
 *   extra attribute columns are ignored, per the spec edge case).
 * - Exactly one variant matches every supplied (key, value) → `resolved`.
 * - Zero matches → `not_resolved`.
 * - More than one match (including the case where no axis values were
 *   supplied for a multi-variant product) → `ambiguous`.
 */
export function resolveVariant(
  variants: VariantLike[],
  requestedAttributes: Record<string, string>,
): VariantResolution {
  if (variants.length === 0) return { kind: 'no_variants' };

  const requested = Object.entries(requestedAttributes)
    .map(([key, value]) => [key.trim().toLowerCase(), normalize(value)] as const)
    .filter(([, value]) => value.length > 0);

  const matches = variants.filter((variant) => {
    const axes = new Map(
      Object.entries(variant.variantAttributeValues).map(
        ([key, value]) => [key.trim().toLowerCase(), normalize(value)] as const,
      ),
    );
    return requested.every(([key, value]) => axes.get(key) === value);
  });

  if (matches.length === 1) {
    const [only] = matches;
    return { kind: 'resolved', variantId: only!.id, variantSku: only!.sku };
  }
  if (matches.length === 0) return { kind: 'not_resolved' };
  return { kind: 'ambiguous' };
}
