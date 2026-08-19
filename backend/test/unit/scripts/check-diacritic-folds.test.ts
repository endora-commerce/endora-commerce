import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  analyzeSource,
  checkDiacriticFolds,
  DIACRITIC_FOLDS_ALLOWED,
  EXCLUDED_SUBTREES,
  findDiacriticFolds,
  helperStillFolds,
  isDiacriticPattern,
  isScannablePath,
  POPULATION_ROOTS,
  SHARED_FOLD_HELPER,
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
  options: { helper?: string | null; ledgered?: boolean; ledger?: string } = {},
): FixtureRepository {
  const root = mkdtempSync(join(tmpdir(), 'diacritic-folds-check-'));
  temporaryRoots.push(root);
  const checker = join(root, 'node_modules', 'scripts', 'check-diacritic-folds.ts');
  mkdirSync(dirname(checker), { recursive: true });
  copyFileSync(SCRIPT, checker);
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
    for (const path of Object.keys(DIACRITIC_FOLDS_ALLOWED)) {
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

describe('check-diacritic-folds — the ledger', () => {
  const slugifier = file(
    'admin/src/modules/product_feeds/api.ts',
    "export const s = (v: string) => v.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '');",
  );

  it('passes a ledgered file and counts it as ledgered rather than clean', () => {
    const result = checkDiacriticFolds([slugifier], {
      'admin/src/modules/product_feeds/api.ts': {
        findings: 2,
        reason: 'Reason.',
        retiredBy: 'issue #239',
      },
    });
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.stale).toEqual([]);
  });

  it('fails an entry whose count no longer matches, in both directions', () => {
    const lowered = checkDiacriticFolds([slugifier], {
      'admin/src/modules/product_feeds/api.ts': {
        findings: 3,
        reason: 'Reason.',
        retiredBy: 'issue #239',
      },
    });
    expect(lowered.stale).toEqual([
      { path: 'admin/src/modules/product_feeds/api.ts', declared: 3, actual: 2 },
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
    );
    expect(repaired.stale).toEqual([
      { path: 'admin/src/modules/product_feeds/api.ts', declared: 2, actual: 0 },
    ]);
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
    expect(helperStillFolds(HELPER_SOURCE)).toBe(true);
  });

  it('refuses a helper that no longer folds, so a blind analysis cannot read green', () => {
    expect(helperStillFolds('export const normalize = (v: string) => v.toLowerCase();')).toBe(false);
    // Half a fold is not the helper either: the exemption is for the file that
    // does both halves, and a helper missing one has either moved or broken.
    expect(helperStillFolds("export const n = (v: string) => v.normalize('NFD');")).toBe(false);
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

  it('exits 0 on a tree whose callers import the shared helper', () => {
    const repo = fixtureRepository({ ledgered: true });
    repo.write(
      'admin/src/components/ui/combobox.tsx',
      "import { normalize } from '@/lib/text-normalization';\nexport const n = normalize;\n",
    );
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('violations=0');
    // The real ledger is empty since issue #245, so a clean tree is clean all
    // the way down: nothing folds and nothing is excused from folding.
    expect(result.output).toContain('ledgered=0');
    expect(result.output).toContain('ledger-size=0');
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
   * Every slug generator in the tree, and the assertion the check itself cannot
   * make.
   *
   * There were eight, each a private four-line chain (issue #245). The check
   * refuses a **fold** written outside the helper, which catches six of them
   * and is blind to the other two by construction: `cms-template-layout.ts` and
   * `slugFromSourceCode` had no fold step at all, so they wrote nothing for it
   * to see while deleting `ł` out of every Polish name. Nor can it see a file
   * that stopped folding because it stopped **slugifying** — which would pass
   * the check and lose the behaviour outright.
   *
   * So the positive claim is asserted here, by name: each of the eight resolves
   * its slug through `slugify` from `@b2b/contracts`, and none of them folds on
   * its own. A ninth generator is only refused if it folds; a ninth that does
   * not fold is what this list is for.
   */
  const slugGenerators = [
    'backend/src/modules/product_feeds/services/feed-template-io.service.ts',
    'backend/src/modules/pim_ergonode/services/import/category-phase.ts',
    'backend/src/modules/catalog/services/catalog-admin.service.ts',
    'admin/src/modules/newsletter/pages/TagsPage.tsx',
    'admin/src/modules/cms/components/cms-template-layout.ts',
    'admin/src/modules/cms/editors/BlockEditor.tsx',
    'admin/src/modules/cms/editors/PageEditor.tsx',
    'admin/src/modules/product_feeds/api.ts',
  ];

  it.each(slugGenerators)('%s slugifies through @b2b/contracts, not its own chain', (path) => {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    expect(analyzeSource(source, path), `${path} folds on its own again`).toEqual([]);
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
