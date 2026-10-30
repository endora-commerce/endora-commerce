import { describe, expect, it } from 'vitest';
import {
  analyseErrorTranslations,
  declaredTokensOf,
  declaringBundleDirectories,
  findPlaceholderSentences,
  findUnraisedCodes,
  findUndeclaredTokenRaises,
  findUnreachableSentences,
  findUntranslatedErrorCodes,
  findUntranslatedTokens,
  nonDeclaringModules,
  readRaiseSites,
  reconcileEnumeration,
  treeTranslationInput,
  UNDECLARABLE_TOKEN_ERROR_CODES,
  UNRAISED_ERROR_CODES,
  UNTRANSLATED_ERROR_CODES,
  type ErrorTranslationTarget,
  type SourceFile,
  type TranslationInput,
} from '../../../scripts/check-error-translations.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

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

/** A source file raising each code once, the way the platform does, with no token. */
function raising(codes: readonly string[]): SourceFile {
  return {
    path: 'fixture/raises.ts',
    text: codes
      .map((code) => `throw new HttpError(400, ERROR_CODES.${code}, 'Refused.');`)
      .join('\n'),
  };
}

/**
 * The whole analysis over the real tree, once per file: it parses every source
 * file the raise walk opens, and the tree cases below only read its result.
 */
let treeAnalysis: Promise<ReturnType<typeof analyseErrorTranslations>> | undefined;
function analysedTree(): Promise<ReturnType<typeof analyseErrorTranslations>> {
  treeAnalysis ??= treeTranslationInput().then((tree) => analyseErrorTranslations(tree));
  return treeAnalysis;
}

/**
 * The analysis over a fixture, with **every** ledger empty unless a case passes
 * one: a fixture never holds the real tree's codes, so the real ledgers would
 * read wholly stale over it.
 */
function analyse(
  tree: TranslationInput,
  ledger: ReadonlySet<string> = new Set(),
  unraisedLedger: ReadonlySet<string> = new Set(),
  undeclarableLedger: ReadonlySet<string> = new Set(),
): ReturnType<typeof analyseErrorTranslations> {
  return analyseErrorTranslations(tree, ledger, unraisedLedger, undeclarableLedger);
}

/**
 * A whole tree, as the predicates read it: a routing map, the codes the platform
 * enumerates, the contested codes, and every bundle on disk keyed
 * `<directory>.<language>`.
 *
 * The bundle members are deliberately built from **one** map. P1 reads the
 * bundle the routing names and P2 reads the bundles it does not, so a fixture
 * that let them disagree could make either predicate look right while describing
 * a tree that cannot exist.
 *
 * There is no `core` → `_i18n` rename here, and its absence is the point: the
 * routing map is keyed on **declaring module ids** since feature 090's Phase 4,
 * so the comparison is a plain equality and this fixture used to carry the third
 * copy of an identity that now has exactly one (D-185).
 *
 * `enumeratedCodes` defaults to the codes the routing map holds, so a fixture
 * that says nothing about P3 gets a tree where P3 has nothing to report — the
 * cases that *are* about P3 pass it explicitly.
 */
