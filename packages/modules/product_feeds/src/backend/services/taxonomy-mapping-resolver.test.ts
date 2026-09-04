import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveMapping,
  resolveProviderCategory,
  type TaxonomyCategoryNode,
  type TaxonomyMappingRow,
} from './taxonomy-mapping-resolver.js';

/**
 * Feature 067 / T049 — provider-category resolution (FR-080, FR-084, FR-085).
 *
 * Pure by construction: shop categories and mapping rows in, one node id out.
 * That is what makes FR-084's determinism — "two runs over an unchanged
 * catalogue emit the same value" — directly testable rather than a hope.
 *
 * Category tree used throughout:
 *
 *   root (sort 0)
 *   ├── home (sort 0)
 *   │   └── chairs (sort 0)
 *   │       └── officeChairs (sort 0)
 *   └── garden (sort 1)
 *       └── furniture (sort 0)
 */

const CATEGORIES: TaxonomyCategoryNode[] = [
  { id: 'root', parentCategoryId: null, sortOrder: 0 },
  { id: 'home', parentCategoryId: 'root', sortOrder: 0 },
  { id: 'chairs', parentCategoryId: 'home', sortOrder: 0 },
  { id: 'officeChairs', parentCategoryId: 'chairs', sortOrder: 0 },
  { id: 'garden', parentCategoryId: 'root', sortOrder: 1 },
  { id: 'furniture', parentCategoryId: 'garden', sortOrder: 0 },
];

const categoriesById = new Map(CATEGORIES.map((c) => [c.id, c]));

function mappings(rows: TaxonomyMappingRow[]): Map<string, TaxonomyMappingRow> {
  return new Map(rows.map((r) => [r.categoryId, r]));
}

describe('resolveProviderCategory — inheritance (FR-080)', () => {
  it('resolves a category that carries its own mapping', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['chairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'chairs', nodeExternalId: '6362', stale: false },
      ]),
    });
    expect(out.nodeExternalId).toBe('6362');
    expect(out.missReason).toBeNull();
    expect(out.mappedCategoryId).toBe('chairs');
  });

  it('inherits from the nearest mapped ancestor', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['officeChairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'home', nodeExternalId: '536', stale: false },
        { categoryId: 'chairs', nodeExternalId: '6362', stale: false },
      ]),
    });
    // `chairs` is nearer than `home`.
    expect(out.nodeExternalId).toBe('6362');
    expect(out.mappedCategoryId).toBe('chairs');
  });

  it('an explicit mapping overrides the inherited one', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['officeChairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'home', nodeExternalId: '536', stale: false },
        { categoryId: 'officeChairs', nodeExternalId: '9999', stale: false },
      ]),
    });
    expect(out.nodeExternalId).toBe('9999');
    expect(out.mappedCategoryId).toBe('officeChairs');
  });

  it('reports unmapped when neither the category nor any ancestor is mapped', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['officeChairs'],
      categoriesById,
      mappingsByCategoryId: mappings([]),
    });
    expect(out.nodeExternalId).toBeNull();
    expect(out.missReason).toBe('unmapped_provider_category');
  });

  it('reports unmapped for a product with no categories at all', () => {
    const out = resolveProviderCategory({
      productCategoryIds: [],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'root', nodeExternalId: '1', stale: false },
      ]),
    });
    expect(out.nodeExternalId).toBeNull();
    expect(out.missReason).toBe('unmapped_provider_category');
  });

  it('tolerates a category id the tree does not contain', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['ghost'],
      categoriesById,
      mappingsByCategoryId: mappings([]),
    });
    expect(out.nodeExternalId).toBeNull();
    expect(out.missReason).toBe('unmapped_provider_category');
  });
});

