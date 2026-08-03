import {
  resolveProviderCategory,
  type TaxonomyCategoryNode,
  type TaxonomyMappingRow,
} from './taxonomy-mapping-resolver.js';

/**
 * Impact preview — feature 067 / FR-094, research §R26.
 *
 * Runs **the existing pure resolver** (`taxonomy-mapping-resolver.ts`, the one
 * generation uses) twice: once with staleness evaluated against the revision in
 * force, once against the candidate's node set. The difference is the answer.
 * Reusing it is normative, not merely convenient — a second implementation
 * would be a preview that can disagree with what promotion actually does, which
 * is worse than no preview.
 *
 * The number that matters is **coverage**, not the stale-mapping count. "61
 * mappings would go stale" sounds catastrophic, and if every affected category
 * still inherits a value from an ancestor then nothing stops being emitted;
 * reporting the count without the coverage would make an operator refuse a
 * harmless update. Conversely a single stale mapping high in the tree can take
 * hundreds of categories with it, which is why every entry carries the number
 * of descendants that lose their inherited value through it.
 *
 * Pure: plain data in, plain data out, **zero writes** (FR-094).
 */

/** The response caps the list for display; the full set is the post-promotion review list. */
const MAX_AFFECTED = 200;

export interface TaxonomyImpactInput {
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>;
  /** Localized names, for the drawer's rows. */
  categoryNames: ReadonlyMap<string, string>;
  mappings: ReadonlyArray<{ categoryId: string; nodeExternalId: string }>;
  /** Node ids of the revision in force. Empty ⇒ nothing is in force yet. */
  currentNodeIds: ReadonlySet<string>;
  candidateNodeIds: ReadonlySet<string>;
  /** Localized full paths as the CURRENT revision knows them. */
  nodePathsInCurrent: ReadonlyMap<string, string>;
}

export type TaxonomyImpactEffect = 'becomes_stale' | 'becomes_live' | 'loses_coverage';

export interface TaxonomyImpactCategory {
  categoryId: string;
  categoryName: string;
  nodeExternalId: string;
  nodeFullPath: string | null;
  effect: TaxonomyImpactEffect;
  descendantsLosingCoverage: number;
}

export interface TaxonomyRevisionImpact {
  nodeCountCurrent: number;
  nodeCountCandidate: number;
  nodesAdded: number;
  nodesRemoved: number;
  mappings: {
    total: number;
    wouldRemainLive: number;
    wouldBecomeStale: number;
    wouldBecomeLive: number;
  };
  categories: {
    total: number;
    coveredNow: number;
    coveredAfter: number;
    losingCoverage: number;
  };
  affected: TaxonomyImpactCategory[];
  affectedTruncated: boolean;
}

/** `stale` is a property of the node set being evaluated against, nothing else. */
function mappingRowsAgainst(
  mappings: TaxonomyImpactInput['mappings'],
  nodeIds: ReadonlySet<string>,
): Map<string, TaxonomyMappingRow> {
  return new Map(
    mappings.map((mapping) => [
      mapping.categoryId,
      {
        categoryId: mapping.categoryId,
        nodeExternalId: mapping.nodeExternalId,
        // With nothing installed there is no evidence a node is gone, so a
        // mapping is treated as live — "nothing can break" (contract §7.6).
        stale: nodeIds.size > 0 && !nodeIds.has(mapping.nodeExternalId),
      },
    ]),
  );
}

function coveredCategoryIds(
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
  rows: ReadonlyMap<string, TaxonomyMappingRow>,
): Set<string> {
  const covered = new Set<string>();
  for (const categoryId of categoriesById.keys()) {
    // `resolveProviderCategory` and not `resolveEffectiveMapping`: the question
    // here is "would a product in this category still emit a provider
    // category", which is generation's question, and the two functions answer
    // differently on purpose. The admin row view reports a stale explicit
    // mapping as `explicit` so the operator can see the decision they made
    // (FR-085); generation *skips* it and keeps walking up to the nearest live
    // ancestor. Using the admin view here would report a loss where the feed
    // will happily inherit a value — the preview must agree with the file.
    const resolved = resolveProviderCategory({
      productCategoryIds: [categoryId],
      categoriesById,
      mappingsByCategoryId: rows,
    });
    if (resolved.nodeExternalId !== null) covered.add(categoryId);
  }
  return covered;
}

/** Self → parent → … → root, as ids. Mirrors the resolver's own walk. */
function ancestorIds(
  categoryId: string,
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = categoriesById.get(categoryId);
  while (current && !seen.has(current.id) && chain.length < 32) {
    chain.push(current.id);
    seen.add(current.id);
    current = current.parentCategoryId ? categoriesById.get(current.parentCategoryId) : undefined;
  }
  return chain;
}

