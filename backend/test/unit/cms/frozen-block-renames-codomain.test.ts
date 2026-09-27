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
 *
 * ## A value whose declarant left this repository (`specs/134-paid-module-extraction/` D23 §1)
 *
 * §9's rule is *"every value … is a name **some module's manifest** declares"*,
 * and this file reads only the manifests registered **here**. When a module that
 * declares a codomain value leaves for another repository, the map keeps the
 * entry byte for byte (its digest is pinned and it is the input of applied
 * migrations), and the declaration is proved over there instead: the departed
 * package carries a test that reads `FROZEN_BLOCK_RENAMES` from the published
 * `@endora-commerce/page-builder-core/migration` and asserts its manifest
 * declares every value with its owner segment. The two halves together prove
 * §9 over its whole population; neither alone does.
 *
 * So each such value is a **written, reviewed** entry of
 * {@link DECLARED_OUTSIDE_THIS_REPOSITORY}, never derived by filtering values
 * whose owner is not registered (which would accept a typo in an owner segment
 * without review), and the record is asserted in both directions below.
 */

/** Codomain values whose declaring module left this repository (D23 §1). */
const DECLARED_OUTSIDE_THIS_REPOSITORY: ReadonlyMap<
  string,
  { readonly moduleId: string; readonly packageName: string }
> = new Map([
  ['ksef.InvoiceSection', { moduleId: 'ksef', packageName: '@endora-commerce/mod-ksef' }],
]);

describe('FROZEN_BLOCK_RENAMES — the codomain', () => {
  const declared = new Set(
    REGISTERED_MANIFESTS.flatMap((entry) =>
      ((entry.manifest.blocks ?? []) as BlockDefinition[]).map((block) => block.name),
    ),
  );

  const registered = new Set(REGISTERED_MANIFESTS.map((entry) => entry.manifest.id));

  it('read a registry with declarations in it', () => {
    // (d) Derived, not a literal: the map's closed domain, less the values whose
    // declarant is recorded as outside this repository.
    expect(declared.size).toBe(
      Object.keys(FROZEN_BLOCK_RENAMES).length - DECLARED_OUTSIDE_THIS_REPOSITORY.size,
    );
  });

  it('every value is declared by a registered module or recorded as declared outside, never both', () => {
    // (a) Exactly one of the two, for every value.
    const neither: string[] = [];
    const both: string[] = [];
    for (const [bare, namespaced] of Object.entries(FROZEN_BLOCK_RENAMES)) {
      const here = declared.has(namespaced);
      const outside = DECLARED_OUTSIDE_THIS_REPOSITORY.has(namespaced);
      if (!here && !outside) neither.push(`${bare} -> ${namespaced}`);
      if (here && outside) both.push(`${bare} -> ${namespaced}`);
    }
    expect(neither, 'a value nobody declares').toEqual([]);
    expect(both, 'a value recorded as outside that a registered module declares').toEqual([]);
  });

  it('records only values of the map, each under the module its owner segment names', () => {
    // (b) The record cannot outlive the entry it excuses, or name the wrong owner.
    const codomain = new Set(Object.values(FROZEN_BLOCK_RENAMES));
    for (const [name, declarant] of DECLARED_OUTSIDE_THIS_REPOSITORY) {
      expect(codomain.has(name), `${name} is not a value of the map`).toBe(true);
      expect(name.split('.')[0], `${name}'s owner segment`).toBe(declarant.moduleId);
    }
  });

  it('records only modules this repository does not register', () => {
    // (c) A module that comes back, or a record left behind by a revert, is red.
    for (const [name, declarant] of DECLARED_OUTSIDE_THIS_REPOSITORY) {
      expect(
        registered.has(declarant.moduleId),
        `${declarant.moduleId} (${name}) is registered here`,
      ).toBe(false);
    }
  });

  it('every declared block has exactly one pre-migration name', () => {
    // The other direction, and it is the one that catches a block declared
    // during this feature whose stored name nobody mapped. A block born *after*
    // this feature is namespaced from birth and legitimately has no entry — the
    // map is closed (FR-016) — so this assertion is written as an equality over
    // the blocks the conversion covers rather than as a rule for every future
    // block, and it fails loudly if that set ever moves.
    const codomain = new Set(Object.values(FROZEN_BLOCK_RENAMES));
    expect([...declared].filter((name) => !codomain.has(name))).toEqual([]);
  });
});
