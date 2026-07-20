import type { RuleCriterionType } from '@b2b/contracts';
import type { RuleEvaluation } from './application-rule-evaluator.js';

/**
 * Pure priority chain resolver (feature 011 / FR-026, FR-027).
 *
 * Picks one matching list per the deterministic order:
 *   1. List whose rule explicitly names the customer's Organization
 *   2. else explicit Customer Group
 *   3. else explicit Category
 *   4. else explicit Sales Channel
 *   5. else any other matching list
 *
 * Tie-break at every step: most recent `modifiedAt` first, then
 * lexicographically smallest `name`. Tie-break is total — the same input
 * yields the same picked list every run.
 */
export interface PriceListCandidate<TList = unknown> {
  list: TList;
  evaluation: RuleEvaluation;
  modifiedAt: Date;
  name: string;
  /** Marker for the seeded `Default` row — the resolver's terminal fallback. */
  isSystem: boolean;
}

const PRIORITY_ORDER: readonly RuleCriterionType[] = [
  'organization',
  'customerGroup',
  'category',
  'salesChannel',
];

export function pickPriorityChain<TList>(
  candidates: readonly PriceListCandidate<TList>[],
): PriceListCandidate<TList> | null {
  if (candidates.length === 0) return null;
  for (const level of PRIORITY_ORDER) {
    const atLevel = candidates.filter((c) => c.evaluation.explicitOn.has(level));
    if (atLevel.length === 0) continue;
    if (level === 'organization') {
      // Feature 056 — within the organization level, a list naming a NEARER org
      // (smaller nearness rank) outranks one naming a farther ancestor (R5). A
      // flat direct-org match is rank 0, so flat behavior is unchanged.
      const nearest = Math.min(
        ...atLevel.map((c) => c.evaluation.organizationRank ?? Number.POSITIVE_INFINITY),
      );
      const nearestOnly = atLevel.filter(
        (c) => (c.evaluation.organizationRank ?? Number.POSITIVE_INFINITY) === nearest,
      );
      return tieBreak(nearestOnly);
    }
    return tieBreak(atLevel);
  }
  // Step 5 — any other matching list. Default lives here.
  return tieBreak(candidates);
}

export function tieBreak<TList>(
  candidates: readonly PriceListCandidate<TList>[],
): PriceListCandidate<TList> {
  // Most recent modifiedAt first, then lexicographic name.
  const sorted = [...candidates].sort((a, b) => {
    const dt = b.modifiedAt.getTime() - a.modifiedAt.getTime();
    if (dt !== 0) return dt;
    return a.name.localeCompare(b.name);
  });
  return sorted[0]!;
}
