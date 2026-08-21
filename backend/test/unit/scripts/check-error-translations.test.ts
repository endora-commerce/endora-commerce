import { describe, expect, it } from 'vitest';
import {
  analyseErrorTranslations,
  findUnreachableSentences,
  findUntranslatedErrorCodes,
  routedBundleDirectories,
  UNTRANSLATED_ERROR_CODES,
  unroutedModules,
  type ErrorTranslationTarget,
  type TranslationInput,
} from '../../../scripts/check-error-translations.js';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';
import { ERROR_TRANSLATION_KEYS } from '../../../src/modules/_i18n/services/error-translation.js';

/**
 * The error-translation rule's own test (issue #113).
 *
 * The check shipped with a 78-entry ledger and no test at all, so the only
 * evidence it worked was that it printed a number nobody could reproduce. What
 * is proved here is that it goes **red**: on a code with no sentence, on a code
 * with a sentence in one language only, and on a ledger entry that has since
 * been translated. The routing table and the bundle reader are both injected,
 * so none of it depends on what the tree currently ships.
 */

/** A table of two codes, both routed to `blog`, keyed the way the envelope reads them. */
const KEYS = {
  BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' },
  BLOG_SLUG_TAKEN: { moduleId: 'blog', key: 'errors.BLOG_SLUG_TAKEN' },
} as const;

function input(bundles: Record<string, Record<string, unknown>>): TranslationInput {
  return fixture(KEYS, bundles);
}

/**
 * A whole tree, as the two predicates read it: a routing table, and every
 * bundle on disk keyed `<directory>.<language>`.
 *
 * The two members are deliberately built from **one** map. P1 reads the bundle
 * the table names and P2 reads the bundles it does not, so a fixture that let
 * them disagree could make either predicate look right while describing a tree
 * that cannot exist. `readBundle` applies the `core` → `_i18n` rename to the
 * table's answer, which is where the real reader applies it — `listBundleKeys`
 * yields directory names and never sees `core` (§ 3.4 of the contract).
 */
function fixture(
  keys: Readonly<Record<string, ErrorTranslationTarget>>,
  bundles: Record<string, Record<string, unknown>>,
): TranslationInput {
  const directoryOf = (moduleId: string): string => (moduleId === 'core' ? '_i18n' : moduleId);
  return {
    keys,
    readBundle: (moduleId, language) => bundles[`${directoryOf(moduleId)}.${language}`] ?? {},
    listBundleKeys: () =>
      Object.entries(bundles).flatMap(([slot, bundle]) => {
        const cut = slot.lastIndexOf('.');
        const moduleId = slot.slice(0, cut);
        const language = slot.slice(cut + 1);
        return Object.keys(bundle)
          .filter((key) => key.startsWith('errors.'))
          .map((key) => ({ moduleId, language, key }));
      }),
  };
}

describe('findUntranslatedErrorCodes — the shapes it has to see', () => {
  it('reports a code with no sentence in either language', () => {
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': { 'errors.BLOG_SLUG_TAKEN': 'That slug is taken.' },
        'blog.pl': { 'errors.BLOG_SLUG_TAKEN': 'Ten adres jest zajęty.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'BLOG_POST_NOT_FOUND',
      moduleId: 'blog',
      missingIn: ['en', 'pl'],
    });
  });

  it('reports a code translated in one language only — both ship, or neither counts', () => {
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': {
          'errors.BLOG_POST_NOT_FOUND': 'No such post.',
          'errors.BLOG_SLUG_TAKEN': 'That slug is taken.',
        },
        'blog.pl': { 'errors.BLOG_SLUG_TAKEN': 'Ten adres jest zajęty.' },
      }),
    );
    expect(findings.map((f) => f.missingIn)).toEqual([['pl']]);
  });

  it('does not accept a non-string under the key — a nested object renders nothing', () => {
    // A nested bundle passes `key in bundle` and fails at render time, which is
    // exactly the failure mode this check exists to make visible.
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': { 'errors.BLOG_POST_NOT_FOUND': { message: 'No such post.' } },
        'blog.pl': { 'errors.BLOG_POST_NOT_FOUND': 'Nie ma takiego wpisu.' },
      }),
    );
    expect(findings.map((f) => `${f.code}:${f.missingIn.join(',')}`)).toContain(
      'BLOG_POST_NOT_FOUND:en',
    );
  });

  it('says nothing when both codes have both sentences', () => {
    const bundle = {
      'errors.BLOG_POST_NOT_FOUND': 'x',
      'errors.BLOG_SLUG_TAKEN': 'y',
    };
    expect(
      findUntranslatedErrorCodes(input({ 'blog.en': bundle, 'blog.pl': bundle })),
    ).toEqual([]);
  });

  it('reads the routed module, not the code prefix — an unrouted code is the ledger`s core block', () => {
    const findings = findUntranslatedErrorCodes({
      keys: { KSEF_UNAVAILABLE: { moduleId: 'core', key: 'errors.KSEF_UNAVAILABLE' } },
      readBundle: (moduleId) => (moduleId === 'ksef' ? { 'errors.KSEF_UNAVAILABLE': 'x' } : {}),
      // P1 only: this case is about which bundle the table names, and the walk
      // P2 reads is a different question asked further down this file.
      listBundleKeys: () => [],
    });
    expect(findings.map((f) => f.moduleId)).toEqual(['core']);
  });
});

