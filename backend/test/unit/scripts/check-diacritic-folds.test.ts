import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  analyzeFile,
  analyzeSource,
  checkDiacriticFolds,
  collapsesSeparatorRun,
  DIACRITIC_FOLDS_ALLOWED,
  EXCLUDED_SUBTREES,
  findDiacriticFolds,
  helperIsStillTheOwner,
  isDiacriticPattern,
  isScannablePath,
  negatedAsciiClass,
  POPULATION_ROOTS,
  SHARED_FOLD_HELPER,
  SLUG_RUNS_ALLOWED,
  type ScannedFile,
} from '../../../scripts/check-diacritic-folds.js';

/**
 * Companion test for `check-diacritic-folds` (issue #240).
 *
 * The check exists because the wrong answer looks like the right one:
 * `normalize('NFD').replace(/\p{Diacritic}/gu, '')` is a complete-looking
 * one-liner that silently does nothing to `ł`, and four authors wrote it
 * independently inside a year. So the shapes asserted here are the ones a
 * narrowing would quietly stop seeing — the `NFKD` spelling, the block range
 * written as raw combining characters, a strip with no decomposition beside it
 * — plus the exclusions, proven as *discriminations* so that widening one by
 * accident shows up as a red test rather than as a smaller number.
 *
 * The population is the whole tree since issue #240 extracted `foldDiacritics`
 * into `@b2b/contracts`. Before that, `backend/`, `storefront/` and `packages/`
 * were excluded for a stated reason — none of them could import a helper that
 * lived in `admin/src` — and the discrimination below asserted their absence.
 * It now asserts the opposite for the same reason read forwards: a fold in any
 * of them is reported, because the shared one is an import away. What stays out
 * is the two subtrees whose job is to spell the refused shapes.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');
const TSX = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = join(BACKEND_ROOT, 'scripts', 'check-diacritic-folds.ts');
/** The shared read-size reporter the check imports (issue #244). */
const READ_SIZE_LIB = join(BACKEND_ROOT, 'scripts', 'lib', 'read-size.ts');
const TYPESCRIPT = join(BACKEND_ROOT, 'node_modules', 'typescript');

/** U+0300–U+036F written as the characters themselves, the way one backend slugifier does. */
const RAW_COMBINING_RANGE = `[${'̀'}-${'ͯ'}]`;

/** The shared helper, as it is on disk — the check's exemption and its self-test. */
const HELPER_SOURCE = readFileSync(join(REPO_ROOT, SHARED_FOLD_HELPER), 'utf8');

const file = (path: string, source: string): ScannedFile => ({ path, source });

/** Paths reported for a set of files — the shape a discrimination asserts. */
const foldPaths = (files: readonly ScannedFile[]): string[] =>
  [...new Set(findDiacriticFolds(files).map((finding) => finding.path))];

const temporaryRoots: string[] = [];

/**
 * The exact text of the ledger declaration in the checked-in script, so a
 * fixture can give the copy a non-empty one. Written out rather than matched
 * loosely: it is asserted before use, so a rename of the constant fails the
 * test that depends on it instead of quietly disabling it.
 */
const LEDGER_ANCHOR =
  'export const DIACRITIC_FOLDS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {};';

/**
 * The slug ledger's declaration in the checked-in script.
 *
 * The whole literal, not just its opening: it is empty since issue #260, so the
 * fixture substitutes exactly the way it does for the fold ledger above. It was
 * a span replacement while the two `pim_ergonode` key derivations stood in it.
 */
const SLUG_LEDGER_ANCHOR =
  'export const SLUG_RUNS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {};';

interface FixtureRepository {
  readonly root: string;
  write(path: string, source: string): void;
  run(): { status: number | null; output: string };
}

/**
 * A synthetic repository with a copy of the check inside it.
 *
 * The script derives its root from its own location — `<script>/../..` — so a
 * copy at `<tmp>/node_modules/scripts/` scans `<tmp>` and nothing else. The
 * `node_modules` level is the same choice `check-nul-bytes.test.ts` makes: it
 * is pruned by the walk, so the copy is not in its own population and an
 * untouched fixture really is an **empty** tree. Without that, the exit-2
 * guards would be assertable only as source text, which is the shape issue #113
 * is about. `typescript` is linked in because the analysis parses rather than
 * greps and the fixture has no install of its own.
 */