function fixture(
  keys: Readonly<Record<string, ErrorTranslationTarget>>,
  bundles: Record<string, Record<string, unknown>>,
  extra: Partial<Pick<TranslationInput, 'collisions' | 'enumeratedCodes' | 'declaredTokens'>> & {
    readonly sources?: readonly SourceFile[];
  } = {},
): TranslationInput {
  const collisions = extra.collisions ?? [];
  return {
    keys,
    collisions,
    enumeratedCodes: extra.enumeratedCodes ?? Object.keys(keys),
    declaredTokens: extra.declaredTokens ?? {},
    // Every declared code raised once, with no token, unless the case is about
    // the raise sites — so a fixture that says nothing about P6 or P7 gets a
    // tree where neither has anything to report.
    listSources: () =>
      extra.sources ?? [
        raising([...Object.keys(keys), ...collisions.map((collision) => collision.code)]),
      ],
    readBundle: (moduleId, language) => bundles[`${moduleId}.${language}`] ?? {},
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

  it('reads the declaring module, not the code prefix — the ledger`s _i18n block', () => {
    // P1 only, so the input is narrowed to the two members it reads: this case
    // is about which bundle the routing names, and the walk P2 reads is a
    // different question asked further down this file.
    const findings = findUntranslatedErrorCodes({
      keys: { KSEF_UNAVAILABLE: { moduleId: '_i18n', key: 'errors.KSEF_UNAVAILABLE' } },
      readBundle: (moduleId) => (moduleId === 'ksef' ? { 'errors.KSEF_UNAVAILABLE': 'x' } : {}),
    });
    expect(findings.map((f) => f.moduleId)).toEqual(['_i18n']);
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
  it('has a routing table with codes in it, and no unledgered untranslated code', async () => {
    const findings = findUntranslatedErrorCodes(await treeTranslationInput());
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

  it('compares directory to directory — the platform bundle needs no rename', () => {
    // This asserted the opposite until feature 090's Phase 4: the prefix chain
    // answered `core` for the platform block, a bundle namespace where every
    // other answer was a module id, so the check applied a `core` → `_i18n`
    // rename to the routing answer and comparing the two literally would have
    // reported every platform sentence in the tree as unreachable. Routing is
    // the modules' own declarations now and `_i18n` declares the block, so the
    // rename is gone and this is the assertion that its absence is correct
    // rather than an oversight.
    const findings = findUnreachableSentences(
      fixture(
        { VERSION_CONFLICT: { moduleId: '_i18n', key: 'errors.VERSION_CONFLICT' } },
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

  /**
   * Issue #83, slice 1. A key under `errors.` that the grammar cannot parse was
   * skipped by every predicate — `if (!match) continue;` — so a sentence filed
   * under a mis-cased code was neither accepted nor reported. The envelope only
   * ever composes `errors.<CODE>` or `errors.<CODE>.<token>`, so such a key is
   * read by nothing it renders.
   */
  it('malformed-key — a mis-cased code is a finding, not a skipped line', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'Refused.', 'errors.configMissing': 'Configuration is missing.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'malformed-key',
      moduleId: 'a',
      language: 'en',
      key: 'errors.configMissing',
      routedModuleId: null,
    });
  });

  it('malformed-key — each shape the grammar refuses, in the language it is written in', () => {
    const findings = findUnreachableSentences(
      fixture(ROUTED_TO_A, {
        'a.en': {
          'errors.X_REFUSED': 'Refused.',
          // a token that is not snake_case
          'errors.X_REFUSED.tooLate': 'Too late.',
          // a namespace nested under `errors.` that names no code
          'errors.reason.too_late': 'Too late.',
          // a code in the wrong case
          'errors.x_refused': 'Refused.',
          // nothing after the dot
          'errors.': 'Refused.',
        },
        'a.pl': { 'errors.x_refused': 'Odmowa.' },
      }),
    );
    expect(findings.map((f) => `${f.kind} ${f.language} ${f.key}`)).toEqual([
      'malformed-key en errors.',
      'malformed-key en errors.reason.too_late',
      'malformed-key en errors.x_refused',
      'malformed-key pl errors.x_refused',
      'malformed-key en errors.X_REFUSED.tooLate',
    ]);
  });

  it('exits 1 on a malformed key, and the summary counts it', () => {
    const result = analyse(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'Refused.', 'errors.configMissing': 'x' },
        'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
      }),
      new Set(),
    );
    expect(result.sentences.map((f) => f.kind)).toEqual(['malformed-key']);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('malformedKey=1');
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

describe('the three vacuity guards, which are independent', () => {
  const KEYS_ONLY = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;

  it('exits 2 when the bundle walk yields no key, even with a full routing map', () => {
    // The declarations, the enumeration and the bundles are three different
    // reads, so any one can come back empty while the others are full. A single
    // guard over one of them lets the others report a clean tree while looking
    // at nothing (issue #113).
    const result = analyse(fixture(KEYS_ONLY, {}), new Set(['X_REFUSED']));
    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatch(/vacuous/);
  });

  it('exits 2 when no manifest declares a code, even with bundles on disk', () => {
    const result = analyse(
      fixture({}, { 'a.en': { 'errors.X_REFUSED': 'Refused.' } }, { enumeratedCodes: ['X_REFUSED'] }),
      new Set(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatch(/no registered manifest declares an error code/);
  });

  it('counts a contested code as declared — P4 is what says the platform has none', () => {
    // "Nobody declares anything" is the state the guard above exists for. A
    // platform whose every declaration collided has declarations, and reporting
    // it as an empty read would hide the collision behind a refusal.
    const result = analyse(
      fixture(
        {},
        { 'a.en': { 'errors.X_REFUSED': 'Refused.' }, 'a.pl': { 'errors.X_REFUSED': 'Odmowa.' } },
        {
          enumeratedCodes: ['X_REFUSED'],
          collisions: [
            {
              code: 'X_REFUSED',
              claims: [
                { moduleId: 'a', declaredIn: '/a/manifest.ts' },
                { moduleId: 'b', declaredIn: '/b/manifest.ts' },
              ],
            },
          ],
        },
      ),
      new Set(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.collisions.map((c) => c.code)).toEqual(['X_REFUSED']);
    expect(result.summary).toContain('collision=1');
  });

  it('exits 2 when ERROR_CODES enumerates nothing, so P3 compares against nothing', () => {
    const result = analyse(
      fixture(
        KEYS_ONLY,
        { 'a.en': { 'errors.X_REFUSED': 'Refused.' }, 'a.pl': { 'errors.X_REFUSED': 'Odmowa.' } },
        { enumeratedCodes: [] },
      ),
      new Set(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatch(/ERROR_CODES enumerates no code/);
  });

  it('exits 1 on a P2 finding, which has no ledger to absorb it', () => {
    const result = analyse(
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
    const result = analyse(
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
  it('writes every error sentence in the bundle the routing table points at', async () => {
    const findings = findUnreachableSentences(await treeTranslationInput());
    expect(
      findings.map((f) => `${f.kind}: ${f.moduleId}/${f.language} ${f.key}`),
    ).toEqual([]);
  });

  it('read a real tree while doing so', async () => {
    // The population is a filesystem walk; an empty one reports no finding for
    // the same reason a clean tree does. Since feature 080's T040a the walk is
    // over the module directories the layout resolves, so this also covers a
    // module whose bundle has moved into a package with it.
    const walked = [...(await analysedTree()).keysWalked];
    expect(walked.length).toBeGreaterThan(100);
  }, 120_000);
});

/**
 * P5 (issue #441) — **a translation is a sentence in its own language**.
 *
 * P1 counts a key as translated the moment it holds a string, so it counted
 * 137 Polish entries of the shape `Błąd: product not found.` — the word for
 * "error" in front of the code, lowercased — as finished work, and a Polish
 * operator read them verbatim. P5 refuses that shape, and the shape it
 * degrades into when somebody copies the English across instead: a value
 * identical to the English sentence under the same key.
 *
 * One proof per kind, plus the discrimination fixtures that keep a predicate
 * reporting every non-English key from passing them.
 */
describe('findPlaceholderSentences — a translation that is not a sentence', () => {
  const ROUTED_TO_A = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;

  it('placeholder — the word for "error" in front of the code, lowercased', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'The request was refused.' },
        'a.pl': { 'errors.X_REFUSED': 'Błąd: x refused.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'placeholder',
      moduleId: 'a',
      language: 'pl',
      key: 'errors.X_REFUSED',
      code: 'X_REFUSED',
    });
  });

  it('placeholder — the code alone, whatever its case, is the same shape without the label', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'The request was refused.' },
        'a.pl': { 'errors.X_REFUSED': 'X Refused.' },
      }),
    );
    expect(findings.map((f) => f.kind)).toEqual(['placeholder']);
  });

  it('placeholder — in any language that is not the reference one', () => {
    // The shape is language-agnostic: a third shipped language would be
    // generated the same way, with its own word in front of the code.
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'The request was refused.' },
        'a.de': { 'errors.X_REFUSED': 'Fehler: x refused.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'placeholder', language: 'de' });
  });

  it('placeholder — a token key spelled as its code and token', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED.too_late': 'It is too late for that.' },
        'a.pl': { 'errors.X_REFUSED.too_late': 'Błąd: x refused too late.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'placeholder', code: 'X_REFUSED' });
  });

  it('same-as-english — the English sentence copied across under the same key', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'The request was refused.' },
        'a.pl': { 'errors.X_REFUSED': 'The request was refused.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'same-as-english',
      moduleId: 'a',
      language: 'pl',
      key: 'errors.X_REFUSED',
    });
  });

  it('reports a placeholder once per bundle, even when the English is the same placeholder', () => {
    // The Polish value is a placeholder whatever the English says, so it is
    // never also reported as a copy of it; the English one is its own finding
    // (issue #486).
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'X Refused.' },
        'a.pl': { 'errors.X_REFUSED': 'X Refused.' },
      }),
    );
    expect(findings.map((f) => `${f.kind} ${f.language}`)).toEqual([
      'placeholder en',
      'placeholder pl',
    ]);
  });

  /**
   * The discrimination fixtures. A predicate that reported every non-English
   * key, or every value that starts with `Błąd:`, or every value equal to the
   * English one, would pass the proofs above.
   */
  it('says nothing about a sentence in its own language, token keys included', () => {
    expect(
      findPlaceholderSentences(
        fixture(ROUTED_TO_A, {
          'a.en': {
            'errors.X_REFUSED': 'The request was refused.',
            'errors.X_REFUSED.too_late': 'It is too late for that.',
          },
          'a.pl': {
            'errors.X_REFUSED': 'Żądanie zostało odrzucone.',
            'errors.X_REFUSED.too_late': 'Na to jest już za późno.',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('says nothing about a real sentence that happens to open with the word for "error"', () => {
    expect(
      findPlaceholderSentences(
        fixture(ROUTED_TO_A, {
          'a.en': { 'errors.X_REFUSED': 'Error: the request was refused.' },
          'a.pl': { 'errors.X_REFUSED': 'Błąd: żądanie zostało odrzucone.' },
        }),
      ),
    ).toEqual([]);
  });

  it('says nothing about a value that is only an interpolation — there is no language in it', () => {
    // `{reason}` is filled from the raise's own details, so it is the same
    // string in every language by construction, and a ledger entry for it would
    // be a list of every code that forwards a reason.
    expect(
      findPlaceholderSentences(
        fixture(ROUTED_TO_A, {
          'a.en': { 'errors.X_REFUSED': '{reason}' },
          'a.pl': { 'errors.X_REFUSED': '{reason}' },
        }),
      ),
    ).toEqual([]);
  });

  it('does not compare the reference language with itself', () => {
    expect(
      findPlaceholderSentences(
        fixture(ROUTED_TO_A, { 'a.en': { 'errors.X_REFUSED': 'The request was refused.' } }),
      ),
    ).toEqual([]);
  });

  it('exits 1 on a P5 finding, and the summary counts it by kind', () => {
    const result = analyse(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.X_REFUSED': 'The request was refused.' },
        'a.pl': { 'errors.X_REFUSED': 'Błąd: x refused.' },
      }),
      new Set(),
    );
    expect(result.placeholders.map((f) => f.kind)).toEqual(['placeholder']);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('placeholder=1 sameAsEnglish=0');
  });
});

/**
 * P5 over the reference language (issue #486). The English entries of the same
 * 137 codes were the code title-cased behind a full stop — `Product Not Found.`
 * — and the envelope served them verbatim. The English shape is the code in
 * **Title Case**, matched case-sensitively, because the honest English sentence
 * for a `*_NOT_FOUND` code is very often the same words in sentence case
 * (`Order not found.`); the case-insensitive comparison that is right for the
 * other languages would report those.
 */
describe('findPlaceholderSentences — the reference language', () => {
  const ROUTED_TO_A = {
    ORDER_NOT_FOUND: { moduleId: 'a', key: 'errors.ORDER_NOT_FOUND' },
    X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' },
  } as const;

  it('placeholder — the code in Title Case behind a full stop', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': { 'errors.ORDER_NOT_FOUND': 'Order Not Found.' },
        'a.pl': { 'errors.ORDER_NOT_FOUND': 'Nie znaleziono zamówienia.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'placeholder',
      moduleId: 'a',
      language: 'en',
      key: 'errors.ORDER_NOT_FOUND',
      code: 'ORDER_NOT_FOUND',
      value: 'Order Not Found.',
    });
  });

  it('placeholder — behind a one-word label, and with no full stop', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, {
        'a.en': {
          'errors.ORDER_NOT_FOUND': 'Error: Order Not Found',
          'errors.X_REFUSED': 'X Refused',
        },
      }),
    );
    expect(findings.map((f) => `${f.kind} ${f.language} ${f.key}`)).toEqual([
      'placeholder en errors.ORDER_NOT_FOUND',
      'placeholder en errors.X_REFUSED',
    ]);
  });

  it('placeholder — a token key spelled as its code and token in Title Case', () => {
    const findings = findPlaceholderSentences(
      fixture(ROUTED_TO_A, { 'a.en': { 'errors.X_REFUSED.too_late': 'X Refused Too Late.' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'placeholder', language: 'en', code: 'X_REFUSED' });
  });

  /**
   * The discrimination fixtures. A predicate that compared the English value
   * case-insensitively — P5's rule for every other language — would report
   * each of these, and every one is the kind of sentence the tree ships.
   */
  it('says nothing about the same words in sentence case — `Order not found.` is a sentence', () => {
    expect(
      findPlaceholderSentences(
        fixture(
          {
            ...ROUTED_TO_A,
            SETTING_GROUP_NOT_FOUND: { moduleId: 'a', key: 'errors.SETTING_GROUP_NOT_FOUND' },
          },
          {
            'a.en': {
              'errors.ORDER_NOT_FOUND': 'Order not found.',
              'errors.SETTING_GROUP_NOT_FOUND': 'Setting group not found.',
              'errors.X_REFUSED.too_late': 'X refused too late.',
            },
          },
        ),
      ),
    ).toEqual([]);
  });

  it('says nothing about an English sentence that merely contains the code in Title Case', () => {
    expect(
      findPlaceholderSentences(
        fixture(ROUTED_TO_A, {
          'a.en': { 'errors.ORDER_NOT_FOUND': 'The Order Not Found page was removed.' },
        }),
      ),
    ).toEqual([]);
  });
});

describe('the tree itself, under P5', () => {
  it('ships no placeholder in any bundle and no copied English sentence in a non-English one', async () => {
    const findings = findPlaceholderSentences(await treeTranslationInput());
    expect(
      findings.map((f) => `${f.kind}: ${f.moduleId}/${f.language} ${f.key}`),
    ).toEqual([]);
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
  const DECLARED_BY_BLOG = {
    BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' },
  } as const;

  const refusal = (files: readonly string[]): string | null =>
    vacuousModulePopulation({
      registered: REGISTERED,
      files,
      excluded: nonDeclaringModules(DECLARED_BY_BLOG, REGISTERED),
    });

  it('refuses a walk that missed a module the routing map names', () => {
    const reason = refusal(['/abs/src/modules/catalog/i18n/en.json']);
    expect(reason).not.toBeNull();
    expect(reason).toContain('blog');
  });

  it('says nothing about a module that declares no code', () => {
    // `catalog` and `orders` declare nothing here, so nothing requires them to
    // ship a bundle — 45 of the 66 registered modules ship one on the real
    // tree, and a floor that asked for all 66 would be a list of exceptions.
    expect(refusal(['/abs/src/modules/blog/i18n/en.json'])).toBeNull();
  });

  it('names module directories and nothing else — `core` is produced by nothing', () => {
    // The floor asks each named module for a bundle directory, so a routing
    // answer that is not a module id would ask for one nothing can satisfy and
    // refuse every run. That is what `core` was until Phase 4; the routing map
    // is keyed on declaring modules now, and this is the assertion that the
    // deleted rename is not needed rather than merely absent.
    const declaring = declaringBundleDirectories(DECLARED_ERROR_TRANSLATION_TARGETS);
    expect(declaring.length).toBeGreaterThan(0);
    expect(declaring).toContain('_i18n');
    expect(declaring).not.toContain('core');
  });

  it('derives the exclusion rather than taking one, on the real routing map', () => {
    const declaring = declaringBundleDirectories(DECLARED_ERROR_TRANSLATION_TARGETS);
    // The dual, over the map the CLI actually uses: every declaring module stays
    // inside the floor and only the one that declares nothing falls out of it.
    // An exclusion that quietly covered everything would switch the floor off
    // while every run still looked normal.
    expect(
      nonDeclaringModules(DECLARED_ERROR_TRANSLATION_TARGETS, [
        ...declaring,
        'zz_declares_nothing',
      ]),
    ).toEqual(['zz_declares_nothing']);
  });
});

/**
 * P3 — the two-way reconciliation of `ERROR_CODES` against the declarations
 * (FR-031), and P4's report.
 *
 * These are what the deleted prefix chain used to make unnecessary and
 * unavailable at once: its last line was `return 'core'`, so a code nobody
 * thought about was routed and silently untranslated forever, and there was
 * nothing to reconcile because the table was generated from the enumeration
 * itself. Each proof hands the reconciliation a routing map and an enumeration
 * that disagree — the top of the analysis, the only input it has.
 */
describe('the enumeration and the declarations, reconciled both ways', () => {
  it('reports an enumerated code no module declares, naming the code', () => {
    const findings = reconcileEnumeration({
      keys: { A_CODE: { moduleId: 'blog', key: 'errors.A_CODE' } },
      collisions: [],
      enumeratedCodes: ['A_CODE', 'B_CODE'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'B_CODE', kind: 'undeclared-enum-member' });
    // Naming the code is the requirement, not merely failing: the chain's
    // fall-through is what this replaces, and "something is undeclared" would
    // send its reader to read 289 manifest lines.
    expect(findings[0]?.repair).toContain("{ code: 'B_CODE' }");
  });

  it('reports a declared code the enumeration does not hold, naming the module', () => {
    const findings = reconcileEnumeration({
      keys: {
        A_CODE: { moduleId: 'blog', key: 'errors.A_CODE' },
        B_CODE: { moduleId: 'catalog', key: 'errors.B_CODE' },
      },
      collisions: [],
      enumeratedCodes: ['A_CODE'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'B_CODE',
      kind: 'undeclared-in-enum',
      moduleId: 'catalog',
    });
  });

  it('counts a contested code as declared, so P4 reports it and P3 does not', () => {
    // Two findings for one code would send its author to add a declaration that
    // already exists twice, which is the opposite of the repair.
    const findings = reconcileEnumeration({
      keys: {},
      collisions: [
        {
          code: 'A_CODE',
          claims: [
            { moduleId: 'blog', declaredIn: '/blog/manifest.ts' },
            { moduleId: 'cms', declaredIn: '/cms/manifest.ts' },
          ],
        },
      ],
      enumeratedCodes: ['A_CODE'],
    });
    expect(findings).toEqual([]);
  });

  it('says nothing when the two agree', () => {
    expect(
      reconcileEnumeration({
        keys: { A_CODE: { moduleId: 'blog', key: 'errors.A_CODE' } },
        collisions: [],
        enumeratedCodes: ['A_CODE'],
      }),
    ).toEqual([]);
  });

  it('the tree agrees in both directions, over the real declarations', () => {
    // Phase 3 declared all 289 members of `ERROR_CODES` across eighteen
    // modules, so both directions are empty here — and this is the assertion
    // that stops the next code being added to one side alone.
    expect(
      reconcileEnumeration({
        keys: DECLARED_ERROR_TRANSLATION_TARGETS,
        collisions: [],
        enumeratedCodes: Object.values(ERROR_CODES),
      }),
    ).toEqual([]);
  });
});

/**
 * P6 (issue #83, slice 2) — **every token a code is raised with has a sentence
 * in both languages**.
 *
 * The envelope composes one key per raise: `errors.<CODE>.<token>` when the
 * raise carries a `details.code`, `errors.<CODE>` when it does not, and it
 * never falls back from the first to the second (D-190). P1 asks only at the
 * base key, so a token added at a raise site without its sentence rendered the
 * thrower's English in every language while the check stayed green.
 *
 * Every proof enters at the top: source text and bundles in, findings out.
 */
describe('findUntranslatedTokens — a refusal token with no sentence', () => {
  const ROUTED_TO_A = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;
  const BASE = {
    'a.en': { 'errors.X_REFUSED': 'Refused.' },
    'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
  };
  const source = (text: string): SourceFile => ({ path: 'a/src/backend/service.ts', text });

  it('token-untranslated — a literal token at a raise site, in neither bundle', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [
        source(
          "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'Too late.', { code: 'too_late' });",
        ),
      ],
    });
    const findings = findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED'])));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'X_REFUSED',
      token: 'too_late',
      moduleId: 'a',
      key: 'errors.X_REFUSED.too_late',
      missingIn: ['en', 'pl'],
      raisedAt: ['a/src/backend/service.ts:1'],
      declared: false,
    });
  });

  it('token-untranslated — written in one language only', () => {
    const tree = fixture(
      ROUTED_TO_A,
      { ...BASE, 'a.en': { ...BASE['a.en'], 'errors.X_REFUSED.too_late': 'It is too late for that.' } },
      {
        sources: [
          source("throw new HttpError(409, 'X_REFUSED', 'Too late.', { code: 'too_late', at: 1 });"),
        ],
      },
    );
    const findings = findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED'])));
    expect(findings.map((f) => `${f.key} ${f.missingIn.join(',')}`)).toEqual([
      'errors.X_REFUSED.too_late pl',
    ]);
  });

  it('token-untranslated — a token only the manifest declares, for a raise the read cannot spell', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      declaredTokens: { X_REFUSED: ['too_late'] },
      sources: [
        source(
          'function refuse(rule: string) {\n' +
            "  return new HttpError(422, ERROR_CODES.X_REFUSED, 'Refused.', { rule, code: rule });\n" +
            '}',
        ),
      ],
    });
    const raises = readRaiseSites(tree.listSources(), new Set(['X_REFUSED']));
    expect(raises.unresolvedTokens.map((r) => `${r.code} ${r.site}`)).toEqual([
      'X_REFUSED a/src/backend/service.ts:2',
    ]);
    const findings = findUntranslatedTokens(tree, raises);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ token: 'too_late', raisedAt: [], declared: true });
  });

  it('token-untranslated — both branches of a conditional token', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [
        source(
          "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { code: late ? 'too_late' : 'too_early' });",
        ),
      ],
    });
    const findings = findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED'])));
    expect(findings.map((f) => f.token)).toEqual(['too_early', 'too_late']);
  });

  /**
   * The discrimination fixtures. A predicate that reported every raise, every
   * `code:` property or every token of every code would pass the proofs above.
   */
  it('says nothing about a token that has its sentence in both bundles', () => {
    const tree = fixture(
      ROUTED_TO_A,
      {
        'a.en': { ...BASE['a.en'], 'errors.X_REFUSED.too_late': 'It is too late for that.' },
        'a.pl': { ...BASE['a.pl'], 'errors.X_REFUSED.too_late': 'Na to jest już za późno.' },
      },
      {
        declaredTokens: { X_REFUSED: ['too_late'] },
        sources: [
          source("throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { code: 'too_late' });"),
        ],
      },
    );
    expect(
      findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED']))),
    ).toEqual([]);
  });

  it('says nothing about a raise with no token, a Zod-style array, or a `code` that is not in details', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [
        source(
          [
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm');",
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', [{ path: 'a', issue: 'b' }]);",
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { reason: 'too_late' });",
            "const row = { code: 'too_late' };",
          ].join('\n'),
        ),
      ],
    });
    expect(
      findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED']))),
    ).toEqual([]);
  });

  it('says nothing about a VALIDATION_FAILED token — the envelope never translates that code', () => {
    const tree = fixture(
      { VALIDATION_FAILED: { moduleId: 'a', key: 'errors.VALIDATION_FAILED' } },
      { 'a.en': { 'errors.VALIDATION_FAILED': 'Invalid.' }, 'a.pl': { 'errors.VALIDATION_FAILED': 'Błąd.' } },
      {
        sources: [
          source("throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'sku_in_use', { code: 'sku_in_use' });"),
        ],
      },
    );
    expect(
      findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['VALIDATION_FAILED']))),
    ).toEqual([]);
  });

  it('says nothing about a token on a code no module routes — that is P3 s finding', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [source("throw new HttpError(409, 'Y_REFUSED', 'm', { code: 'too_late' });")],
    });
    expect(
      findUntranslatedTokens(tree, readRaiseSites(tree.listSources(), new Set(['X_REFUSED', 'Y_REFUSED']))),
    ).toEqual([]);
  });

  it('exits 1 on a P6 finding, and the summary counts it', () => {
    const result = analyse(
      fixture(ROUTED_TO_A, BASE, {
        sources: [
          source("throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { code: 'too_late' });"),
        ],
      }),
    );
    expect(result.tokens.map((f) => f.key)).toEqual(['errors.X_REFUSED.too_late']);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('tokenUntranslated=1');
  });
});