export function computeTaxonomyRevisionImpact(
  input: TaxonomyImpactInput,
): TaxonomyRevisionImpact {
  const { categoriesById, currentNodeIds, candidateNodeIds } = input;

  const nowRows = mappingRowsAgainst(input.mappings, currentNodeIds);
  const afterRows = mappingRowsAgainst(input.mappings, candidateNodeIds);

  const coveredNow = coveredCategoryIds(categoriesById, nowRows);
  const coveredAfter = coveredCategoryIds(categoriesById, afterRows);
  const losing = [...coveredNow].filter((id) => !coveredAfter.has(id));

  // Which becoming-stale mapping each losing category can be attributed to:
  // the nearest ancestor (including itself) whose mapping goes stale.
  const descendantsByCategory = new Map<string, number>();
  for (const categoryId of losing) {
    for (const ancestorId of ancestorIds(categoryId, categoriesById)) {
      const nowRow = nowRows.get(ancestorId);
      const afterRow = afterRows.get(ancestorId);
      if (!nowRow || nowRow.stale || !afterRow?.stale) continue;
      if (ancestorId === categoryId) break;
      descendantsByCategory.set(ancestorId, (descendantsByCategory.get(ancestorId) ?? 0) + 1);
      break;
    }
  }

  const becomingStale: TaxonomyImpactCategory[] = [];
  const becomingLive: TaxonomyImpactCategory[] = [];
  let wouldBecomeStale = 0;
  let wouldBecomeLive = 0;

  for (const mapping of input.mappings) {
    const nowStale = nowRows.get(mapping.categoryId)?.stale === true;
    const afterStale = afterRows.get(mapping.categoryId)?.stale === true;
    if (!nowStale && afterStale) {
      wouldBecomeStale += 1;
      becomingStale.push({
        categoryId: mapping.categoryId,
        categoryName: input.categoryNames.get(mapping.categoryId) ?? '',
        nodeExternalId: mapping.nodeExternalId,
        // Rendered from the revision in force: after promotion the node may not
        // exist anywhere, and past tense ("was …") is the only honest voice.
        nodeFullPath: input.nodePathsInCurrent.get(mapping.nodeExternalId) ?? null,
        effect: 'becomes_stale',
        descendantsLosingCoverage: descendantsByCategory.get(mapping.categoryId) ?? 0,
      });
    } else if (nowStale && !afterStale) {
      wouldBecomeLive += 1;
      becomingLive.push({
        categoryId: mapping.categoryId,
        categoryName: input.categoryNames.get(mapping.categoryId) ?? '',
        nodeExternalId: mapping.nodeExternalId,
        nodeFullPath: input.nodePathsInCurrent.get(mapping.nodeExternalId) ?? null,
        effect: 'becomes_live',
        descendantsLosingCoverage: 0,
      });
    }
  }

  // Damage first, then recovery (Pareto — the operator's attention belongs on
  // what stops working), and within the damage the rows that take the most
  // categories with them.
  becomingStale.sort(
    (a, b) =>
      b.descendantsLosingCoverage - a.descendantsLosingCoverage ||
      a.categoryName.localeCompare(b.categoryName) ||
      a.categoryId.localeCompare(b.categoryId),
  );
  becomingLive.sort(
    (a, b) => a.categoryName.localeCompare(b.categoryName) || a.categoryId.localeCompare(b.categoryId),
  );

  const affectedAll = [...becomingStale, ...becomingLive];
  const nodesAdded = [...candidateNodeIds].filter((id) => !currentNodeIds.has(id)).length;
  const nodesRemoved = [...currentNodeIds].filter((id) => !candidateNodeIds.has(id)).length;

  return {
    nodeCountCurrent: currentNodeIds.size,
    nodeCountCandidate: candidateNodeIds.size,
    nodesAdded,
    nodesRemoved,
    mappings: {
      total: input.mappings.length,
      wouldRemainLive: input.mappings.filter(
        (mapping) => afterRows.get(mapping.categoryId)?.stale !== true,
      ).length,
      wouldBecomeStale,
      wouldBecomeLive,
    },
    categories: {
      total: categoriesById.size,
      coveredNow: coveredNow.size,
      coveredAfter: coveredAfter.size,
      losingCoverage: losing.length,
    },
    affected: affectedAll.slice(0, MAX_AFFECTED),
    affectedTruncated: affectedAll.length > MAX_AFFECTED,
  };
}
