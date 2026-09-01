import { afterEach, describe, expect, it } from 'vitest';

import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';

import {
  checkBundlePairing,
  declaredBundleDirectories,
  type BundlePairingFindingKind,
  type BundlePairingResult,
} from '../../../scripts/check-bundle-pairing.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';
import {
  createBundlePairingFixture,
  validBundle,
  type BundlePairingFixture,
  type FixtureModule,
} from '../../helpers/bundle-pairing-fixture.js';

/**
 * Companion test for `check-bundle-pairing`
 * (`specs/094-translation-boundary/contracts/bundle-pairing-ratchet.md`).
 *
 * The check lands at **zero violations**, which is what makes this file carry
 * the whole weight of the claim: nothing in the tree exercises it, so a
 * narrowing that stopped it seeing a shape would be invisible in every pipeline
 * until the day the shape arrived. Every proof therefore enters over a **module
 * tree on disk** plus the records a generated index produces over it — the pair
 * a real run reads — and asserts the finding's *kind*, so no signal goes blind
 * behind another's red.
 *
 * The two discriminations matter as much as the reds and are asserted beside
 * them: a module shipping both bundles is clean, and a module shipping
 * **neither** is clean too. The second is what proves § 1 was implemented as a
 * conditional rather than as "every module ships `pl.json`" — a universal would
 * make seven legitimate modules a finding each and would be repaired by seven
 * empty files whose only effect is to make this check pass.
 */

const LANGUAGES = [...SUPPORTED_LANGUAGES];

let fixture: BundlePairingFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

function run(declarations: readonly FixtureModule[]): BundlePairingResult {
  fixture = createBundlePairingFixture(declarations);
  return checkBundlePairing({ modules: fixture.modules, languages: LANGUAGES });
}

function findingsOf(
  result: BundlePairingResult,
  kind: BundlePairingFindingKind,
): readonly string[] {
  return result.findings
    .filter((finding) => finding.kind === kind)
    .map((finding) => `${finding.moduleId}/${finding.language ?? '-'}`);
}

/** A module that satisfies the rule — every proof's control, in the same tree. */
const COMPLIANT: FixtureModule = {
  id: 'catalog',
  bundles: { 'en.json': validBundle(), 'pl.json': validBundle('actions.open.label', 'Otwórz') },
};

describe('check-bundle-pairing — what it refuses', () => {
  it('reports a module shipping one shipped language and not the other', () => {
    const result = run([COMPLIANT, { id: 'blog', bundles: { 'en.json': validBundle() } }]);
    expect(findingsOf(result, 'missing-language-bundle')).toEqual(['blog/pl']);
  });

  it('reports the missing side whichever language it is', () => {
    // The predicate is over the shipped-language set, not over "has `pl.json`".
    // A module with a Polish bundle and no English one is the same violation,
    // and it is the one the boot loader's own `missing-fallback-bundle` refusal
    // already covers — so a check that only asked about `pl` would be a second
    // instrument for a rule that has one and none for the rule that has none.
    const result = run([COMPLIANT, { id: 'blog', bundles: { 'pl.json': validBundle() } }]);
    expect(findingsOf(result, 'missing-language-bundle')).toEqual(['blog/en']);
  });

  it('reports a bundle that parses to zero entries', () => {
    const result = run([
      COMPLIANT,
      { id: 'blog', bundles: { 'en.json': '{}\n', 'pl.json': validBundle() } },
    ]);
    expect(findingsOf(result, 'empty-bundle')).toEqual(['blog/en']);
    // An empty bundle is present, so the pairing predicate is satisfied — the
    // two findings are independent and this one has to stand on its own.
    expect(findingsOf(result, 'missing-language-bundle')).toEqual([]);
  });

  it('reports a bundle that is not readable as TranslationBundleEntriesSchema', () => {
    const result = run([
      COMPLIANT,
      {
        id: 'blog',
        bundles: {
          // Nested rather than flat: it parses as JSON, fails the schema, and the
          // boot reconciler logs and skips it — so a check that skipped it too
          // would agree with the defect (issue #113).
          'en.json': `${JSON.stringify({ actions: { open: { label: 'Open' } } })}\n`,
          'pl.json': validBundle(),
        },
      },
    ]);
    expect(findingsOf(result, 'unparseable-bundle')).toEqual(['blog/en']);
  });

  it('reports a bundle that is not valid JSON at all', () => {
    const result = run([
      COMPLIANT,
      { id: 'blog', bundles: { 'en.json': '{ "a.b":\n', 'pl.json': validBundle() } },
    ]);
    expect(findingsOf(result, 'unparseable-bundle')).toEqual(['blog/en']);
  });

  it('reports bundle files under a module whose manifest declares no bundlesDir', () => {
    const result = run([
      COMPLIANT,
      {
        id: 'blog',
        bundlesDir: null,
        bundles: { 'en.json': validBundle(), 'pl.json': validBundle() },
      },
    ]);
    expect(findingsOf(result, 'undeclared-bundle-dir')).toEqual(['blog/-']);
    // The files exist, so the pairing predicate applies to them as well: two
    // separable defects, and the module here has only the first.
    expect(findingsOf(result, 'missing-language-bundle')).toEqual([]);
  });

  it('applies the pairing predicate to files nothing loads', () => {
    const result = run([
      COMPLIANT,
      { id: 'blog', bundlesDir: null, bundles: { 'en.json': validBundle() } },
    ]);
    expect(findingsOf(result, 'undeclared-bundle-dir')).toEqual(['blog/-']);
    expect(findingsOf(result, 'missing-language-bundle')).toEqual(['blog/pl']);
  });
});