/**
 * P6's other half (issue #83, the maintainer's ruling of 2026-10-30): **a code
 * raised with a computed token declares its tokens**.
 *
 * A raise whose `details.code` the static read cannot spell — a variable, a
 * details object built elsewhere, a spread — draws its token from a set only
 * the manifest's `tokens` can state. Slice 2 counted such a raise and judged
 * nothing; a code with no declaration then had no token set to check its
 * bundle against, so a new token added behind the variable rendered the
 * thrower's English with the check green.
 */
describe('findUndeclaredTokenRaises — a computed token with no declared set', () => {
  const ROUTED_TO_A = { X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' } } as const;
  const BASE = {
    'a.en': { 'errors.X_REFUSED': 'Refused.' },
    'a.pl': { 'errors.X_REFUSED': 'Odmowa.' },
  };
  const COMPUTED =
    'function refuse(rule: string) {\n' +
    "  return new HttpError(422, ERROR_CODES.X_REFUSED, 'Refused.', { rule, code: rule });\n" +
    '}\n' +
    "export const again = (details: object) => new HttpError(422, 'X_REFUSED', 'm', details);";
  const source = (text: string): SourceFile => ({ path: 'a/src/backend/service.ts', text });

  it('token-undeclared — a computed token on a code whose manifest names no tokens', () => {
    const tree = fixture(ROUTED_TO_A, BASE, { sources: [source(COMPUTED)] });
    const findings = findUndeclaredTokenRaises(
      tree,
      readRaiseSites(tree.listSources(), new Set(['X_REFUSED'])),
    );
    expect(findings).toEqual([
      {
        code: 'X_REFUSED',
        moduleId: 'a',
        sites: ['a/src/backend/service.ts:2', 'a/src/backend/service.ts:4'],
      },
    ]);
  });

  it('with tokens declared, the per-token bundle check applies instead', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      declaredTokens: { X_REFUSED: ['too_late'] },
      sources: [source(COMPUTED)],
    });
    const raises = readRaiseSites(tree.listSources(), new Set(['X_REFUSED']));
    expect(findUndeclaredTokenRaises(tree, raises)).toEqual([]);
    expect(findUntranslatedTokens(tree, raises).map((f) => f.key)).toEqual([
      'errors.X_REFUSED.too_late',
    ]);
  });

  it('says nothing about a literal token, a tokenless raise, VALIDATION_FAILED or an unrouted code', () => {
    const tree = fixture(
      { ...ROUTED_TO_A, VALIDATION_FAILED: { moduleId: 'a', key: 'errors.VALIDATION_FAILED' } },
      BASE,
      {
        sources: [
          source(
            [
              "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { code: 'too_late' });",
              "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm');",
              "throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'm', { code: reason });",
              "throw new HttpError(409, 'Y_REFUSED', 'm', { code: reason });",
            ].join('\n'),
          ),
        ],
      },
    );
    const raises = readRaiseSites(
      tree.listSources(),
      new Set(['X_REFUSED', 'VALIDATION_FAILED', 'Y_REFUSED']),
    );
    expect(raises.unresolvedTokens).toHaveLength(2);
    expect(findUndeclaredTokenRaises(tree, raises)).toEqual([]);
  });

  it('with tokens: [] declared, a computed details that never carries a code passes', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      declaredTokens: { X_REFUSED: [] },
      sources: [
        source(
          'function refuse(message: string, details?: Record<string, unknown>) {\n' +
            "  return new HttpError(409, ERROR_CODES.X_REFUSED, message, details);\n" +
            '}',
        ),
      ],
    });
    const raises = readRaiseSites(tree.listSources(), new Set(['X_REFUSED']));
    expect(raises.unresolvedTokens).toHaveLength(1);
    expect(findUndeclaredTokenRaises(tree, raises)).toEqual([]);
    expect(findUntranslatedTokens(tree, raises)).toEqual([]);
  });

  it('keeps an empty tokens declaration — it is a statement, not an absence', () => {
    const declared = declaredTokensOf(
      [
        {
          filePath: 'a/src/manifest.ts',
          manifest: {
            id: 'a',
            errorCodes: [{ code: 'X_REFUSED', tokens: [] }, { code: 'Y_REFUSED' }],
          },
        },
      ],
      {
        X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' },
        Y_REFUSED: { moduleId: 'a', key: 'errors.Y_REFUSED' },
      },
    );
    expect(declared).toEqual({ X_REFUSED: [] });
  });

  /**
   * The ruling makes every unresolved raise owe a declaration, so a shape the
   * read can decide must be decided rather than sent to the manifest.
   */
  it('sees through the shapes that decide themselves — .map(), a conditional, a spread, a local const', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [
        source(
          [
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', rows.map((r) => ({ path: r, issue: 'x' })));",
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', id ? { id } : undefined);",
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { a, ...(lang ? { lang } : {}) });",
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { a, ...(none ? { code: 'too_late' } : {}) });",
            'function f() {',
            "  const details = [...rows.map((r) => ({ path: 'slug', issue: r }))];",
            "  throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', details);",
            '}',
          ].join('\n'),
        ),
      ],
    });
    const raises = readRaiseSites(tree.listSources(), new Set(['X_REFUSED']));
    expect(raises.unresolvedTokens).toEqual([]);
    expect(raises.tokened.map((r) => r.token)).toEqual(['too_late']);
  });

  it('does not follow a const a parameter shadows, nor a spread of a value it cannot see', () => {
    const tree = fixture(ROUTED_TO_A, BASE, {
      sources: [
        source(
          [
            'const details = [];',
            'function f(details: object) {',
            "  throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', details);",
            '}',
            "throw new HttpError(409, ERROR_CODES.X_REFUSED, 'm', { ...err.details });",
          ].join('\n'),
        ),
      ],
    });
    const raises = readRaiseSites(tree.listSources(), new Set(['X_REFUSED']));
    expect(raises.unresolvedTokens.map((r) => r.expression)).toEqual(['details', '...err.details']);
  });

  it('exits 1 on a token-undeclared finding, and the summary counts it', () => {
    const result = analyse(fixture(ROUTED_TO_A, BASE, { sources: [source(COMPUTED)] }));
    expect(result.undeclaredTokens.map((f) => f.code)).toEqual(['X_REFUSED']);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain('tokenUndeclared=1');

    const declared = analyse(
      fixture(
        ROUTED_TO_A,
        {
          'a.en': { ...BASE['a.en'], 'errors.X_REFUSED.too_late': 'It is too late for that.' },
          'a.pl': { ...BASE['a.pl'], 'errors.X_REFUSED.too_late': 'Na to jest już za późno.' },
        },
        { declaredTokens: { X_REFUSED: ['too_late'] }, sources: [source(COMPUTED)] },
      ),
    );
    expect(declared.exitCode).toBe(0);
    expect(declared.summary).toContain('tokenUndeclared=0');
  });

  it('a code whose token set cannot be declared is ledgered, two-way', () => {
    const tree = (): TranslationInput => fixture(ROUTED_TO_A, BASE, { sources: [source(COMPUTED)] });
    const ledgered = analyse(tree(), new Set(), new Set(), new Set(['X_REFUSED']));
    expect(ledgered.undeclaredTokensUnledgered).toEqual([]);
    expect(ledgered.exitCode).toBe(0);
    expect(ledgered.summary).toContain('tokenUndeclared=0 tokenUndeclaredLedgered=1 tokenUndeclaredStale=0');

    // The entry goes stale once the code declares its tokens.
    const stale = analyse(
      fixture(ROUTED_TO_A, BASE, { declaredTokens: { X_REFUSED: [] }, sources: [source(COMPUTED)] }),
      new Set(),
      new Set(),
      new Set(['X_REFUSED']),
    );
    expect(stale.undeclaredTokensStale).toEqual(['X_REFUSED']);
    expect(stale.exitCode).toBe(1);
  });

  it('names a real code in every ledger entry', () => {
    for (const code of UNDECLARABLE_TOKEN_ERROR_CODES) {
      expect(code, `${code} is not a code name`).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

/**
 * P7 (issue #83, slice 3) — **a declared code something names**.
 *
 * A code can be enumerated, declared and translated in both languages while no
 * source file spells it. The read is deliberately wide — any string literal or
 * property name that is the code counts — so a finding is a code that nothing
 * outside its declaration can possibly raise.
 */
describe('findUnraisedCodes — a declared code nothing names', () => {
  const ROUTED = {
    X_REFUSED: { moduleId: 'a', key: 'errors.X_REFUSED' },
    Y_REFUSED: { moduleId: 'a', key: 'errors.Y_REFUSED' },
  } as const;
  const BUNDLES = {
    'a.en': { 'errors.X_REFUSED': 'Refused.', 'errors.Y_REFUSED': 'Refused too.' },
    'a.pl': { 'errors.X_REFUSED': 'Odmowa.', 'errors.Y_REFUSED': 'Też odmowa.' },
  };
  const codes = new Set(['X_REFUSED', 'Y_REFUSED']);

  it('unraised — a declared, translated code no source file names', () => {
    const tree = fixture(ROUTED, BUNDLES, { sources: [raising(['X_REFUSED'])] });
    expect(findUnraisedCodes(tree, readRaiseSites(tree.listSources(), codes))).toEqual(['Y_REFUSED']);
  });

  it('unraised — a code named only in a comment is still named by nothing', () => {
    const tree = fixture(ROUTED, BUNDLES, {
      sources: [
        raising(['X_REFUSED']),
        { path: 'a/src/backend/notes.ts', text: '// Y_REFUSED is raised elsewhere.\n/** `Y_REFUSED` */\nexport {};' },
      ],
    });
    expect(findUnraisedCodes(tree, readRaiseSites(tree.listSources(), codes))).toEqual(['Y_REFUSED']);
  });

  it('counts every spelling a raise can take — a literal, ERROR_CODES.X, a class field', () => {
    const tree = fixture(ROUTED, BUNDLES, {
      sources: [
        { path: 'a.ts', text: "throw new HttpError(409, 'X_REFUSED', 'm');" },
        { path: 'b.ts', text: "class Refusal extends Error { readonly code = 'Y_REFUSED' as const; }" },
      ],
    });
    expect(findUnraisedCodes(tree, readRaiseSites(tree.listSources(), codes))).toEqual([]);
  });

  it('unraised — a code spelled only in a vocabulary, which declares it and raises nothing', () => {
    // `ERROR_CODES` and the contracts package's `<X>_ERROR_CODES` lists spell
    // every code once; counting that spelling would make every code its own
    // raise site, the way counting a manifest's `errorCodes` would.
    const tree = fixture(ROUTED, BUNDLES, {
      sources: [
        raising(['X_REFUSED']),
        {
          path: 'contracts/src/errors.ts',
          text:
            "export const ERROR_CODES = { X_REFUSED: 'X_REFUSED', Y_REFUSED: 'Y_REFUSED' } as const;\n" +
            "export const BLOG_ERROR_CODES = ['Y_REFUSED'] as const;",
        },
      ],
    });
    expect(findUnraisedCodes(tree, readRaiseSites(tree.listSources(), codes))).toEqual(['Y_REFUSED']);
  });

  it('exits 1 on an unledgered unraised code, and on a ledger entry the tree now names', () => {
    const unraised = analyse(fixture(ROUTED, BUNDLES, { sources: [raising(['X_REFUSED'])] }));
    expect(unraised.unraisedUnledgered).toEqual(['Y_REFUSED']);
    expect(unraised.exitCode).toBe(1);
    expect(unraised.summary).toContain('unraised=1');

    const ledgered = analyse(
      fixture(ROUTED, BUNDLES, { sources: [raising(['X_REFUSED'])] }),
      new Set(),
      new Set(['Y_REFUSED']),
    );
    expect(ledgered.exitCode).toBe(0);
    expect(ledgered.summary).toContain('unraised=0 unraisedLedgered=1');

    const stale = analyse(fixture(ROUTED, BUNDLES), new Set(), new Set(['Y_REFUSED']));
    expect(stale.unraisedStale).toEqual(['Y_REFUSED']);
    expect(stale.exitCode).toBe(1);
  });

  it('exits 2 when the raise walk opened nothing, or named no declared code at all', () => {
    const empty = analyse(fixture(ROUTED, BUNDLES, { sources: [] }));
    expect(empty.exitCode).toBe(2);
    expect(empty.summary).toMatch(/raise walk opened no source file/);

    const blind = analyse(
      fixture(ROUTED, BUNDLES, { sources: [{ path: 'a.ts', text: 'export const x = 1;' }] }),
    );
    expect(blind.exitCode).toBe(2);
    expect(blind.summary).toMatch(/raise walk named no declared code/);
  });

  it('names a real code in every ledger entry', () => {
    for (const code of UNRAISED_ERROR_CODES) {
      expect(code, `${code} is not a code name`).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe('the tree itself, under P6 and P7', () => {
  it('ships a sentence for every token a code is raised with', async () => {
    const result = await analysedTree();
    expect(result.tokens.map((f) => `${f.key} → ${f.moduleId} (${f.missingIn.join(', ')})`)).toEqual([]);
  }, 120_000);

  it('declares the token set of every code raised with a computed token', async () => {
    const result = await analysedTree();
    expect(
      result.undeclaredTokensUnledgered.map((f) => `${f.code} → ${f.moduleId} (${f.sites.join(', ')})`),
    ).toEqual([]);
    expect(result.undeclaredTokensStale).toEqual([]);
  }, 120_000);

  it('raises every declared code that is not ledgered, and the ledger is not stale', async () => {
    const result = await analysedTree();
    expect(result.unraisedUnledgered).toEqual([]);
    expect(result.unraisedStale).toEqual([]);
    // The walk read a real tree while doing so.
    expect(result.raises.files).toBeGreaterThan(100);
    expect(result.raises.references.size).toBeGreaterThan(100);
  }, 120_000);
});
