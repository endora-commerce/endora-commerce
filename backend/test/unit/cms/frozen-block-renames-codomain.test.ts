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

/**
 * Codomain values whose block was **removed** from the platform, by the feature
 * that removed it. The map keeps the entry byte for byte (its digest is pinned
 * and applied migrations read it); stored content under the name degrades to
 * the missing-block placeholder rather than being migrated. Written and
 * reviewed like {@link DECLARED_OUTSIDE_THIS_REPOSITORY}, and held below to be a
 * value of the map that no registered module declares.
 */
const REMOVED_FROM_THE_PLATFORM: ReadonlyMap<string, string> = new Map([
  // Folded into the Carousel (`cms.ContentSlider` with `cms.CarouselImage` slides), FR-041a.
  ['cms.ImageSlider', 'specs/163-page-builder-marketing-pages/'],
]);

describe('FROZEN_BLOCK_RENAMES — the codomain', () => {
  const everyDeclared = new Set(
    REGISTERED_MANIFESTS.flatMap((entry) =>
      ((entry.manifest.blocks ?? []) as BlockDefinition[]).map((block) => block.name),
    ),
  );
  /**
   * Blocks declared **after** the conversion, namespaced from birth: they have
   * no pre-migration name and are no part of the population this file judges.
   * Recorded by name, with the feature that introduced them, so the set cannot
   * grow by accident — every entry is held below to be declared here and to be
   * no value of the map.
   */
  const BORN_NAMESPACED: ReadonlyMap<string, string> = new Map([
    ['comparisons.ComparisonHeader', 'specs/152-compare-pdf-template/'],
    ['comparisons.ComparisonTable', 'specs/152-compare-pdf-template/'],
    ['comparisons.ComparisonShareLink', 'specs/152-compare-pdf-template/'],
    ['document_templates.Heading', 'specs/152-compare-pdf-template/'],
    ['document_templates.Text', 'specs/152-compare-pdf-template/'],
    ['document_templates.Image', 'specs/152-compare-pdf-template/'],
    ['document_templates.Spacer', 'specs/152-compare-pdf-template/'],
    ['document_templates.Divider', 'specs/152-compare-pdf-template/'],
    ['document_templates.PageBreak', 'specs/152-compare-pdf-template/'],
    ['document_templates.ItemsTable', 'specs/153-quote-request-pdf-template/'],
    ['quote_requests.QuoteHeader', 'specs/153-quote-request-pdf-template/'],
    ['quote_requests.QuoteParties', 'specs/153-quote-request-pdf-template/'],
    ['quote_requests.QuoteNotes', 'specs/153-quote-request-pdf-template/'],
    ['quote_requests.QuoteDetails', 'specs/153-quote-request-pdf-template/'],
    ['cms.Section', 'specs/163-page-builder-marketing-pages/'],
    ['cms.SectionGroup', 'specs/163-page-builder-marketing-pages/'],
    ['cms.MediaText', 'specs/163-page-builder-marketing-pages/'],
    ['cms.BackgroundPanel', 'specs/163-page-builder-marketing-pages/'],
    ['cms.CtaCard', 'specs/163-page-builder-marketing-pages/'],
    ['cms.Statement', 'specs/163-page-builder-marketing-pages/'],
    ['cms.CarouselImage', 'specs/163-page-builder-marketing-pages/'],
    ['cms.CarouselSplit', 'specs/163-page-builder-marketing-pages/'],
    ['cms.LinkTile', 'specs/163-page-builder-marketing-pages/'],
    ['cms.DownloadTile', 'specs/163-page-builder-marketing-pages/'],
    ['cms.LinkList', 'specs/163-page-builder-marketing-pages/'],
    ['blog.LatestPosts', 'specs/163-page-builder-marketing-pages/'],
    ['newsletter.Signup', 'specs/163-page-builder-marketing-pages/'],
    ['cms.PageNavigation', 'specs/169-page-builder-contact-form/'],
    ['cms.ContactForm', 'specs/169-page-builder-contact-form/'],
  ]);
  const declared = new Set([...everyDeclared].filter((name) => !BORN_NAMESPACED.has(name)));

  it('records as born namespaced only blocks declared here that the map does not name', () => {
    const codomain = new Set(Object.values(FROZEN_BLOCK_RENAMES));
    for (const name of BORN_NAMESPACED.keys()) {
      expect(everyDeclared.has(name), `${name} is declared by a registered module`).toBe(true);
      expect(codomain.has(name), `${name} is not a value of the map`).toBe(false);
    }
  });

  const registered = new Set(REGISTERED_MANIFESTS.map((entry) => entry.manifest.id));

  it('read a registry with declarations in it', () => {
    // (d) Derived, not a literal: the map's closed domain, less the values whose
    // declarant is recorded as outside this repository and those removed.
    expect(declared.size).toBe(
      Object.keys(FROZEN_BLOCK_RENAMES).length -
        DECLARED_OUTSIDE_THIS_REPOSITORY.size -
        REMOVED_FROM_THE_PLATFORM.size,
    );
  });

  it('every value is declared by a registered module or recorded as declared outside, never both', () => {
    // (a) Exactly one of the two, for every value.
    const neither: string[] = [];
    const both: string[] = [];
    for (const [bare, namespaced] of Object.entries(FROZEN_BLOCK_RENAMES)) {
      const here = declared.has(namespaced);
      const outside = DECLARED_OUTSIDE_THIS_REPOSITORY.has(namespaced);
      if (REMOVED_FROM_THE_PLATFORM.has(namespaced)) continue;
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

  it('records as removed only values of the map that no registered module declares', () => {
    const codomain = new Set(Object.values(FROZEN_BLOCK_RENAMES));
    for (const name of REMOVED_FROM_THE_PLATFORM.keys()) {
      expect(codomain.has(name), `${name} is a value of the map`).toBe(true);
      expect(everyDeclared.has(name), `${name} is declared again`).toBe(false);
      expect(DECLARED_OUTSIDE_THIS_REPOSITORY.has(name), `${name} is also recorded as declared outside`).toBe(false);
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
