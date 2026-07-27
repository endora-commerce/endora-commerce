// Overlay resolution — conflict policy (FR-007, SC-005).
//
// Two overlays targeting the SAME core unit MUST NOT resolve by silent
// last-wins. v1 fails the build with a conflict error naming both contenders.
// There is no implicit precedence.

import { OverrideConflictError } from './errors.js';
import { type OverlayContribution, unitKey } from './types.js';

/**
 * Throw {@link OverrideConflictError} if any core unit is targeted by more than
 * one overlay contribution. Returns the input unchanged when conflict-free so
 * it composes in a pipeline. Deterministic: contenders are reported sorted.
 */
export function assertNoConflicts(
  contributions: readonly OverlayContribution[],
): readonly OverlayContribution[] {
  const byUnit = new Map<string, OverlayContribution[]>();
  for (const c of contributions) {
    const key = unitKey(c);
    const bucket = byUnit.get(key);
    if (bucket) bucket.push(c);
    else byUnit.set(key, [c]);
  }
  for (const [key, bucket] of byUnit) {
    if (bucket.length > 1) {
      const contenders = bucket.map((c) => c.overlayPath).sort();
      throw new OverrideConflictError(key, contenders);
    }
  }
  return contributions;
}