describe('resolveProviderCategory — deepest category wins (FR-084)', () => {
  it('prefers the branch whose originating category is deepest', () => {
    const out = resolveProviderCategory({
      // The product sits in a shallow category and a deep one.
      productCategoryIds: ['garden', 'officeChairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'garden', nodeExternalId: 'GARDEN', stale: false },
        { categoryId: 'home', nodeExternalId: 'HOME', stale: false },
      ]),
    });
    // `officeChairs` (depth 3) beats `garden` (depth 1), even though its own
    // mapping was found two levels up.
    expect(out.nodeExternalId).toBe('HOME');
    expect(out.originCategoryId).toBe('officeChairs');
  });

  it('breaks a depth tie on (sortOrder asc, id asc), deterministically', () => {
    const tied: TaxonomyCategoryNode[] = [
      { id: 'root', parentCategoryId: null, sortOrder: 0 },
      { id: 'bbb', parentCategoryId: 'root', sortOrder: 5 },
      { id: 'aaa', parentCategoryId: 'root', sortOrder: 5 },
      { id: 'ccc', parentCategoryId: 'root', sortOrder: 1 },
    ];
    const byId = new Map(tied.map((c) => [c.id, c]));
    const rows = mappings([
      { categoryId: 'aaa', nodeExternalId: 'A', stale: false },
      { categoryId: 'bbb', nodeExternalId: 'B', stale: false },
      { categoryId: 'ccc', nodeExternalId: 'C', stale: false },
    ]);

    // `ccc` has the lowest sortOrder, so it wins regardless of input order.
    for (const order of [
      ['aaa', 'bbb', 'ccc'],
      ['ccc', 'bbb', 'aaa'],
      ['bbb', 'ccc', 'aaa'],
    ]) {
      const out = resolveProviderCategory({
        productCategoryIds: order,
        categoriesById: byId,
        mappingsByCategoryId: rows,
      });
      expect(out.nodeExternalId).toBe('C');
    }

    // With sortOrder equal, the id decides — and it decides the same way every
    // time, which is the property FR-084 actually asks for.
    const noC = mappings([
      { categoryId: 'aaa', nodeExternalId: 'A', stale: false },
      { categoryId: 'bbb', nodeExternalId: 'B', stale: false },
    ]);
    for (const order of [
      ['aaa', 'bbb'],
      ['bbb', 'aaa'],
    ]) {
      const out = resolveProviderCategory({
        productCategoryIds: order,
        categoriesById: byId,
        mappingsByCategoryId: noC,
      });
      expect(out.nodeExternalId).toBe('A');
    }
  });

  it('is stable across repeated invocations', () => {
    const input = {
      productCategoryIds: ['officeChairs', 'furniture', 'garden'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'home', nodeExternalId: 'HOME', stale: false },
        { categoryId: 'furniture', nodeExternalId: 'FURN', stale: false },
      ]),
    };
    const results = Array.from({ length: 25 }, () => resolveProviderCategory(input));
    expect(new Set(results.map((r) => r.nodeExternalId)).size).toBe(1);
  });
});

describe('resolveProviderCategory — stale mappings (FR-085)', () => {
  it('treats a stale mapping as no mapping, with its own distinct reason', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['chairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'chairs', nodeExternalId: 'GONE', stale: true },
      ]),
    });
    expect(out.nodeExternalId).toBeNull();
    // Distinguishable from "never mapped" — run diagnostics must separate them.
    expect(out.missReason).toBe('stale_provider_category_mapping');
  });

  it('keeps walking past a stale mapping to a live ancestor', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['officeChairs'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'chairs', nodeExternalId: 'GONE', stale: true },
        { categoryId: 'home', nodeExternalId: 'HOME', stale: false },
      ]),
    });
    expect(out.nodeExternalId).toBe('HOME');
    expect(out.missReason).toBeNull();
  });

  it('reports unmapped, not stale, when no stale row was involved at all', () => {
    const out = resolveProviderCategory({
      productCategoryIds: ['furniture'],
      categoriesById,
      mappingsByCategoryId: mappings([
        { categoryId: 'chairs', nodeExternalId: 'GONE', stale: true },
      ]),
    });
    expect(out.missReason).toBe('unmapped_provider_category');
  });
});

describe('resolveEffectiveMapping — the admin row (FR-080)', () => {
  it('reports an explicit mapping as explicit', () => {
    const row = resolveEffectiveMapping('chairs', categoriesById, mappings([
      { categoryId: 'chairs', nodeExternalId: '6362', stale: false },
    ]));
    expect(row).toEqual({
      categoryId: 'chairs',
      nodeExternalId: '6362',
      origin: 'explicit',
      inheritedFromCategoryId: null,
      stale: false,
    });
  });

  it('reports an inherited mapping with the ancestor it came from', () => {
    const row = resolveEffectiveMapping('officeChairs', categoriesById, mappings([
      { categoryId: 'home', nodeExternalId: '536', stale: false },
    ]));
    expect(row.origin).toBe('inherited');
    expect(row.nodeExternalId).toBe('536');
    expect(row.inheritedFromCategoryId).toBe('home');
  });

  it('reports none when nothing in the chain is mapped', () => {
    const row = resolveEffectiveMapping('furniture', categoriesById, mappings([]));
    expect(row.origin).toBe('none');
    expect(row.nodeExternalId).toBeNull();
    expect(row.inheritedFromCategoryId).toBeNull();
  });

  it('keeps a stale explicit row visible AS explicit, flagged stale', () => {
    // FR-085: the row is kept, never rewritten. The admin must show the
    // operator what they chose plus the fact that it no longer resolves —
    // silently redrawing it as "inherited" would hide the decision they need
    // to revisit.
    const row = resolveEffectiveMapping('chairs', categoriesById, mappings([
      { categoryId: 'chairs', nodeExternalId: 'GONE', stale: true },
    ]));
    expect(row.origin).toBe('explicit');
    expect(row.nodeExternalId).toBe('GONE');
    expect(row.stale).toBe(true);
  });

  it('inherits past a stale ancestor row', () => {
    const row = resolveEffectiveMapping('officeChairs', categoriesById, mappings([
      { categoryId: 'chairs', nodeExternalId: 'GONE', stale: true },
      { categoryId: 'home', nodeExternalId: 'HOME', stale: false },
    ]));
    expect(row.origin).toBe('inherited');
    expect(row.nodeExternalId).toBe('HOME');
    expect(row.inheritedFromCategoryId).toBe('home');
  });
});
