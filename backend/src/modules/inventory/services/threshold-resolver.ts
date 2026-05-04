/**
 * Threshold resolver — pure function (feature 010 / FR-017).
 *
 * Resolves the `(high, medium, low)` threshold triple from the
 * priority chain Product → Category → Global. Each threshold key is
 * resolved independently; a missing value at one level falls through
 * to the next, so a product can override only `low` while inheriting
 * `high` and `medium` from the global scope.
 */

export interface ThresholdLevel {
  high: number | null;
  medium: number | null;
  low: number | null;
}

export interface ResolveThresholdsInput {
  productThresholds?: ThresholdLevel | null;
  /** Each category in the product's category list, ordered by relevance.
   *  The resolver returns the first defined value walking the array. */
  categoryThresholds?: ThresholdLevel[];
  globalThresholds: ThresholdLevel;
}

export function resolveThresholds(input: ResolveThresholdsInput): ThresholdLevel {
  const product = input.productThresholds ?? null;
  const categories = input.categoryThresholds ?? [];
  const global = input.globalThresholds;

  return {
    high: pick('high', product, categories, global),
    medium: pick('medium', product, categories, global),
    low: pick('low', product, categories, global),
  };
}

function pick(
  key: 'high' | 'medium' | 'low',
  product: ThresholdLevel | null,
  categories: ThresholdLevel[],
  global: ThresholdLevel,
): number | null {
  if (product && product[key] !== null && product[key] !== undefined) return product[key];
  for (const cat of categories) {
    if (cat[key] !== null && cat[key] !== undefined) return cat[key];
  }
  return global[key];
}
