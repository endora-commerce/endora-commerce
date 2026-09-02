import type { ThresholdLevel } from './threshold-resolver.js';

/**
 * Display-band resolver — pure function (feature 010 / FR-017 to FR-020).
 *
 * Maps cumulative on-hand + thresholds to one of:
 *   `high` | `medium` | `low` | `out_of_stock` | `available`
 *
 * `available` is the special bucket returned when `manageStock = false`
 * — the storefront treats the product as always available regardless
 * of stock numbers (FR-022).
 */
export type DisplayBand = 'high' | 'medium' | 'low' | 'out_of_stock' | 'available';

export interface ResolveDisplayBandInput {
  manageStock: boolean;
  cumulativeOnHand: number;
  thresholds: ThresholdLevel;
}

export function resolveDisplayBand(input: ResolveDisplayBandInput): DisplayBand {
  if (!input.manageStock) return 'available';

  const onHand = Math.max(0, input.cumulativeOnHand);
  if (onHand <= 0) return 'out_of_stock';

  const high = input.thresholds.high;
  if (high !== null && high !== undefined && onHand >= high) return 'high';

  const medium = input.thresholds.medium;
  if (medium !== null && medium !== undefined && onHand >= medium) return 'medium';

  const low = input.thresholds.low;
  if (low !== null && low !== undefined && onHand >= low) return 'low';

  // No applicable threshold (or below `low`) but on-hand > 0: treat
  // as low. The display-mode `available_or_not` collapses this to
  // `available` at render time.
  return 'low';
}