describe('check-bundle-pairing — what it must not refuse', () => {
  it('is clean for a module shipping every shipped language', () => {
    const result = run([COMPLIANT]);
    expect(result.findings).toEqual([]);
    expect(result.shipping).toEqual(['catalog']);
    expect(result.filesRead).toHaveLength(LANGUAGES.length);
  });

  it('is clean for a module shipping no bundle at all — the conditional', () => {
    // The discrimination § 1 turns on. Seven registered modules are in this
    // state today and every one of them is correct: a module with no
    // user-facing strings owes no translation, and a universal predicate would
    // be repaired by seven empty files.
    const result = run([COMPLIANT, { id: 'auth' }]);
    expect(result.findings).toEqual([]);
    expect(result.shippingNothing).toEqual(['auth']);
    expect(result.classified).toEqual(['catalog', 'auth']);
  });

  it('does not read a bundle for a language the platform does not ship', () => {
    // `de.json` is the loader's `unsupported-language-file`, a different rule
    // with a different owner. It is out of this population by construction, and
    // a module holding one alongside a complete pair is clean here.
    const result = run([
      { id: 'catalog', bundles: { ...COMPLIANT.bundles, 'de.json': validBundle() } },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.filesRead).toHaveLength(LANGUAGES.length);
  });
});

describe('check-bundle-pairing — the derivations', () => {
  it('reads the probe directory names off the manifests rather than a literal', () => {
    // A module that declares no `bundlesDir` is probed at the names the *other*
    // manifests declare. With nothing declared anywhere there is no name to
    // probe, and `undeclared-bundle-dir` cannot fire — which is the derivation,
    // not a gap: the finding is "these files are loaded by nobody", and what
    // "these files" means is the estate's own convention.
    const lonely = run([
      { id: 'blog', bundlesDir: null, bundles: { 'en.json': validBundle() } },
    ]);
    expect(lonely.findings).toEqual([]);
    expect(lonely.shippingNothing).toEqual(['blog']);

    const witnessed = run([
      COMPLIANT,
      { id: 'blog', bundlesDir: null, bundles: { 'en.json': validBundle() } },
    ]);
    expect(findingsOf(witnessed, 'undeclared-bundle-dir')).toEqual(['blog/-']);
  });

  it('follows a module that names its bundle directory something else', () => {
    const result = run([
      { id: 'catalog', bundlesDir: 'translations', bundles: { 'en.json': validBundle() } },
    ]);
    expect(declaredBundleDirectories(fixture!.modules)).toEqual(['translations']);
    expect(findingsOf(result, 'missing-language-bundle')).toEqual(['catalog/pl']);
  });

  it('does not read a directory the manifest does not name', () => {
    // The declared directory is the one the boot reconciler joins, so bundles
    // sitting anywhere else are not this module's bundles — they are the
    // `undeclared-bundle-dir` question one step on, and answering them here
    // would report a module as shipping strings the platform never loads.
    const result = run([
      COMPLIANT,
      { id: 'blog', bundlesDir: 'translations', onDisk: 'i18n', bundles: { 'en.json': validBundle() } },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.shippingNothing).toEqual(['blog']);
  });
});

describe('check-bundle-pairing — it refuses a vacuous pass', () => {
  const coverage = (result: BundlePairingResult, expectedModules: number) => ({
    prefix: '[bundle-pairing]',
    files: result.filesRead.length,
    sites: result.classified.length,
    coverage: [
      { source: 'manifest-index', expected: expectedModules, covered: result.classified.length },
      {
        source: 'shipped-languages',
        expected: LANGUAGES.length,
        covered: result.languagesProbed,
      },
    ],
  });

  it('refuses a run in which no module shipped a bundle at all', () => {
    // § 4's fourth condition, and the one a careless implementation omits:
    // with a **conditional** predicate this state is *vacuously clean*. Every
    // module is exempt, `findings=0` prints, and the run has said nothing.
    const result = run([{ id: 'catalog' }, { id: 'auth' }]);
    expect(result.findings).toEqual([]);
    expect(result.languagesProbed).toBe(0);
    expect(readSizeRefusal(coverage(result, 2))?.kind).toBe('read-nothing');
  });

  it('refuses a walk that came back short of the modules the index registers', () => {
    const result = run([COMPLIANT]);
    expect(readSizeRefusal(coverage(result, 69))?.kind).toBe('short-walk');
  });

  it('refuses a run whose shipped-language set is empty', () => {
    // The other half of the same idea: with no language to compare, every
    // module is paired by construction. The check refuses before the walk, and
    // the read line would refuse it again — `expected=0` is `no-expectation`.
    fixture = createBundlePairingFixture([COMPLIANT]);
    const empty = checkBundlePairing({ modules: fixture.modules, languages: [] });
    expect(empty.findings).toEqual([]);
    expect(
      readSizeRefusal({
        prefix: '[bundle-pairing]',
        files: empty.filesRead.length,
        sites: empty.classified.length,
        coverage: [{ source: 'shipped-languages', expected: 0, covered: 0 }],
      })?.kind,
    ).toBe('read-nothing');
  });

  it('does not refuse a run that read the population it was given', () => {
    const result = run([COMPLIANT, { id: 'auth' }]);
    expect(readSizeRefusal(coverage(result, 2))).toBeNull();
  });
});