describe('the ledger, as a two-way ratchet', () => {
  /** The staleness half of `main`, which is the half a ledger loses first. */
  function stale(findings: readonly { code: string }[], ledger: ReadonlySet<string>): string[] {
    const found = new Set(findings.map((f) => f.code));
    return [...ledger].filter((code) => !found.has(code)).sort();
  }

  it('an unledgered untranslated code is a violation', () => {
    const findings = findUntranslatedErrorCodes(input({}));
    const ledger = new Set(['BLOG_SLUG_TAKEN']);
    expect(findings.filter((f) => !ledger.has(f.code)).map((f) => f.code)).toEqual([
      'BLOG_POST_NOT_FOUND',
    ]);
  });

  it('a ledger entry that now has a sentence is a violation too', () => {
    const bundle = { 'errors.BLOG_POST_NOT_FOUND': 'x', 'errors.BLOG_SLUG_TAKEN': 'y' };
    const findings = findUntranslatedErrorCodes(input({ 'blog.en': bundle, 'blog.pl': bundle }));
    expect(stale(findings, new Set(['BLOG_SLUG_TAKEN']))).toEqual(['BLOG_SLUG_TAKEN']);
  });

  it('names a real code in every entry — the ledger is written in code names, not prose', () => {
    for (const code of UNTRANSLATED_ERROR_CODES) {
      expect(code, `${code} is not a code name`).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe('the tree itself', () => {
  it('has a routing table with codes in it, and no unledgered untranslated code', () => {
    const findings = findUntranslatedErrorCodes();
    // The routing table is the whole input: an empty one would report every
    // code translated. `main` exits 2 on it; here the floor is the assertion.
    expect(findings.length + UNTRANSLATED_ERROR_CODES.size).toBeGreaterThan(0);
    const unledgered = findings.filter((f) => !UNTRANSLATED_ERROR_CODES.has(f.code));
    expect(unledgered.map((f) => `${f.code} → ${f.moduleId} (${f.missingIn.join(', ')})`)).toEqual(
      [],
    );
    const found = new Set(findings.map((f) => f.code));
    expect([...UNTRANSLATED_ERROR_CODES].filter((code) => !found.has(code))).toEqual([]);
  });
});

/**
 * P2 (feature 082, D-127) — **every written key is a routed key**.
 *
 * P1 asks whether the bundle the table names has the sentence. It cannot ask
 * anything about the bundles the table does not name, and that is where issue
 * #229's five defects lived: two finished sentences routing could not reach,
 * three shadowed by a machine-shaped placeholder in the bundle routing did
 * reach. Together the two predicates make routing and sentences a bijection.
 *
 * One proof per kind, plus a discrimination fixture, because four of a check's
 * signals can go blind behind the fifth's red (issue #130). Each asserts the
 * finding's `kind`, not merely that something was reported.
 */
describe('findUnreachableSentences — a sentence written where nothing reads it', () => {
  const ROUTED_TO_A = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;

  it('unreachable — the routed bundle has no such key, and this one does', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, { 'b.en': { 'errors.X_REFUSED': 'Refused.' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'unreachable',
      moduleId: 'b',
      language: 'en',
      key: 'errors.X_REFUSED',
      routedModuleId: 'a',
    });
  });

  it('duplicate — the routed bundle has it too, so this copy is read by nothing', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'Refused.' },
        'b.en': { 'errors.X_REFUSED': 'Refused.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'duplicate', moduleId: 'b' });
  });

  it('no-code — the key names something that is not in ERROR_CODES at all', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, { 'b.en': { 'errors.COUPON_EXPIRED': 'It expired.' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'no-code',
      moduleId: 'b',
      code: 'COUPON_EXPIRED',
      routedModuleId: null,
    });
  });

  /**
   * The discrimination fixture. Without it, a predicate that reported every
   * `errors.*` key it saw would pass all three proofs above — and the token
   * shape is the half that would go first, since `errors.<CODE>.<token>` is a
   * different string from any code name.
   */
  it('says nothing about a correctly-filed sentence, token keys included', () => {
    expect(
      findUnreachableSentences(
        fixture(ROUTED_TO_A, {
          'a.en': {
            'errors.X_REFUSED': 'Refused.',
            'errors.X_REFUSED.some_token': 'Refused, because of the token.',
          },
          'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
        }),
      ),
    ).toEqual([]);
  });

  it('attributes a token key to its base code when it is filed in the wrong bundle', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, { 'b.en': { 'errors.X_REFUSED.some_token': 'Refused.' } }),
    );
    expect(findings).toHaveLength(1);
    // The base code exists, so this is a misfiled sentence rather than a dead
    // key — reporting it as `no-code` would invite deleting a live string.
    expect(findings[0]).toMatchObject({ kind: 'unreachable', code: 'X_REFUSED' });
  });

  it('applies the core → _i18n rename to the table s answer, not to the walk', () => {
    // The routing table says `core`; the directory holding that bundle is
    // `_i18n`. Comparing the two literally would report every platform sentence
    // in the tree as unreachable.
    const findings = findUnreachableSentences(
      fixture(
        { VERSION_CONFLICT: { moduleId: 'core', key: 'errors.VERSION_CONFLICT' } },
        { '_i18n.en': { 'errors.VERSION_CONFLICT': 'Changed elsewhere.' } },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('reads a key in each language separately — one language only is P1 s finding', () => {
    // `errors.X_REFUSED` written in `b` in both languages is two dead strings,
    // not one, and each is repaired in its own file.
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, {
        'b.en': { 'errors.X_REFUSED': 'Refused.' },
        'b.pl': { 'errors.X_REFUSED': 'Odmowa.' },
      }),
    );
    expect(findings.map((f) => f.language).sort()).toEqual(['en', 'pl']);
  });

  it('ignores a bundle key that is not an error sentence', () => {
    expect(
      findUnreachableSentences(
        fixture(ROUTED_TO_A, {
          'a.en': { 'errors.X_REFUSED': 'Refused.' },
          'b.en': { 'title': 'Blog', 'actions.openBlog.label': 'Open blog' },
        }),
      ),
    ).toEqual([]);
  });
});

describe('the two vacuity guards, which are independent', () => {
  const KEYS_ONLY = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;

  it('exits 2 when the bundle walk yields no key, even with a full routing table', () => {
    // The routing table is a static import and the bundles are a filesystem
    // walk, so either can come back empty while the other is full. A single
    // guard over one of them lets the other report a clean tree while looking
    // at nothing (issue #113).
    const result = analyseErrorTranslations(
      { keys: KEYS_ONLY, readBundle: () => ({}), listBundleKeys: () => [] },
      new Set(['X_REFUSED']),
    );
    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatch(/vacuous/);
  });

  it('exits 2 when the routing table routes no code, even with bundles on disk', () => {
    const result = analyseErrorTranslations(
      fixture({}, { 'a.en': { 'errors.X_REFUSED': 'Refused.' } }),
      new Set(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatch(/vacuous/);
  });

  it('exits 1 on a P2 finding, which has no ledger to absorb it', () => {
    const result = analyseErrorTranslations(
      fixture(KEYS_ONLY, {
        'a.en': { 'errors.X_REFUSED': 'Refused.' },
        'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
        'b.en': { 'errors.X_REFUSED': 'Refused.' },
      }),
      new Set(),
    );
    expect(result.sentences.map((f) => f.kind)).toEqual(['duplicate']);
    expect(result.exitCode).toBe(1);
  });

  it('exits 0 on a tree where both predicates are satisfied', () => {
    const result = analyseErrorTranslations(
      fixture(KEYS_ONLY, {
        'a.en': { 'errors.X_REFUSED': 'Refused.' },
        'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
      }),
      new Set(),
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('the tree itself, under P2', () => {
  it('writes every error sentence in the bundle the routing table points at', () => {
    const findings = findUnreachableSentences();
    expect(
      findings.map((f) => `${f.kind}: ${f.moduleId}/${f.language} ${f.key}`),
    ).toEqual([]);
  });

  it('read a real tree while doing so', () => {
    // The population is a filesystem walk; an empty one reports no finding for
    // the same reason a clean tree does.
    const walked = [...analyseErrorTranslations().keysWalked];
    expect(walked.length).toBeGreaterThan(100);
  });
});

/**
 * The population floor under the bundle walk (feature 080, T010, issue #215).
 *
 * The bundle half is a module-tree walk, and its old floor was "the walk read
 * no `errors.*` key at all" — which catches the total loss and nothing else.
 * What happens instead is that one module's bundle is not where the walk looks:
 * P1 then reports every code routed there as untranslated, which is loud and
 * wrong. Measured on the tree this landed against, emptying any one of the
 * eighteen routed modules' bundles produced between 2 and 41 such findings and
 * never zero.
 *
 * So the walk is reconciled against the modules the routing table names,
 * derived per run from two static imports. These cases enter where the CLI
 * enters: the registered ids, the routing table and the file list the walk
 * produced.
 */
describe('the bundle-walk population floor', () => {
  const REGISTERED = ['blog', 'catalog', 'orders'];
  const ROUTED_TO_BLOG = {
    BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' },
  } as const;

  const refusal = (files: readonly string[]): string | null =>
    vacuousModulePopulation({
      registered: REGISTERED,
      files,
      excluded: unroutedModules(ROUTED_TO_BLOG, REGISTERED),
    });

  it('refuses a walk that missed a module the routing table names', () => {
    const reason = refusal(['/abs/src/modules/catalog/i18n/en.json']);
    expect(reason).not.toBeNull();
    expect(reason).toContain('blog');
  });

  it('says nothing about a module the routing table does not name', () => {
    // `catalog` and `orders` route no code here, so nothing requires them to
    // ship a bundle — 45 of the 66 registered modules ship one on the real
    // tree, and a floor that asked for all 66 would be a list of exceptions.
    expect(refusal(['/abs/src/modules/blog/i18n/en.json'])).toBeNull();
  });

  it('resolves `core` to the bundle that actually holds it', () => {
    // The routing table's `core` is an answer, not a directory. A floor that
    // asked for a module called `core` would ask for one nothing can satisfy,
    // and would refuse every run.
    expect(
      routedBundleDirectories({ X: { moduleId: 'core', key: 'errors.X' } }),
    ).toEqual(['_i18n']);
  });

  it('derives the exclusion rather than taking one, on the real routing table', () => {
    const routed = routedBundleDirectories();
    expect(routed.length).toBeGreaterThan(0);
    expect(routed).toContain('_i18n');
    expect(routed).not.toContain('core');
    // The dual, over the table the CLI actually uses: every routed module stays
    // inside the floor and only the one that routes nothing falls out of it. An
    // exclusion that quietly covered everything would switch the floor off
    // while every run still looked normal.
    expect(unroutedModules(ERROR_TRANSLATION_KEYS, [...routed, 'zz_routes_nothing'])).toEqual([
      'zz_routes_nothing',
    ]);
  });
});
