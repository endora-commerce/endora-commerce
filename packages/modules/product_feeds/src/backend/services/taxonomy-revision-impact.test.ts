import { describe, expect, it } from 'vitest';
import { computeTaxonomyRevisionImpact } from './taxonomy-revision-impact.js';
import type { TaxonomyCategoryNode } from './taxonomy-mapping-resolver.js';

/**
 * Feature 067 Phase 11 / T123 — the impact preview (FR-094, research §R26).
 *
 * Built on the **existing** pure resolver `taxonomy-mapping-resolver.ts` — the
 * one generation uses. A second implementation would be a preview that can
 * disagree with what promotion does, which is worse than no preview at all.
 *
 * The property that makes this worth having: a category whose effective value
 * comes from an *ancestor's* mapping loses coverage when that ancestor's node
 * disappears, and so do every one of its descendants. Counting only explicit
 * mappings under-reports the damage by roughly the ratio SC-015 is built on —
 * 95% of items are covered by inheritance from the top two levels.
 */

/** root › tools › (saws, drills › cordless) */
const CATEGORIES: TaxonomyCategoryNode[] = [
  { id: 'root', parentCategoryId: null, sortOrder: 0 },
  { id: 'tools', parentCategoryId: 'root', sortOrder: 0 },
  { id: 'saws', parentCategoryId: 'tools', sortOrder: 0 },
  { id: 'drills', parentCategoryId: 'tools', sortOrder: 1 },
  { id: 'cordless', parentCategoryId: 'drills', sortOrder: 0 },
  { id: 'garden', parentCategoryId: 'root', sortOrder: 1 },
];

function context(input: {
  mappings: Array<{ categoryId: string; nodeExternalId: string }>;
  currentNodes: string[];
  candidateNodes: string[];
}): Parameters<typeof computeTaxonomyRevisionImpact>[0] {
  return {
    categoriesById: new Map(CATEGORIES.map((category) => [category.id, category])),
    categoryNames: new Map(CATEGORIES.map((category) => [category.id, category.id])),
    mappings: input.mappings,
    currentNodeIds: new Set(input.currentNodes),
    candidateNodeIds: new Set(input.candidateNodes),
    nodePathsInCurrent: new Map(input.currentNodes.map((id) => [id, `Path > ${id}`])),
  };
}

