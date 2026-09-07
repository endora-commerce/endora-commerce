import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adminScanRoots,
  analyzeSource,
  collectTsxFiles,
  coveredModuleAdminLayers,
  defaultRoots,
  compareToBaseline,
  countByFile,
  HARDCODED_STRINGS_BASELINE,
  type Finding,
} from '../../../scripts/i18n-hardcoded-strings.js';

/**
 * The hard-coded-string rule's own test (issue #113, issue #116).
 *
 * The walk was reachable only through `main`, so nothing exercised it, and the
 * default root was `admin/src` resolved against the working directory — which
 * from `backend/` (where the documented `pnpm --filter backend run
 * i18n:hardcoded` runs) matches nothing. The check read zero files, reported
 * "0 finding(s) across 0 file(s)" and exited 0 for as long as it has existed.
 *
 * Fixing that revealed 274 findings across 47 files, which is why the check ran
 * in no CI job even after it could see anything: strict would have failed on
 * history. It runs against a per-file baseline now, and the half of that which
 * rots is the second one — so both directions are driven here, on counts the
 * repository does not contain.
 */

const FILE = '/repo/admin/src/pages/orders/order-list.tsx';

describe('analyzeSource — the shapes it claims to flag', () => {
  it('flags a JSX text node', () => {
    const findings = analyzeSource('export const A = () => <Button>Save changes</Button>;\n', FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'jsx-text', text: 'Save changes', line: 1 });
  });

  it('flags each user-visible attribute', () => {
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const source = `export const A = () => <input ${attr}="Search orders" />;\n`;
      expect(analyzeSource(source, FILE).map((f) => f.kind), attr).toEqual(['jsx-attr']);
    }
  });

  it('ignores an attribute nobody reads out loud', () => {
    expect(analyzeSource('export const A = () => <div className="flex gap-2" />;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a translated string — it is an expression, not a text node', () => {
    expect(analyzeSource('export const A = () => <Button>{t("orders.save")}</Button>;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a code-shaped token and a technical identifier in <code>', () => {
    expect(analyzeSource('export const A = () => <span>order_id</span>;\n', FILE)).toEqual([]);
    expect(analyzeSource('export const A = () => <code>ctx.subscribe</code>;\n', FILE)).toEqual([]);
  });

  it('reports the line and column, so a finding points at the string', () => {
    const source = ['export const A = () => (', '  <p>Nothing here yet</p>', ');', ''].join('\n');
    expect(analyzeSource(source, FILE)[0]).toMatchObject({ line: 2, column: 6 });
  });
});

describe('the default scan roots', () => {
  /**
   * The vacuity guard, **derived** (feature 091 fallout; D-100).
   *
   * It read `collectTsxFiles(admin/src)` and
   * `expect(files.length).toBeGreaterThan(100)`, which is two stale things at
   * once: a literal count of a derived fact, over **one** of the three root
   * families the script walks. Phase 4's drain moved the admin's screens into
   * their owning module packages, `admin/src` fell to 65 `.tsx` files, and this
   * case went red for a tree in which the check reads *more* than it ever has —
   * 422 files across 57 roots. A reader is sent to look for a narrowed walk by
   * the one instrument that was supposed to prove the walk is not narrow.
   *
   * The defect it exists for is the original one and is unchanged: the default
   * root was `admin/src` resolved against the working directory, so from
   * `backend/` it matched nothing and the check reported `0 findings across 0
   * files` and exited 0 for its whole life. That is a statement about **roots**,
   * so it is asked about every root the script declares, with no number in it.
   */
  it('every root the script declares contributes at least one file', () => {
    const roots = adminScanRoots();
    expect(roots.length, 'the script declared no scan root at all').toBeGreaterThan(0);
    const empty: string[] = [];
    for (const root of roots) {
      expect(existsSync(root.dir), `${root.dir} is declared and is not on disk`).toBe(true);
      const files: string[] = [];
      collectTsxFiles(root.dir, files);
      // A module package whose admin layer is a barrel and no screen is the one
      // legitimate zero (`admin_roles` ships `src/admin/index.ts` and nothing
      // else), so an empty *module* root is not a finding; an empty
      // application or admin-ui root is, because those are the two families
      // whose whole content is screens.
      if (files.length === 0 && (root.owner === null || root.adminUi)) empty.push(root.dir);
    }
    expect(empty, 'a screen-bearing root contributed no .tsx file').toEqual([]);
  });

  /**
   * The floor with no number in it: every file the ledger names has to be a file
   * the walk opened.
   *
   * This is what the drain would have gone red on **in the batch that caused
   * it** rather than three merges later, and it says the true thing — *the walk
   * no longer reaches `X`* — where the ratchet below can only say *`X` is
   * drained*, which is the laundering FR-017 exists to refuse. The ledger is the
   * independent author: 47 entries written by other merge requests, at
   * repository-relative keys, describing exactly the population a relocation
   * moves.
   */
  it('opens every file HARDCODED_STRINGS_BASELINE names', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const ledger = Object.keys(HARDCODED_STRINGS_BASELINE);
    expect(ledger.length, 'an empty ledger cannot floor anything').toBeGreaterThan(0);
    const files: string[] = [];
    for (const root of defaultRoots()) collectTsxFiles(root, files);
    const walked = new Set(files.map((f) => relative(repoRoot, f).split('\\').join('/')));
    expect(ledger.filter((entry) => !walked.has(entry))).toEqual([]);
  });
});

describe('the module-admin floor', () => {
  /**
   * The `sources=module-admin` token's coverage half, driven from a fixture that
   * enters at the top of the analysis rather than from a value the walk
   * computed.
   *
   * A layer is covered when the walk **opened its directory as a root**, not
   * when the walk found a `.tsx` under it: one registry-named layer
   * (`admin_roles`) is a barrel and no screen, and a coverage rule keyed on
   * files would refuse a correct tree. What the token can therefore see is a
   * layer that left the walk — which is the whole of the regression it exists
   * for — and what it cannot is a root that was walked and yielded nothing,
   * which the case above covers for the two families where zero is wrong.
   */
  it('counts a layer the walk opened, and not one it did not', () => {
    const walked = ['/repo/packages/modules/orders/src/admin'];
    expect(
      coveredModuleAdminLayers(
        [
          { directory: '/repo/packages/modules/orders/src/admin' },
          { directory: '/repo/packages/modules/catalog/src/admin' },
        ],
        walked,
      ),
    ).toBe(1);
  });

  it('is 0 when the registry names layers and the walk opened none of them', () => {
    expect(
      coveredModuleAdminLayers([{ directory: '/repo/packages/modules/orders/src/admin' }], [
        '/repo/admin/src',
      ]),
    ).toBe(0);
  });
});

describe('countByFile', () => {
  it('groups findings by a path relative to the scan root', () => {
    const findings: Finding[] = [
      { filePath: '/repo/admin/src/pages/a.tsx', line: 1, column: 1, text: 'A', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/pages/a.tsx', line: 2, column: 1, text: 'B', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/b.tsx', line: 1, column: 1, text: 'C', kind: 'jsx-attr' },
    ];
    expect([...countByFile(findings, '/repo/admin/src')]).toEqual([
      ['pages/a.tsx', 2],
      ['b.tsx', 1],
    ]);
  });
});

describe('the baseline ratchet goes red in BOTH directions', () => {
  const baseline = { 'pages/orders.tsx': 3 } as const;

  it('flags a file that gained a hard-coded string', () => {
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 4]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 4 }]);
    expect(verdict.drained).toEqual([]);
  });

  it('flags a file the ledger never mentioned', () => {
    const verdict = compareToBaseline(new Map([['pages/new-screen.tsx', 1]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/new-screen.tsx', baseline: 0, actual: 1 }]);
  });

  it('flags a ledger entry that describes a debt already paid', () => {
    // The half that rots. A number left standing after the strings were
    // translated is a claim the tree stopped backing, which is the whole of
    // what makes an allow-list rather than a ratchet.
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 1]]), baseline);
    expect(verdict.drained).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 1 }]);
    expect(verdict.regressions).toEqual([]);
  });

  it('flags a ledger entry whose file is clean or gone', () => {
    expect(compareToBaseline(new Map(), baseline).drained).toEqual([
      { file: 'pages/orders.tsx', baseline: 3, actual: 0 },
    ]);
  });

  it('is silent when the tree matches the ledger exactly', () => {
    expect(compareToBaseline(new Map([['pages/orders.tsx', 3]]), baseline)).toEqual({
      regressions: [],
      drained: [],
    });
  });
});

describe('the tree itself (what CI asserts)', () => {
  it('matches HARDCODED_STRINGS_BASELINE exactly — no new string, no stale entry', () => {
    // **The roots come from the script, not from a copy of them here** (feature
    // 091, Phase 4 batch three). This test spelled two — `admin/src` and the
    // kit — which was right when Phase 1b wrote it and stopped being right when
    // Phase 4's first batch added module packages' own `src/admin` layers to
    // `defaultRoots`. Nothing reported the divergence for two batches, because
    // neither moved a file the baseline named, so both walks agreed on the
    // empty set. Batch three moved the first one that is named, and the two
    // populations disagreed about it in opposite directions in the same run:
    // the script counted the finding at its new key, this test — blind to the
    // root it sits under — reported the entry as drained.
    //
    // So the derivation is shared rather than mirrored. A batch that adds a
    // fourth root family now moves both answers at once, which is the only way
    // a ratchet over relocations can stay honest about relocations.
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const files: string[] = [];
    for (const root of defaultRoots()) collectTsxFiles(root, files);
    const findings = files.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
    const verdict = compareToBaseline(countByFile(findings, repoRoot), HARDCODED_STRINGS_BASELINE);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.drained).toEqual([]);
  });
});
