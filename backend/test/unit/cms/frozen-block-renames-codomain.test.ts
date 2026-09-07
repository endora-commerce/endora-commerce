import { describe, expect, it } from 'vitest';
import type { BlockDefinition } from '@endora-commerce/contracts';
import { FROZEN_BLOCK_RENAMES } from '@endora-commerce/page-builder-core/migration';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Feature 096, T412 assertion 1 — the codomain
 * (`contracts/block-name-check.md` §9).
 *
 * **It is asserted here rather than beside the other three**, and the reason is
 * structural rather than a preference: the assertion needs the manifests, and
 * every module package depends on `@endora-commerce/page-builder-core`. A test
 * in that package that imported `@endora-commerce/mod-cms` would put a cycle in
 * the dependency graph to answer a question the backend can already ask over
 * `REGISTERED_MANIFESTS`, which is the population every module walk in this
 * repository reads. The other three assertions — frozen digest, bijection,
 * closed domain — are properties of the map alone and stay in
 * `packages/page-builder-core/src/migration/frozen-block-renames.test.ts`.
 *
 * **What it buys**: a map pointing at a name nobody declares produces dead names
 * on every client's database, and a migration is the one place in this
 * repository where that cannot be corrected afterwards.
 */
describe('FROZEN_BLOCK_RENAMES — the codomain', () => {
  const declared = new Set(
    REGISTERED_MANIFESTS.flatMap((entry) =>
      ((entry.manifest.blocks ?? []) as BlockDefinition[]).map((block) => block.name),
    ),
  );

  it('read a registry with declarations in it', () => {
    expect(declared.size).toBe(74);
  });

  it('every value is a name a registered module declares', () => {
    const orphans = Object.entries(FROZEN_BLOCK_RENAMES)
      .filter(([, namespaced]) => !declared.has(namespaced))
      .map(([bare, namespaced]) => `${bare} -> ${namespaced}`);
    expect(orphans).toEqual([]);
  });

  it('every declared block has exactly one pre-migration name', () => {
    // The other direction, and it is the one that catches a block declared
    // during this feature whose stored name nobody mapped. A block born *after*
    // this feature is namespaced from birth and legitimately has no entry — the
    // map is closed (FR-016) — so this assertion is written as an equality over
    // the 74 the conversion covers rather than as a rule for every future
    // block, and it fails loudly if that set ever moves.
    const codomain = new Set(Object.values(FROZEN_BLOCK_RENAMES));
    expect([...declared].filter((name) => !codomain.has(name))).toEqual([]);
  });
});