describe('computeTaxonomyRevisionImpact', () => {
  it('reports a revision that changes nothing as changing nothing', () => {
    const impact = computeTaxonomyRevisionImpact(
      context({
        mappings: [{ categoryId: 'tools', nodeExternalId: 'n1' }],
        currentNodes: ['n1', 'n2'],
        candidateNodes: ['n1', 'n2'],
      }),
    );
    expect(impact.mappings).toMatchObject({ total: 1, wouldBecomeStale: 0, wouldBecomeLive: 0 });
    expect(impact.categories.losingCoverage).toBe(0);
    expect(impact.categories.coveredNow).toBe(impact.categories.coveredAfter);
    expect(impact.affected).toEqual([]);
  });

  it('counts categories that lose coverage THROUGH INHERITANCE, with the descendant total', () => {
    // Only `tools` is mapped. `saws`, `drills` and `cordless` inherit from it.
    const impact = computeTaxonomyRevisionImpact(
      context({
        mappings: [{ categoryId: 'tools', nodeExternalId: 'n1' }],
        currentNodes: ['n1'],
        candidateNodes: ['n9'],
      }),
    );

    expect(impact.mappings.wouldBecomeStale).toBe(1);
    // tools + saws + drills + cordless
    expect(impact.categories.losingCoverage).toBe(4);
    expect(impact.categories.coveredNow).toBe(4);
    expect(impact.categories.coveredAfter).toBe(0);

    const entry = impact.affected.find((row) => row.categoryId === 'tools');
    expect(entry).toMatchObject({ effect: 'becomes_stale', nodeExternalId: 'n1' });
    // The three descendants that inherited through it.
    expect(entry?.descendantsLosingCoverage).toBe(3);
    // The path is rendered from the CURRENT revision, which is precisely why
    // FR-097 refuses to purge the revision that still holds the label.
    expect(entry?.nodeFullPath).toBe('Path > n1');
  });

  it('separates "mappings go stale" from "coverage is lost" — the case a count-only design gets wrong', () => {
    // `root` and `tools` are both mapped; `tools`' node vanishes, so `tools`
    // and its subtree fall back to `root`'s mapping. A mapping goes stale and
    // NOTHING stops being emitted.
    const impact = computeTaxonomyRevisionImpact(
      context({
        mappings: [
          { categoryId: 'root', nodeExternalId: 'n0' },
          { categoryId: 'tools', nodeExternalId: 'n1' },
        ],
        currentNodes: ['n0', 'n1'],
        candidateNodes: ['n0'],
      }),
    );

    expect(impact.mappings.wouldBecomeStale).toBe(1);
    expect(impact.categories.losingCoverage).toBe(0);
    expect(impact.categories.coveredAfter).toBe(impact.categories.coveredNow);
    expect(impact.affected.find((row) => row.categoryId === 'tools')?.descendantsLosingCoverage).toBe(
      0,
    );
  });

  it('reports mappings that come back to life — a revision can restore a node', () => {
    const impact = computeTaxonomyRevisionImpact(
      context({
        mappings: [{ categoryId: 'tools', nodeExternalId: 'n7' }],
        currentNodes: ['n1'],
        candidateNodes: ['n1', 'n7'],
      }),
    );

    expect(impact.mappings.wouldBecomeLive).toBe(1);
    expect(impact.mappings.wouldBecomeStale).toBe(0);
    expect(impact.categories.coveredNow).toBe(0);
    expect(impact.categories.coveredAfter).toBe(4);
    expect(impact.affected[0]).toMatchObject({ categoryId: 'tools', effect: 'becomes_live' });
  });

  it('reports node counts, added and removed', () => {
    const impact = computeTaxonomyRevisionImpact(
      context({ mappings: [], currentNodes: ['a', 'b', 'c'], candidateNodes: ['b', 'c', 'd', 'e'] }),
    );
    expect(impact.nodeCountCurrent).toBe(3);
    expect(impact.nodeCountCandidate).toBe(4);
    expect(impact.nodesRemoved).toBe(1);
    expect(impact.nodesAdded).toBe(2);
  });

  it('treats "no revision in force" as "nothing can break"', () => {
    const impact = computeTaxonomyRevisionImpact(
      context({
        mappings: [{ categoryId: 'tools', nodeExternalId: 'n1' }],
        currentNodes: [],
        candidateNodes: ['n1'],
      }),
    );
    expect(impact.categories.losingCoverage).toBe(0);
    expect(impact.mappings.wouldBecomeStale).toBe(0);
  });

  it('caps the affected list at 200 and says so', () => {
    const many = Array.from({ length: 260 }, (_, index) => ({
      categoryId: `c${index}`,
      nodeExternalId: `n${index}`,
    }));
    const categoriesById = new Map(
      many.map((row) => [
        row.categoryId,
        { id: row.categoryId, parentCategoryId: null, sortOrder: 0 },
      ]),
    );
    const impact = computeTaxonomyRevisionImpact({
      categoriesById,
      categoryNames: new Map(many.map((row) => [row.categoryId, row.categoryId])),
      mappings: many,
      currentNodeIds: new Set(many.map((row) => row.nodeExternalId)),
      candidateNodeIds: new Set(['n0']),
      nodePathsInCurrent: new Map(many.map((row) => [row.nodeExternalId, row.nodeExternalId])),
    });

    expect(impact.mappings.wouldBecomeStale).toBe(259);
    expect(impact.affected).toHaveLength(200);
    expect(impact.affectedTruncated).toBe(true);
  });

  it('performs no writes — it takes plain data and returns plain data', () => {
    const input = context({
      mappings: [{ categoryId: 'tools', nodeExternalId: 'n1' }],
      currentNodes: ['n1'],
      candidateNodes: [],
    });
    const before = JSON.stringify([...input.mappings]);
    computeTaxonomyRevisionImpact(input);
    expect(JSON.stringify([...input.mappings])).toBe(before);
  });
});
