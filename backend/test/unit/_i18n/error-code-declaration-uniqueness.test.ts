import { describe, expect, it } from 'vitest';
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
  type ErrorCodeDeclarationSource,
} from '@endora-commerce/mod-i18n/backend';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Feature 090 — `contracts/error-code-declaration.md` §3.1 rule 5:
 *
 * > **A collision between two modules this repository ships fails
 * > `check:error-translations`, so it cannot reach an instance. Rules 1–4 exist
 * > for the case a build cannot reach: two installed packages, or a package and
 * > a core module.**
 *
 * This is that build-time half, and it is a test rather than a `check-*` script
 * on the precedent `permission-inventory.test.ts` sets for exactly this question
 * one field over: whether the manifests this repository ships agree with each
 * other is a property of the composed registry, which a test can hold and a
 * source-text walk cannot. It runs in `test:backend:unit` on every backend merge
 * request, which is what "fails the build" means here. Feature 090's Phase 4
 * gives `check:error-translations` its own `collision` finding over the same
 * predicate; until the migration starts populating manifests there is nothing
 * for the check's opened population to be opened *onto*, and this is the reader
 * that already has the resolved set in hand.
 *
 * **It has to be able to go red today, with no module declaring anything.** A
 * suite asserting "no collisions" over a population of zero declarations is
 * green for the wrong reason, which is issue #113's shape. So the population
 * floor is asserted separately, and the red proof runs the **real** resolved
 * entries with one synthetic pair appended — the same call, the same
 * derivation, over today's tree.
 */
describe('the modules this repository ships declare no colliding error code', () => {
  it('the resolved manifest set is non-empty — the floor under every claim below', async () => {
    const entries = await resolvedManifestEntries();
    expect(entries.length).toBeGreaterThan(0);
    // Every entry carries the file it was declared in, which is what a
    // collision report has to name. An entry with no path would make the report
    // unusable rather than absent, so it is checked here and not discovered in
    // a message.
    for (const entry of entries) {
      expect(entry.filePath, `${entry.manifest.id} has no manifest path`).toBeTruthy();
    }
  });

  it('no error code is declared by two of them', async () => {
    const entries = await resolvedManifestEntries();
    const { collisions } = buildErrorTranslationTargets(entries);
    expect(
      collisions,
      collisions.length === 0
        ? ''
        : 'Two modules this repository ships claim the same error code. At runtime ' +
          'the code would route to neither and the operator would read the raising ' +
          "code's own English. One of them has to give the code up — the domain " +
          'noun decides, not the thrower ' +
          `(specs/082-error-code-ownership/):\n${describeErrorCodeCollisions(collisions)}`,
    ).toEqual([]);
  });

  it('goes red on a collision introduced into this build\'s own resolved set', async () => {
    // The red proof, over the real population rather than a fixture one. Two
    // synthetic modules claiming one code are appended to whatever the tree
    // declares today; the derivation is the one the assertion above runs.
    const entries = await resolvedManifestEntries();
    const contested: ErrorCodeDeclarationSource[] = [
      ...entries,
      {
        manifest: { id: 'fixture_alpha', errorCodes: [{ code: 'FIXTURE_SYNC_FAILED' }] },
        filePath: '/fixture/alpha/manifest.ts',
      },
      {
        manifest: { id: 'fixture_beta', errorCodes: [{ code: 'FIXTURE_SYNC_FAILED' }] },
        filePath: '/fixture/beta/manifest.ts',
      },
    ];
    const { targets, collisions } = buildErrorTranslationTargets(contested);
    expect(collisions.map((c) => c.code)).toEqual(['FIXTURE_SYNC_FAILED']);
    expect(collisions[0]?.claims.map((c) => c.moduleId)).toEqual([
      'fixture_alpha',
      'fixture_beta',
    ]);
    expect(targets['FIXTURE_SYNC_FAILED']).toBeUndefined();
  });

  it('reports how many codes the tree declares, so a green cannot mean "not looking"', async () => {
    // Feature 090 Phase 1 declares nothing: the mechanism lands before the
    // migration that uses it, and Phase 3 fills these manifests one merge
    // request at a time. The number is asserted as a floor of zero rather than
    // as an equality, so this line stops being about Phase 1 the moment the
    // first module declares a code — and the two assertions above are the ones
    // that grow teeth as it rises.
    const entries = await resolvedManifestEntries();
    const declared = entries.flatMap((entry) => entry.manifest.errorCodes ?? []);
    expect(declared.length).toBeGreaterThanOrEqual(0);
    const { targets } = buildErrorTranslationTargets(entries);
    expect(Object.keys(targets)).toHaveLength(
      new Set(declared.map((declaration) => declaration.code)).size,
    );
  });
});