function fixtureRepository(
  options: {
    helper?: string | null;
    ledgered?: boolean;
    ledger?: string;
    slugLedger?: string;
  } = {},
): FixtureRepository {
  const root = mkdtempSync(join(tmpdir(), 'diacritic-folds-check-'));
  temporaryRoots.push(root);
  const checker = join(root, 'node_modules', 'scripts', 'check-diacritic-folds.ts');
  mkdirSync(dirname(checker), { recursive: true });
  copyFileSync(SCRIPT, checker);
  // The check imports the shared reporter by a relative path, so the copy needs
  // it beside itself or the fixture run dies at module resolution and every
  // exit code below reads as 1.
  mkdirSync(join(dirname(checker), 'lib'), { recursive: true });
  copyFileSync(READ_SIZE_LIB, join(dirname(checker), 'lib', 'read-size.ts'));
  symlinkSync(TYPESCRIPT, join(root, 'node_modules', 'typescript'), 'dir');
  if (options.ledger !== undefined) {
    // The real ledger is empty since issue #245, so the CLI can no longer be
    // driven into a stale finding by the tree alone — and the staleness
    // direction is half of what this check refuses. The copy's constant is
    // substituted instead. The anchor is asserted rather than replaced
    // best-effort: a substitution that silently matched nothing would leave a
    // green test that proves the opposite of what it claims (issue #113).
    const source = readFileSync(checker, 'utf8');
    if (!source.includes(LEDGER_ANCHOR)) {
      throw new Error(`the ledger constant no longer reads ${LEDGER_ANCHOR}`);
    }
    writeFileSync(
      checker,
      source.replace(LEDGER_ANCHOR, LEDGER_ANCHOR.replace('= {};', `= ${options.ledger};`)),
      'utf8',
    );
  }

  if (options.slugLedger !== undefined) {
    // Empty since issue #260, so the CLI can no longer be driven into a stale
    // slug finding by the tree alone — exactly the position the fold ledger has
    // been in since #245, and the substitution is the same. The anchor is
    // asserted rather than replaced best-effort: a substitution that silently
    // matched nothing would leave a green test that proves the opposite of what
    // it claims (issue #113).
    const source = readFileSync(checker, 'utf8');
    if (!source.includes(SLUG_LEDGER_ANCHOR)) {
      throw new Error(`the slug ledger constant no longer reads ${SLUG_LEDGER_ANCHOR}`);
    }
    writeFileSync(
      checker,
      source.replace(
        SLUG_LEDGER_ANCHOR,
        SLUG_LEDGER_ANCHOR.replace('= {};', `= ${options.slugLedger};`),
      ),
      'utf8',
    );
  }

  const write = (path: string, source: string): void => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, 'utf8');
  };

  // `undefined` means "the real helper"; `null` means "no helper at all".
  const helper = options.helper === undefined ? HELPER_SOURCE : options.helper;
  if (helper !== null) write(SHARED_FOLD_HELPER, helper);
  // The ledger is a compiled-in constant, so a fixture that omits the files it
  // names reports them as stale and can never reach exit 0. Copying them in is
  // not a workaround: it is the check's own two-way property, exercised. It
  // copies nothing while the real ledger is empty (issue #245) — which is why
  // `ledger` above exists, to keep the staleness exit code provable end to end.
  if (options.ledgered === true) {
    for (const path of [
      ...Object.keys(DIACRITIC_FOLDS_ALLOWED),
      ...Object.keys(SLUG_RUNS_ALLOWED),
    ]) {
      write(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
    }
  }

  return {
    root,
    write,
    run: () => {
      const result = spawnSync(TSX, [checker], { encoding: 'utf8' });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
  };
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe('check-diacritic-folds — what it refuses', () => {
  it('reports the NFD spelling of the one-liner four authors wrote', () => {
    // `PageBuilderDrawer.tsx` as it stood before !745, verbatim in shape.
    const found = analyzeSource(
      [
        'function normalize(input: string): string {',
        "  return input.normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase();",
        '}',
      ].join('\n'),
      'admin/src/modules/cms/components/PageBuilderDrawer.tsx',
    );
    expect(found.map((f) => f.kind)).toEqual(['decomposition', 'diacritic-strip']);
    expect(found[0]?.line).toBe(2);
  });

  it('reports the NFKD spelling, which a check grepping for NFD reads clean', () => {
    // `product_feeds/api.ts` is NFKD, not NFD — a whole second spelling of the
    // same defect, and the one this check was warned about by name.
    const found = analyzeSource(
      "export const slugify = (v: string) => v.normalize('NFKD');",
      'admin/src/modules/product_feeds/api.ts',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('decomposition');
    expect(found[0]?.literal).toBe('NFKD');
  });

  it('reports the `\\p{Diacritic}` property escape', () => {
    const found = analyzeSource(
      "const f = (v: string) => v.replace(/\\p{Diacritic}/gu, '');",
      'admin/src/components/ui/combobox.tsx',
    );
    expect(found.map((f) => f.kind)).toEqual(['diacritic-strip']);
  });

  it('reports the `\\u0300-\\u036f` block range', () => {
    const found = analyzeSource(
      "const f = (v: string) => v.replace(/[\\u0300-\\u036f]/g, '');",
      'admin/src/modules/newsletter/pages/TagsPage.tsx',
    );
    expect(found.map((f) => f.kind)).toEqual(['diacritic-strip']);
  });

  it('reports the same range written as raw combining characters', () => {
    // How `feed-template-io.service.ts` spells it. A grep for `\u0300` cannot
    // see that file at all, because the file contains no backslash-u in it.
    const found = analyzeSource(
      `const f = (v: string) => v.replace(/${RAW_COMBINING_RANGE}/g, '');`,
      'admin/src/lib/thing.ts',
    );
    expect(found.map((f) => f.kind)).toEqual(['diacritic-strip']);
  });

  it('reports a pattern built as a string for `new RegExp`', () => {
    const found = analyzeSource(
      "const marks = new RegExp('\\\\p{Diacritic}', 'gu');",
      'admin/src/lib/thing.ts',
    );
    expect(found.map((f) => f.kind)).toEqual(['diacritic-strip']);
  });

  it('reports a strip with no decomposition beside it, because half a fold is still a fold', () => {
    // The rule deliberately has no proximity window: a fold split over two
    // functions — or two files — would escape one, and each half alone is still
    // a second implementation of the thing that has one owner.
    const found = analyzeSource(
      [
        'export function stripMarks(v: string): string {',
        "  return v.replace(/\\p{Diacritic}/gu, '');",
        '}',
      ].join('\n'),
      'admin/src/lib/marks.ts',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('diacritic-strip');
  });

  it('reports a fold in an admin test, which can import the helper just as easily', () => {
    expect(
      analyzeSource(
        "const expected = label.normalize('NFD');",
        'admin/test/components/picker.test.tsx',
      ),
    ).toHaveLength(1);
  });
});

describe('check-diacritic-folds — what it does not refuse', () => {
  it('cannot see the one-liner quoted in a comment, while still reporting the code beside it', () => {
    // Four files in this tree quote the wrong one-liner on purpose — the
    // helper's header, `AppShell.tsx`, and two admin tests — to say why they do
    // not use it. A text-level check reports all four and is switched off within
    // a week. Written as a discrimination: "no finding" is green when the check
    // is blind, so the assertion is that exactly the code line comes back.
    const source = [
      '/**',
      " * The obvious `normalize('NFD').replace(/\\p{Diacritic}/gu, '')` is wrong:",
      " * `ł` does not decompose. `NFKD` is no better. Use `[\\u0300-\\u036f]`? Also no.",
      ' */',
      "// A line comment naming normalize('NFD') too.",
      "export const real = (v: string) => v.normalize('NFKD');",
    ].join('\n');
    const found = analyzeSource(source, 'admin/src/components/AppShell.tsx');
    expect(found).toHaveLength(1);
    expect(found[0]?.literal).toBe('NFKD');
    expect(found[0]?.line).toBe(6);
  });

  it('leaves the composing normalization forms alone while reporting the decomposing one', () => {
    // `NFC` and `NFKC` compose; they never expose the combining marks a fold
    // goes on to strip, so they are outside the rule rather than exempt from it.
    const found = analyzeSource(
      [
        "const a = v.normalize('NFC');",
        "const b = v.normalize('NFKC');",
        "const c = v.normalize('NFD');",
      ].join('\n'),
      'admin/src/lib/thing.ts',
    );
    expect(found.map((f) => f.line)).toEqual([3]);
  });

  it('leaves the shared helper alone while reporting a copy of it, by path and not by name', () => {
    // Issue #197's lesson: a name-shaped exemption can be satisfied by a second
    // file, which is exactly the failure this check exists to prevent. The
    // decoy is named `text-normalization.ts` and is reported anyway.
    const decoy = 'admin/src/modules/cms/text-normalization.ts';
    expect(
      foldPaths([
        file(SHARED_FOLD_HELPER, HELPER_SOURCE),
        file(decoy, "export const n = (v: string) => v.normalize('NFD');"),
      ]),
    ).toEqual([decoy]);
  });

  it('reports a fold in every package that can import the shared one', () => {
    // The widening, as a discrimination. Each of these was excluded before
    // issue #240 for one reason — no shared fold was reachable from it — and
    // each is in now for the same reason read forwards. Narrowing a root back
    // turns this red rather than reporting a smaller number.
    const naive = "export const s = (v: string) => v.normalize('NFKD').replace(/\\p{Diacritic}/gu, '');";
    expect(
      foldPaths([
        file('backend/src/modules/catalog/services/catalog-admin.service.ts', naive),
        file('packages/api-client/src/search.ts', naive),
        file('storefront/lib/search.ts', naive),
        file('admin/src/lib/thing.ts', naive),
      ]),
    ).toEqual([
      'admin/src/lib/thing.ts',
      'backend/src/modules/catalog/services/catalog-admin.service.ts',
      'packages/api-client/src/search.ts',
      'storefront/lib/search.ts',
    ]);
  });

  it('leaves the checks and their fixtures alone while reporting a backend module', () => {
    // The two subtrees that must be able to spell what the rule refuses: this
    // check, and the tests that prove it still sees each shape. They are exact
    // path prefixes rather than a `scripts` name rule, so a module directory
    // called `scripts` cannot exempt itself.
    const naive = "export const s = (v: string) => v.normalize('NFKD').replace(/\\p{Diacritic}/gu, '');";
    expect(
      foldPaths([
        file('backend/scripts/check-diacritic-folds.ts', naive),
        file('backend/test/unit/scripts/check-inventory.test.ts', naive),
        file('backend/src/modules/catalog/scripts/reindex.ts', naive),
      ]),
    ).toEqual(['backend/src/modules/catalog/scripts/reindex.ts']);
  });

  it('leaves a build artefact alone while reporting its source', () => {
    expect(
      foldPaths([
        file('admin/src/dist/bundle.ts', "v.normalize('NFD');"),
        file('admin/src/node_modules/dep/index.ts', "v.normalize('NFD');"),
        file('admin/src/lib/thing.ts', "v.normalize('NFD');"),
      ]),
    ).toEqual(['admin/src/lib/thing.ts']);
  });

  it('leaves a file that imports the shared helper alone', () => {
    expect(
      analyzeSource(
        [
          "import { normalize } from '@/lib/text-normalization';",
          'export const match = (q: string, h: string) => normalize(h).includes(normalize(q));',
        ].join('\n'),
        'admin/src/components/ui/combobox.tsx',
      ),
    ).toEqual([]);
  });

  it('reads path segments, so a file named like a pruned directory stays in the population', () => {
    expect(isScannablePath('admin/src/lib/dist.ts')).toBe(true);
    expect(isScannablePath('admin/src/dist/bundle.ts')).toBe(false);
    expect(isScannablePath('storefront/.next/types/route.ts')).toBe(false);
    expect(isScannablePath('admin/src/lib/text-normalization.md')).toBe(false);
    expect(isScannablePath(SHARED_FOLD_HELPER)).toBe(false);
    // The admin file of the same name is in the population and passes because
    // it imports the fold instead of writing one — the exemption is one path.
    expect(isScannablePath('admin/src/lib/text-normalization.ts')).toBe(true);
    expect(isScannablePath('backend/scripts/check-diacritic-folds.ts')).toBe(false);
    expect(isScannablePath('backend/src/modules/catalog/services/x.ts')).toBe(true);
    // Neither trees outside the four roots nor non-source files.
    expect(isScannablePath('specs/067-product-feed/contracts/product-feeds.contracts.ts')).toBe(
      false,
    );
  });
});

describe('check-diacritic-folds — the pattern vocabulary', () => {
  it.each([
    ['\\p{Diacritic}', true],
    ['\\p{Mn}', true],
    ['\\p{Nonspacing_Mark}', true],
    ['\\p{M}', true],
    ['\\p{InCombiningDiacriticalMarks}', true],
    ['[\\u0300-\\u036f]', true],
    ['[\\u0300-\\u036F]', true],
    ['[\\u{300}-\\u{36f}]', true],
    [RAW_COMBINING_RANGE, true],
    ['[^a-z0-9]+', false],
    ['\\p{L}', false],
    ['^-+|-+$', false],
  ])('classifies %s', (pattern, expected) => {
    expect(isDiacriticPattern(pattern)).toBe(expected);
  });
});

/**
 * The third signal (issue #244), and why its proofs look different.
 *
 * The first two signals have a population defined by the presence of the thing
 * they check: a site that folds nothing writes no `NFD` and no `\p{Diacritic}`,
 * so its **absence** is undetectable. Two slug builders shipped that way for a
 * year while the check printed `violations=0`.
 *
 * So this signal keys on the slug builder itself, which is present whether or
 * not the site folds — and that is what the load-bearing proof below asserts: a
 * builder that folds **correctly** is reported just the same. A predicate that
 * only reported the unfolded ones would be the old blindness with an extra step.
 *
 * Every proof enters at `analyzeSource`, with source text, which is the top of
 * the analysis (issue #130). The discriminations matter as much as the red ones
 * here: this predicate's whole claim is that its population is honest, and the
 * five sanitisers below are the measured shapes that would make it a ledger of
 * exceptions if it matched them.
 */
describe('check-diacritic-folds — the slug run', () => {
  const slugRuns = (source: string, path = 'admin/src/modules/x/thing.ts'): string[] =>
    analyzeSource(source, path)
      .filter((finding) => finding.kind === 'slug-run')
      .map((finding) => finding.literal);

  it('reports a slug builder with no fold step at all — the shape nothing could see', () => {
    // `cms-template-layout.ts`'s `codeFromTemplateName`, verbatim in shape, as
    // it stood on `master` until issue #245. Measured output: `Łatwy szablon`
    // produced `atwy-szablon` and `Żółw` produced `w`.
    expect(
      slugRuns(
        'export const codeFromTemplateName = (name: string): string =>\n' +
          "  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
      ),
    ).toEqual(['[^a-z0-9]+']);
  });

  it('reports a slug builder that folds correctly, because the rule is about the builder', () => {
    // **The load-bearing proof.** `BlogPostEditor`'s local `slugify` folded via
    // the admin `normalize` and was still the ninth private copy of a generator
    // that has one owner. If this came back empty, the signal would be keyed on
    // the missing fold — which is unobservable, and is the whole of issue #244.
    expect(
      slugRuns(
        "import { normalize } from '@/lib/text-normalization';\n" +
          'function slugify(input: string): string {\n' +
          "  return normalize(input).replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 160);\n" +
          '}',
      ),
    ).toEqual(['[^a-z0-9]+']);
  });

  it('reports the run collapsed in a second move later in the same chain', () => {
    // `pim_ergonode`'s `sanitiseSourceCode`. The class carries no quantifier, so
    // a predicate reading one expression node in isolation clears it; the run is
    // collapsed by the `/_{2,}/g` that follows it in the same chain.
    expect(
      slugRuns(
        'export function sanitiseSourceCode(sourceCode: string): string {\n' +
          '  return sourceCode\n' +
          '    .toLowerCase()\n' +
          "    .replace(/[^a-z0-9_]/g, '_')\n" +
          "    .replace(/_{2,}/g, '_')\n" +
          "    .replace(/^[^a-z]+/, '');\n" +
          '}',
      ),
    ).toEqual(['[^a-z0-9_]']);
  });

  it('reports the mixed-case and explicit-range spellings of the class', () => {
    expect(slugRuns("export const a = (v: string) => v.replace(/[^a-zA-Z0-9]+/g, '-');")).toEqual([
      '[^a-zA-Z0-9]+',
    ]);
    expect(slugRuns("export const b = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, '-');")).toEqual([
      '[^A-Za-z0-9_-]+',
    ]);
  });

  it('reports the `\\w` shorthand, which names the same ASCII set without a range', () => {
    // A class-range grep reads `[^\w]+` clean, and it deletes `ł` exactly as
    // `[^a-z0-9]+` does.
    expect(slugRuns("export const a = (v: string) => v.replace(/[^\\w]+/g, '-');")).toEqual([
      '[^\\w]+',
    ]);
  });

  it('reports a braced run quantifier, not only `+`', () => {
    expect(slugRuns("export const a = (v: string) => v.replace(/[^a-z0-9]{2,}/g, '-');")).toEqual([
      '[^a-z0-9]{2,}',
    ]);
  });

  it('reports a pattern built as a string for `new RegExp`', () => {
    expect(
      slugRuns("export const a = (v: string) => v.replace(new RegExp('[^a-z0-9]+', 'g'), '-');"),
    ).toEqual(['[^a-z0-9]+']);
  });

  it('reports a separator held in a variable, which is how the generator itself writes it', () => {
    // `slugify` spells it `.replace(/[^a-z0-9]+/g, separator)`. A copy of it
    // would too, and a predicate requiring a string literal there would clear
    // the closest possible imitation of the file it is protecting.
    expect(
      slugRuns(
        'export function slug(v: string, separator: string): string {\n' +
          '  return v.replace(/[^a-z0-9]+/g, separator);\n' +
          '}',
      ),
    ).toEqual(['[^a-z0-9]+']);
  });

  it('reads an escaped `]` inside the class instead of stopping at it', () => {
    // `[^\]a-z0-9]+` is legal. A naive `\[\^[^\]]*\]` stops at the escaped
    // bracket, reads the class as holding no ranges, and clears the site.
    expect(slugRuns("export const a = (v: string) => v.replace(/[^\\]a-z0-9]+/g, '-');")).toEqual([
      '[^\\]a-z0-9]+',
    ]);
  });

  it('cannot see a slug run quoted in a comment, while still reporting the code below it', () => {
    // The same anchoring the fold signals have: three files in this tree quote
    // the wrong chain in a doc block to explain what they used to do, and a
    // text-level predicate reports the documentation written to prevent the
    // defect. Exactly the code line comes back.
    const source = [
      '/**',
      " * The chain this carried was `name.toLowerCase().replace(/[^a-z0-9]+/g, '-')`,",
      ' * which deleted every non-ASCII letter.',
      ' */',
      "import { slugify } from '@b2b/contracts';",
      'export const code = (name: string): string => slugify(name, { maxLength: 80 });',
    ].join('\n');
    expect(slugRuns(source)).toEqual([]);
  });

  it('leaves the shared generator alone by path, and reports the same chain elsewhere', () => {
    // Issue #197's lesson, applied to the third signal: the exemption is one
    // exact path, so a copy of `slugify` in another file is a violation however
    // it is named.
    const generator =
      "export function slugify(input: string, separator = '-'): string {\n" +
      '  return foldDiacritics(input).replace(/[^a-z0-9]+/g, separator);\n' +
      '}';
    expect(findDiacriticFolds([file(SHARED_FOLD_HELPER, generator)])).toEqual([]);
    expect(
      findDiacriticFolds([file('admin/src/lib/text-normalization.ts', generator)]).map(
        (finding) => finding.kind,
      ),
    ).toEqual(['slug-run']);
  });
});

/**
 * The five shapes that decide whether this population is honest.
 *
 * A `replace` over a negated ASCII-alphanumeric class matches **9** sites in
 * this tree, and 7 of them legitimately need no fold. If the predicate reported
 * those, the ledger would be mostly exceptions — and a ledger that is mostly
 * exceptions teaches people to add entries rather than to think, which is worse
 * than the gap it was built to close.
 *
 * Requiring the **run collapse** is what removes them, and each of these is a
 * live site measured on `master`. They are asserted one by one rather than in a
 * loop because they fail for different reasons, and a loop would let four of
 * them go blind behind the fifth's red (issue #130).
 */
describe('check-diacritic-folds — what the slug run does not refuse', () => {
  const kinds = (source: string): string[] =>
    analyzeSource(source, 'backend/src/modules/x/thing.ts').map((finding) => finding.kind);

  it('leaves a deletion alone: `autopay`s hash seed, which must not change at all', () => {
    // `.replace(/[^A-Za-z0-9]/g, '')` — the seed of a payment signature. Folding
    // it would change every hash. Two independent rules clear it, and either
    // alone would: the class carries no run quantifier, and the replacement is
    // not a separator. The proof below covers the second rule on its own, so
    // this one is not silently resting on the first.
    expect(kinds("const compact = seed.replace(/[^A-Za-z0-9]/g, '');")).toEqual([]);
  });

  it('leaves a compaction alone: a quantified run replaced by nothing at all', () => {
    // The empty-replacement rule, proven where it is the *only* thing standing:
    // the class here is quantified, so the run-collapse requirement is satisfied
    // and the verdict rests entirely on `''` not being a separator. Removing
    // every unusable character produces `atwyszablon`, which is a compaction
    // rather than a slug — there is no delimiter in it to be one.
    expect(kinds("const compact = value.replace(/[^A-Za-z0-9]+/g, '');")).toEqual([]);
  });

  it('leaves a one-for-one substitution alone: a DOM id, which collapses no run', () => {
    // `FieldProtectionToggle`'s element id. Every unusable character becomes its
    // own hyphen, so length and position survive — identifier grammar, not slug
    // grammar, and nothing about it is persisted.
    expect(
      kinds("const id = `ergonode-protect-${path}`.replace(/[^a-zA-Z0-9_-]/g, '-');"),
    ).toEqual([]);
  });

  it('leaves an XML element name alone, which strips rather than separates', () => {
    // `xml-feed-serializer`. Same two rules as the hash seed above, and the same
    // note: each is proven alone elsewhere in this block.
    expect(kinds("const cleaned = name.replace(/[^A-Za-z0-9_.:-]/g, '');")).toEqual([]);
  });

  it('leaves a Meilisearch index name alone, built from an already-constrained code', () => {
    expect(
      kinds("const index = `products_${code.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;"),
    ).toEqual([]);
  });

  it('leaves a Unicode-aware class alone, because it keeps its accented letters', () => {
    // `[^\p{L}\p{N}]+` collapses a run and is **not** the defect: `ł` is a
    // letter, so it survives. Matching it would report the correct answer.
    expect(kinds("const s = v.replace(/[^\\p{L}\\p{N}]+/gu, '-');")).toEqual([]);
  });

  it('leaves a bare string pattern alone, which `replace` treats as a substring', () => {
    // `'[^a-z0-9]+'` as a first argument matches those characters verbatim and
    // collapses nothing at all.
    expect(kinds("const s = v.replace('[^a-z0-9]+', '-');")).toEqual([]);
  });

  it('leaves a collapse whose halves sit in different statements — and says so', () => {
    // Not a claim that this is correct code: it is the stated bound of the
    // window (one call chain), in the idiom of `check-port-catches`, which
    // follows a gate one hop through `this` and refuses to go further. A bound
    // that is asserted is a bound a later widening has to delete deliberately.
    expect(
      kinds(
        'export function key(v: string): string {\n' +
          "  const collapsed = v.replace(/[^a-z0-9_]/g, '_');\n" +
          "  return collapsed.replace(/_{2,}/g, '_');\n" +
          '}',
      ),
    ).toEqual([]);
  });
});

describe('check-diacritic-folds — the site population it discloses', () => {
  // `sites=` is a ratchet input (issue #244), so it has to count the population
  // and not the findings. A number that moved with the findings would answer
  // the wrong question — which is the mistake `check-entry-scope` had already
  // made once, printing the files that hold an entry site rather than the files
  // it opened.
  const source = [
    "export const compact = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');",
    "export const slug = (s: string) => s.replace(/[^a-z0-9]+/g, '-');",
    "export const trimmed = (s: string) => s.replace(/^-+|-+$/g, '');",
    "export const literal = (s: string) => s.replace('x', 'y');",
  ].join('\n');

  it('counts every readable `.replace()` it judged, cleared ones included', () => {
    // Three of the four: the bare string pattern is not a pattern this check can
    // read, so it is honestly outside the population rather than silently in it.
    const analysis = analyzeFile(source, 'admin/src/lib/thing.ts');
    expect(analysis.replaceSites).toBe(3);
    expect(analysis.findings.map((finding) => finding.kind)).toEqual(['slug-run']);
  });

  it('does not move when a finding is repaired', () => {
    // The property that makes the number worth recording: routing the one slug
    // builder through the shared generator empties the findings and leaves the
    // population where it was, minus only the call that went away.
    const repaired = analyzeFile(
      source.replace("s.replace(/[^a-z0-9]+/g, '-')", 'slugify(s)'),
      'admin/src/lib/thing.ts',
    );
    expect(repaired.findings).toEqual([]);
    expect(repaired.replaceSites).toBe(2);
  });

  it('is summed across the scanned files by the check itself', () => {
    const result = checkDiacriticFolds(
      [file('admin/src/lib/a.ts', source), file('admin/src/lib/b.ts', source)],
      {},
      {},
    );
    expect(result.replaceSites).toBe(6);
    // ...and the excluded subtrees contribute none of it, or the disclosed
    // number would describe a population the check does not judge.
    const withExclusions = checkDiacriticFolds(
      [file('admin/src/lib/a.ts', source), file('backend/scripts/check-x.ts', source)],
      {},
      {},
    );
    expect(withExclusions.replaceSites).toBe(3);
  });
});

/** The two predicates the slug signal is assembled from, read directly. */
describe('check-diacritic-folds — the slug vocabulary', () => {
  it('recognises an ASCII-alphanumeric negated class and its quantifier', () => {
    expect(negatedAsciiClass('[^a-z0-9]+')).toEqual({ text: '[^a-z0-9]+', quantified: true });
    expect(negatedAsciiClass('[^a-z0-9_-]')).toEqual({ text: '[^a-z0-9_-]', quantified: false });
    expect(negatedAsciiClass('[^\\w]{2,}')).toEqual({ text: '[^\\w]{2,}', quantified: true });
  });

  it('refuses a class that is not over ASCII alphanumerics', () => {
    // A letter range with no digits is not the shape: `[^a-z]+` is nobody's slug
    // builder, and a Unicode property class keeps the letters the defect deletes.
    expect(negatedAsciiClass('[^a-z]+')).toBeUndefined();
    expect(negatedAsciiClass('[^\\p{L}\\p{N}]+')).toBeUndefined();
    expect(negatedAsciiClass('^-+|-+$')).toBeUndefined();
  });

  it('recognises a run collapse over a separator, in both spellings', () => {
    expect(collapsesSeparatorRun('_{2,}', '_')).toBe(true);
    expect(collapsesSeparatorRun('-+', '-')).toBe(true);
    expect(collapsesSeparatorRun('[-]+$', '-')).toBe(true);
    // The separator has to be the one the first move wrote, or a second chain
    // step over an unrelated character would close the finding.
    expect(collapsesSeparatorRun('_{2,}', '-')).toBe(false);
    expect(collapsesSeparatorRun('', '-')).toBe(false);
    expect(collapsesSeparatorRun('-+', '')).toBe(false);
  });
});

describe('check-diacritic-folds — the ledger', () => {
  const slugifier = file(
    'admin/src/modules/product_feeds/api.ts',
    "export const s = (v: string) => v.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '');",
  );

  it('passes a ledgered file and counts it as ledgered rather than clean', () => {
    const result = checkDiacriticFolds(
      [slugifier],
      {
        'admin/src/modules/product_feeds/api.ts': {
          findings: 2,
          reason: 'Reason.',
          retiredBy: 'issue #239',
        },
      },
      {},
    );
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.stale).toEqual([]);
  });

  it('fails an entry whose count no longer matches, in both directions', () => {
    const lowered = checkDiacriticFolds(
      [slugifier],
      {
        'admin/src/modules/product_feeds/api.ts': {
          findings: 3,
          reason: 'Reason.',
          retiredBy: 'issue #239',
        },
      },
      {},
    );
    expect(lowered.stale).toEqual([
      {
        path: 'admin/src/modules/product_feeds/api.ts',
        declared: 3,
        actual: 2,
        ledger: 'folds',
      },
    ]);

    const repaired = checkDiacriticFolds(
      [file('admin/src/modules/product_feeds/api.ts', "import { normalize } from '@/lib/x';")],
      {
        'admin/src/modules/product_feeds/api.ts': {
          findings: 2,
          reason: 'Reason.',
          retiredBy: 'issue #239',
        },
      },
      {},
    );
    expect(repaired.stale).toEqual([
      {
        path: 'admin/src/modules/product_feeds/api.ts',
        declared: 2,
        actual: 0,
        ledger: 'folds',
      },
    ]);
  });

  it('keeps the two ledgers apart, so neither excuses the other kind', () => {
    // The reason there are two rather than one per-file count: they answer
    // different questions — "why is this fold not an import of `foldDiacritics`"
    // against "why is this generator not an import of `slugify`" — and a file
    // could carry one of each. An entry in the wrong ledger must excuse nothing,
    // or the second signal is one typo away from being switched off.
    const entry = { findings: 1, reason: 'Fixture reason.', retiredBy: 'issue #244' };

    const slugFile = file(
      'admin/src/modules/x/slug.ts',
      "export const s = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-');",
    );
    const excusedByTheWrongLedger = checkDiacriticFolds(
      [slugFile],
      { 'admin/src/modules/x/slug.ts': entry },
      {},
    );
    expect(excusedByTheWrongLedger.violations.map((f) => f.kind)).toEqual(['slug-run']);
    // ...and the fold ledger's own staleness half sees the file as folding zero
    // times, which is what makes filing it there fail rather than merely not help.
    expect(excusedByTheWrongLedger.stale).toEqual([
      { path: 'admin/src/modules/x/slug.ts', declared: 1, actual: 0, ledger: 'folds' },
    ]);

    const excusedByItsOwn = checkDiacriticFolds([slugFile], {}, {
      'admin/src/modules/x/slug.ts': entry,
    });
    expect(excusedByItsOwn.violations).toEqual([]);
    expect(excusedByItsOwn.ledgered).toHaveLength(1);
    expect(excusedByItsOwn.stale).toEqual([]);

    // And the mirror: a fold filed under the slug ledger is still a violation.
    const foldOnly = checkDiacriticFolds([slugifier], {}, {
      'admin/src/modules/product_feeds/api.ts': { ...entry, findings: 2 },
    });
    expect(foldOnly.violations).toHaveLength(2);
    expect(foldOnly.stale.map((entryOut) => entryOut.ledger)).toEqual(['slug-runs']);
  });

  it('is empty, and any entry added back still has to say why and when it goes', () => {
    // It held four when it landed. !753 repaired the two in `admin/` and issue
    // #245 the two in `backend/`, under one owner ruling: new values are to be
    // correct, historical ones are not migrated. Each pair's entries went with
    // the repair, because an entry over a file that no longer folds is exactly
    // what the staleness half refuses — and it did refuse them, loudly, which
    // is how the last two came to be deleted rather than left standing.
    //
    // Asserted as **empty** rather than deleted: the constant is the seam the
    // two-way ratchet reads, and a rule with no list is a rule with nowhere to
    // record the exception it will one day have. The loop below is what an
    // entry would have to satisfy, and it is kept live for that day.
    expect(Object.keys(DIACRITIC_FOLDS_ALLOWED)).toEqual([]);
    for (const [path, entry] of Object.entries(DIACRITIC_FOLDS_ALLOWED)) {
      expect(entry.reason.length, `${path} has no reason`).toBeGreaterThan(30);
      expect(entry.retiredBy, `${path} names no retiring condition`).toContain('#');
      expect(entry.findings, `${path} declares no count`).toBeGreaterThan(0);
    }
  });

  it('the slug ledger holds only deferred defects, each saying why and when it goes', () => {
    // Empty since issue #260. It opened with the two `pim_ergonode` key
    // derivations, and neither was an exception to the rule: both derived an
    // identifier from an Ergonode source code and both deleted `ł` rather than
    // folding it. What deferred the repair was that they are **lookup** keys,
    // re-derived on every import run to find a row a previous run created — so
    // repairing them meant a back-fill, which #260 shipped.
    //
    // If an entry ever says "this is not a slug and needs no fold", the
    // predicate has outgrown its population and the answer is to narrow it, not
    // to add the entry. "It is a lookup key" is not one either: that says what a
    // repair costs, not whether one is owed.
    expect(Object.keys(SLUG_RUNS_ALLOWED)).toEqual([]);
    for (const [path, entry] of Object.entries(SLUG_RUNS_ALLOWED)) {
      expect(entry.reason.length, `${path} has no reason`).toBeGreaterThan(30);
      expect(entry.retiredBy, `${path} names no retiring condition`).toContain('ruling');
      expect(entry.findings, `${path} declares no count`).toBeGreaterThan(0);
      // The entry has to describe a file that is really there, or the ledger is
      // a list of paths nobody has read since they moved.
      expect(
        analyzeSource(readFileSync(join(REPO_ROOT, path), 'utf8'), path).filter(
          (finding) => finding.kind === 'slug-run',
        ),
        `${path} no longer builds a slug — delete the entry`,
      ).toHaveLength(entry.findings);
    }
  });

  it('gives every population root a reason', () => {
    for (const [root, reason] of Object.entries(POPULATION_ROOTS)) {
      expect(reason.length, `${root} has no reason`).toBeGreaterThan(20);
    }
  });

  it('gives every excluded subtree a reason', () => {
    // An exclusion without a reason is a glob, and a glob is how a tree stops
    // being scanned without anyone deciding that it should.
    expect(Object.keys(EXCLUDED_SUBTREES).length).toBeGreaterThan(0);
    for (const [subtree, reason] of Object.entries(EXCLUDED_SUBTREES)) {
      expect(reason.length, `${subtree} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe('check-diacritic-folds — the self-test on its own exemption', () => {
  it('accepts the helper as it is on disk', () => {
    expect(helperIsStillTheOwner(HELPER_SOURCE)).toBe(true);
  });

  it('refuses a helper that no longer folds, so a blind analysis cannot read green', () => {
    expect(
      helperIsStillTheOwner('export const normalize = (v: string) => v.toLowerCase();'),
    ).toBe(false);
    // Half a fold is not the helper either: the exemption is for the file that
    // does every shape, and a helper missing one has either moved or broken.
    expect(helperIsStillTheOwner("export const n = (v: string) => v.normalize('NFD');")).toBe(
      false,
    );
  });

  it('refuses a helper that still folds but no longer builds a slug', () => {
    // The third shape joined the guard with issue #244, and this is why: a
    // helper that folds is not enough, because `slugify` is what every
    // `slug-run` failure message tells the author to import. Without it the
    // remedy the check prints does not exist, and the predicate that reports it
    // has lost the file that anchors its exemption.
    const foldsOnly = [
      "export const fold = (v: string) => v.normalize('NFD').replace(/\\p{Diacritic}/gu, '');",
    ].join('\n');
    expect(helperIsStillTheOwner(foldsOnly)).toBe(false);
    // ...and it comes back the moment the generator does, so the assertion above
    // is about the missing slug builder rather than about the fixture being
    // short of something else.
    expect(
      helperIsStillTheOwner(
        `${foldsOnly}\nexport const slugify = (v: string) => fold(v).replace(/[^a-z0-9]+/g, '-');`,
      ),
    ).toBe(true);
  });
});

describe('check-diacritic-folds — the exit codes', () => {
  it('exits 2 when the population is empty, rather than reporting a vacuous pass', () => {
    // Only the helper is written, and the helper is excluded by path — so the
    // walk really does read zero files in the population, and the answer is 2.
    const result = fixtureRepository().run();
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 when the shared helper is not at the anchored path', () => {
    // A moved helper means the exclusion exempts nothing and the real fold is
    // being reported at its new home. That is not a clean tree; it is a check
    // that has lost its subject.
    const repo = fixtureRepository({ helper: null });
    repo.write('admin/src/lib/thing.ts', 'export const a = 1;\n');
    const result = repo.run();
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
    expect(result.output).toContain(SHARED_FOLD_HELPER);
  });

  it('exits 2 when the helper is there but no longer parses as a fold', () => {
    const repo = fixtureRepository({
      helper: 'export const normalize = (v: string) => v.toLowerCase();\n',
    });
    repo.write('admin/src/lib/thing.ts', 'export const a = 1;\n');
    const result = repo.run();
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 2 when the helper folds but no longer holds the shared slug generator', () => {
    // End to end, at the CLI, for the widening issue #244 made to the guard.
    // The fixture's helper carries a complete fold and no `slugify`, so every
    // other predicate is intact — the run is refused purely because the import
    // its `slug-run` message names has gone.
    const repo = fixtureRepository({
      helper:
        "export function foldDiacritics(v: string): string {\n" +
        "  return v.normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase();\n" +
        '}\n',
    });
    repo.write('admin/src/lib/thing.ts', 'export const a = 1;\n');
    const result = repo.run();
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
    expect(result.output).toContain('slug generator');
  });

  it('exits 1 and names the file when a source folds outside the helper', () => {
    const repo = fixtureRepository({ ledgered: true });
    repo.write(
      'admin/src/components/ui/combobox.tsx',
      "export const n = (v: string) => v.normalize('NFD').replace(/\\p{Diacritic}/gu, '');\n",
    );
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('admin/src/components/ui/combobox.tsx');
    expect(result.output).toContain('violations=2');
  });

  it('exits 1 and names the file when a source builds a slug outside the generator', () => {
    // The shape issue #244 is about, at the CLI: `codeFromTemplateName` as it
    // stood on `master` for a year. It writes **no fold at all**, so the two
    // older signals see nothing in it — `violations=1` here is the third one
    // reporting, and it would have been 0 before this signal existed.
    const repo = fixtureRepository({ ledgered: true });
    repo.write(
      'admin/src/modules/cms/components/cms-template-layout.ts',
      'export const codeFromTemplateName = (name: string): string =>\n' +
        "  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n",
    );
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('admin/src/modules/cms/components/cms-template-layout.ts');
    expect(result.output).toContain('violations=1');
    expect(result.output).toContain('slug-run');
    expect(result.output).toContain("Import { slugify } from '@b2b/contracts'");
  });

  it('exits 1 when a slug-ledger entry no longer describes the file it names', () => {
    // The slug ledger's second direction, end to end. It is empty since issue
    // #260, so the copy is given one naming a file the fixture never writes:
    // the entry is stale and the run fails even though nothing folds and
    // nothing slugifies. Before #260 this fell out of the real ledger's two
    // `pim_ergonode` entries being absent from the fixture.
    const repo = fixtureRepository({
      slugLedger:
        "{ 'backend/src/modules/x/slug.ts': " +
        "{ findings: 1, reason: 'Fixture.', retiredBy: 'a ruling' } }",
    });
    repo.write('admin/src/lib/thing.ts', 'export const a = 1;\n');
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('violations=0');
    expect(result.output).toContain('stale=1');
    expect(result.output).toContain('[slug-runs]');
    expect(result.output).toContain('backend/src/modules/x/slug.ts');
  });

  it('exits 0 with a slug-ledger entry that still describes its file', () => {
    // The other half of the substitution, so the fixture above is proven to be
    // a discrimination rather than a way of making the run fail: the same
    // injected entry over a file that really does build a slug passes, and is
    // counted as ledgered rather than as a violation.
    const repo = fixtureRepository({
      slugLedger:
        "{ 'backend/src/modules/x/slug.ts': " +
        "{ findings: 1, reason: 'Fixture.', retiredBy: 'a ruling' } }",
    });
    repo.write(
      'backend/src/modules/x/slug.ts',
      'export const code = (name: string): string =>\n' +
        "  name.toLowerCase().replace(/[^a-z0-9]+/g, '-');\n",
    );
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('violations=0');
    expect(result.output).toContain('slug-ledger-size=1');
    expect(result.output).toContain('ledgered=1');
    expect(result.output).toContain('stale=0');
  });

  it('exits 0 on a tree whose callers import the shared helper', () => {
    const repo = fixtureRepository({ ledgered: true });
    repo.write(
      'admin/src/components/ui/combobox.tsx',
      "import { normalize } from '@/lib/text-normalization';\nexport const n = normalize;\n",
    );
    repo.write(
      'admin/src/modules/cms/components/cms-template-layout.ts',
      "import { slugify } from '@b2b/contracts';\n" +
        'export const codeFromTemplateName = (name: string): string =>\n' +
        "  slugify(name, { maxLength: 80 });\n",
    );
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('violations=0');
    // Both ledgers are empty — the fold one since issue #245, the slug one
    // since #260 — so nothing folds, nothing slugifies outside the generator,
    // and nothing is excused from either. `ledgered: true` copies no file in,
    // which is what an empty two-way ratchet looks like from the CLI.
    expect(result.output).toContain('fold-ledger-size=0');
    expect(result.output).toContain('slug-ledger-size=0');
    expect(result.output).toContain('ledgered=0');
    expect(result.output).toContain('stale=0');
  });

  it('exits 1 when a ledger entry no longer describes the file it names', () => {
    // The second direction, end to end. The checked-in ledger is empty, so the
    // copy is given one naming a file the fixture never writes: the entry is
    // stale and the run fails even though nothing folds. Before issue #245 this
    // fell out of the real ledger's two entries being absent from the fixture.
    const repo = fixtureRepository({
      ledger:
        "{ 'admin/src/modules/x.ts': { findings: 2, reason: 'Fixture.', retiredBy: 'issue #245' } }",
    });
    repo.write('admin/src/lib/thing.ts', 'export const a = 1;\n');
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('violations=0');
    expect(result.output).toContain('stale=1');
    expect(result.output).toContain('admin/src/modules/x.ts');
  });

  it('exits 0 with a ledger entry that still describes its file', () => {
    // The other half of the substitution, so the fixture above is proven to be
    // a discrimination rather than a way of making the run fail: the same
    // injected entry over a file that really does fold passes, and is counted
    // as ledgered rather than as a violation.
    const repo = fixtureRepository({
      ledger:
        "{ 'admin/src/modules/x.ts': { findings: 2, reason: 'Fixture.', retiredBy: 'issue #245' } }",
    });
    repo.write(
      'admin/src/modules/x.ts',
      "export const n = (v: string) => v.normalize('NFD').replace(/\\p{Diacritic}/gu, '');\n",
    );
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('violations=0');
    expect(result.output).toContain('ledgered=2');
    expect(result.output).toContain('stale=0');
  });
});

describe('check-diacritic-folds — the tree it guards', () => {
  // The four copies !745 removed. Each is asserted to hold an *import* of the
  // shared helper rather than merely to be free of a fold: a file that stopped
  // folding because it stopped searching would pass the first test and lose the
  // behaviour the fold was for.
  const repaired = [
    'admin/src/components/AppShell.tsx',
    'admin/src/components/ui/combobox.tsx',
    'admin/src/components/ui/multi-select.tsx',
    'admin/src/modules/cms/components/PageBuilderDrawer.tsx',
  ];

  it.each(repaired)('%s imports the shared fold instead of writing its own', (path) => {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    expect(analyzeSource(source, path), `${path} folds on its own again`).toEqual([]);
    expect(source).toContain("from '@/lib/text-normalization'");
  });

  it('the admin helper composes the shared fold rather than carrying a second map', () => {
    // It is in the population now: it is not the anchored path any more, and it
    // passes because it imports. The map it used to carry disagreed with the
    // shared one over 19 code points, which is the shape of the defect issue
    // #240 is about — two correct-looking folds, neither knowing about the other.
    const path = 'admin/src/lib/text-normalization.ts';
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    expect(analyzeSource(source, path), `${path} folds on its own again`).toEqual([]);
    expect(source).toContain("import { foldDiacritics } from '@b2b/contracts'");
  });

  /**
   * Every slug generator in the tree, and what this list is still for.
   *
   * There were eight when issue #245 unified them, each a private four-line
   * chain — and a **ninth**, `BlogPostEditor`, which that sweep missed. It was
   * missed because nothing could see it: the fold signals report a fold written
   * outside the helper, and `BlogPostEditor` folded correctly through the admin
   * `normalize`, so there was no signal at all until issue #244 added one for
   * the builder itself. It is this rule's first finding and the ninth entry
   * below.
   *
   * The `slug-run` signal now covers the negative claim — no site builds a slug
   * of its own — so what is left here is the claim it cannot make: a file that
   * stopped slugifying altogether would satisfy every predicate in the check and
   * lose the behaviour outright. Hence the positive assertion, by name.
   */
  const slugGenerators = [
    'backend/src/modules/product_feeds/services/feed-template-io.service.ts',
    'backend/src/modules/pim_ergonode/services/import/category-phase.ts',
    'backend/src/modules/catalog/services/catalog-admin.service.ts',
    'admin/src/modules/newsletter/pages/TagsPage.tsx',
    'admin/src/modules/cms/components/cms-template-layout.ts',
    'admin/src/modules/cms/editors/BlockEditor.tsx',
    'admin/src/modules/cms/editors/PageEditor.tsx',
    'admin/src/modules/blog/pages/BlogPostEditor.tsx',
    'admin/src/modules/product_feeds/api.ts',
  ];

  it.each(slugGenerators)('%s slugifies through @b2b/contracts, not its own chain', (path) => {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    expect(
      analyzeSource(source, path),
      `${path} folds or builds a slug on its own again`,
    ).toEqual([]);
    expect(source, `${path} does not import the shared slug generator`).toMatch(
      /import \{[^}]*\bslugify\b[^}]*\} from '@b2b\/contracts'/,
    );
    // The chain itself, not just the fold: a site that kept its own collapse and
    // merely imported the helper would satisfy the two assertions above while
    // still owning a copy of the cut and the trim. Matched on the **call**
    // shape, because five of these files quote the class in a doc block to
    // explain what they used to do — the same reason the check parses instead
    // of grepping.
    expect(source, `${path} still collapses characters on its own`).not.toContain(
      '.replace(/[^a-z0-9]',
    );
  });

  it('the shared generator is exported from the package index', () => {
    // Or the eight consumers above cannot import it and the rule has nothing
    // to mean outside `packages/`.
    const helper = readFileSync(join(REPO_ROOT, SHARED_FOLD_HELPER), 'utf8');
    expect(helper).toContain('export function slugify');
    expect(helper).toContain('export interface SlugifyOptions');
  });

  it('the anchored helper is the one in @b2b/contracts, reachable from every package', () => {
    expect(SHARED_FOLD_HELPER).toBe('packages/contracts/src/text-normalization.ts');
    expect(HELPER_SOURCE).toContain('export function foldDiacritics');
    // Exported from the package index, or no consumer outside it can import it
    // and the widened population has a rule nobody can obey.
    expect(readFileSync(join(REPO_ROOT, 'packages/contracts/src/index.ts'), 'utf8')).toContain(
      "export * from './text-normalization.js';",
    );
  });
});
