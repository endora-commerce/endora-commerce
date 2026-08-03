/**
 * Provider-category resolution — feature 067 / FR-080, FR-083–FR-085,
 * data-model §10.1.
 *
 * Pure by construction: the shop's category tree and the mapping rows go in, a
 * single provider node id comes out. Every database read happens in the caller,
 * which is what lets the generation pipeline resolve 100 000 items without a
 * query per product and what makes FR-084's determinism directly testable.
 *
 * Two rules that look similar but are deliberately different:
 *
 *  - **At generation time** a `stale` mapping counts as *no* mapping, and the
 *    caller records the distinct reason `stale_provider_category_mapping` so
 *    run diagnostics separate "never mapped" from "the node vanished".
 *  - **On the admin surface** the same stale row is still shown as `explicit`,
 *    flagged. FR-085 keeps the row precisely so the operator can revisit the
 *    decision; quietly redrawing it as "inherited" would hide it.
 */

export interface TaxonomyCategoryNode {
  id: string;
  parentCategoryId: string | null;
  sortOrder: number;
}

export interface TaxonomyMappingRow {
  categoryId: string;
  nodeExternalId: string;
  /** The mapped node is absent from the installed revision (FR-085). */
  stale: boolean;
}

export type ProviderCategoryMissReason =
  | 'unmapped_provider_category'
  | 'stale_provider_category_mapping';

export interface ResolvedProviderCategory {
  nodeExternalId: string | null;
  /** Null when a node resolved; otherwise why it did not. */
  missReason: ProviderCategoryMissReason | null;
  /** The product category whose branch supplied the winning node. */
  originCategoryId: string | null;
  /** The category actually carrying the mapping row (self or an ancestor). */
  mappedCategoryId: string | null;
}

/** Guards a malformed tree (a cycle would otherwise spin forever). */
const MAX_TREE_DEPTH = 32;

/** Self → parent → … → root, as ids. Stops on a missing node or a cycle. */
function ancestryOf(
  categoryId: string,
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
): TaxonomyCategoryNode[] {
  const chain: TaxonomyCategoryNode[] = [];
  const seen = new Set<string>();
  let current = categoriesById.get(categoryId);
  while (current && !seen.has(current.id) && chain.length < MAX_TREE_DEPTH) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentCategoryId
      ? categoriesById.get(current.parentCategoryId)
      : undefined;
  }
  return chain;
}

/** Distance from the root; a root category has depth 0. */
function depthOf(
  categoryId: string,
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
): number {
  return Math.max(0, ancestryOf(categoryId, categoriesById).length - 1);
}

interface BranchCandidate {
  originCategoryId: string;
  originDepth: number;
  originSortOrder: number;
  mappedCategoryId: string;
  nodeExternalId: string;
}

export function resolveProviderCategory(input: {
  productCategoryIds: readonly string[];
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>;
  mappingsByCategoryId: ReadonlyMap<string, TaxonomyMappingRow>;
}): ResolvedProviderCategory {
  const { productCategoryIds, categoriesById, mappingsByCategoryId } = input;

  const candidates: BranchCandidate[] = [];
  let sawStale = false;

  for (const productCategoryId of productCategoryIds) {
    const chain = ancestryOf(productCategoryId, categoriesById);
    if (chain.length === 0) continue;
    const origin = chain[0]!;

    for (const link of chain) {
      const mapping = mappingsByCategoryId.get(link.id);
      if (!mapping) continue;
      if (mapping.stale) {
        // Not a candidate — but remembered, so the caller can tell the operator
        // "your mapping went stale" instead of "you never mapped this".
        sawStale = true;
        continue;
      }
      candidates.push({
        originCategoryId: origin.id,
        originDepth: depthOf(origin.id, categoriesById),
        originSortOrder: origin.sortOrder,
        mappedCategoryId: link.id,
        nodeExternalId: mapping.nodeExternalId,
      });
      break;
    }
  }

  if (candidates.length === 0) {
    return {
      nodeExternalId: null,
      missReason: sawStale
        ? 'stale_provider_category_mapping'
        : 'unmapped_provider_category',
      originCategoryId: null,
      mappedCategoryId: null,
    };
  }

  // Deepest originating category wins; ties break on (sort_order asc, id asc).
  // The final `id` comparison is what makes the outcome independent of the
  // order the caller happened to read the product's categories in (FR-084).
  candidates.sort(
    (a, b) =>
      b.originDepth - a.originDepth ||
      a.originSortOrder - b.originSortOrder ||
      a.originCategoryId.localeCompare(b.originCategoryId),
  );

  const winner = candidates[0]!;
  return {
    nodeExternalId: winner.nodeExternalId,
    missReason: null,
    originCategoryId: winner.originCategoryId,
    mappedCategoryId: winner.mappedCategoryId,
  };
}

export type MappingOrigin = 'explicit' | 'inherited' | 'none';

export interface EffectiveCategoryMapping {
  categoryId: string;
  nodeExternalId: string | null;
  origin: MappingOrigin;
  /** For `inherited`, the ancestor the value came from. */
  inheritedFromCategoryId: string | null;
  stale: boolean;
}

/**
 * The admin's per-category row (contract admin-taxonomy-mappings.md §4).
 *
 * One row per shop category — mapped or not — so the surface can render the
 * whole tree with its effective values in one pass.
 */
export function resolveEffectiveMapping(
  categoryId: string,
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
  mappingsByCategoryId: ReadonlyMap<string, TaxonomyMappingRow>,
): EffectiveCategoryMapping {
  const own = mappingsByCategoryId.get(categoryId);
  if (own) {
    return {
      categoryId,
      nodeExternalId: own.nodeExternalId,
      origin: 'explicit',
      inheritedFromCategoryId: null,
      stale: own.stale,
    };
  }

  // Skip self (handled above) and walk up for the nearest live ancestor row.
  for (const link of ancestryOf(categoryId, categoriesById).slice(1)) {
    const mapping = mappingsByCategoryId.get(link.id);
    if (!mapping || mapping.stale) continue;
    return {
      categoryId,
      nodeExternalId: mapping.nodeExternalId,
      origin: 'inherited',
      inheritedFromCategoryId: link.id,
      stale: false,
    };
  }

  return {
    categoryId,
    nodeExternalId: null,
    origin: 'none',
    inheritedFromCategoryId: null,
    stale: false,
  };
}
