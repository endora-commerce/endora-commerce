/**
 * Companion test for `check:demo-data-budget` — one red proof per shape the
 * check claims to refuse, plus the discriminations that keep each one from
 * being a proof of something wider than the rule.
 *
 * **Every fixture enters at the top of the analysis** (issue #130): a package
 * tree on disk, with the manifest written as the *emitted* text a real run
 * reads. Nothing here hands in a per-module byte count, a resolved layer
 * directory or a declaration state — those are the four steps the check
 * performs, and a fixture that supplied one would prove the reporter and leave
 * the reader, the specifier walk, the emit mapping and the asset classifier
 * unproven.
 *
 * The refusals are proven over the **pure** predicates (`vacuousDemoPopulation`,
 * `vacuousModulePopulation`, `readSizeRefusal`, `checkEmittedFreshness`) rather
 * than by spawning the script, for the reason `read-size.ts` separates its own
 * two halves: a proof that asserted on a message would prove the formatting and
 * leave the predicate unproven. `check-read-size.test.ts` spawns the script.
 */
import { describe, expect, it } from 'vitest';

import {
  demoLayerDirectories,
  readDemoDeclaration,
  vacuousDemoPopulation,
  DEMO_ASSET_BUDGET_BYTES,
  REMEDIES,
  type DemoDataBudgetFindingKind,
  type DemoBudgetLedger,
  type ModuleUnderCheck,
} from '../../../scripts/check-demo-data-budget.js';
import { checkEmittedFreshness } from '../../../scripts/lib/emitted-freshness.js';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';
import { createEmittingPackageFixture } from '../../helpers/emitted-freshness-fixture.js';
import {
  bytesOfText,
  demoBudgetFindings as findingsOfKind,
  demoBudgetShipping as shipping,
  DEMO_BUDGET_COMPLIANT,
  FIXTURE_DEMO_DIR,
  runDemoDataBudget as runOver,
} from '../../helpers/demo-data-budget-fixture.js';

describe('check:demo-data-budget — the declaration reader', () => {
  it('resolves the shorthand `demo,` the emitted manifest writes', () => {
    // The shape `dist/manifest.js` really carries: a file-scope `const demo`
    // and a bare `demo,` in the manifest call. A reader that only looked for
    // `demo: <object>` would answer `absent` for every module in this tree.
    const text = [
      "const demo = { summary: 'x',",
      "  seed: async () => (await import('./backend/demo/seed.js')).s() };",
      "export const manifest = defineModuleManifest({ id: 'taxes', demo });",
    ].join('\n');
    const declaration = readDemoDeclaration(text, 'manifest.js');
    expect(declaration.state).toBe('declared');
    expect(declaration.specifiers).toEqual(['./backend/demo/seed.js']);
  });

  it('keeps `false` and absent apart — §1.2, and they are not one state', () => {
    expect(readDemoDeclaration('export const m = { demo: false };', 'm.js').state).toBe('declined');
    expect(readDemoDeclaration('export const m = { id: 1 };', 'm.js').state).toBe('absent');
  });

  it('reads `demo.package` as a name and never as a specifier', () => {
    const text =
      "const demo = { summary: 'x', package: '@endora-commerce/mod-taxes-demo', " +
      "seed: async () => (await import('./backend/demo/seed.js')).s() };\n" +
      'export const manifest = defineModuleManifest({ demo });\n';
    expect(readDemoDeclaration(text, 'm.js').packageName).toBe(
      '@endora-commerce/mod-taxes-demo',
    );
  });

  it('takes no bare specifier for a body path', () => {
    const text =
      "const demo = { seed: async () => (await import('@endora-commerce/mod-x-demo')).s() };\n" +
      'export const manifest = defineModuleManifest({ demo });\n';
    expect(readDemoDeclaration(text, 'm.js').specifiers).toEqual([]);
  });
});

describe('check:demo-data-budget — locating the layer', () => {
  it('maps an emitted specifier back into the source tree through the emit layout', () => {
    const module: ModuleUnderCheck = {
      moduleId: 'taxes',
      manifestPath: '/pkg/dist/manifest.js',
      packageRoot: '/pkg',
      emit: { rootDir: 'src', outDir: 'dist' },
    };
    expect(
      demoLayerDirectories(module, {
        state: 'declared',
        specifiers: ['./backend/demo/seed.js', './backend/demo/reset.js'],
        packageName: null,
      }),
    ).toEqual(['/pkg/src/backend/demo']);
  });

  it('leaves a manifest that is its own source where it is', () => {
    const module: ModuleUnderCheck = {
      moduleId: 'taxes',
      manifestPath: '/mod/manifest.ts',
      packageRoot: '/mod',
      emit: null,
    };
    expect(
      demoLayerDirectories(module, {
        state: 'declared',
        specifiers: ['./backend/demo/seed.js'],
        packageName: null,
      }),
    ).toEqual(['/mod/backend/demo']);
  });
});

describe('check:demo-data-budget — one red proof per finding', () => {
  it('demo-assets-over-budget: a module whose demo assets pass the floor', () => {
    expect(
      findingsOfKind(
        [DEMO_BUDGET_COMPLIANT, shipping('catalog', DEMO_ASSET_BUDGET_BYTES + 1)],
        'demo-assets-over-budget',
      ),
    ).toBe(1);
  });

  it('undeclared-demo-assets: shippable bytes under a layer nothing declares', () => {
    expect(
      findingsOfKind(
        [
          // Load-bearing rather than decorative: the probe vocabulary is derived
          // from the *declaring* manifests, so a tree in which nobody declares a
          // layer has no path to probe and this finding cannot fire.
          DEMO_BUDGET_COMPLIANT,
          {
            id: 'blog',
            declares: 'declined',
            files: { [`${FIXTURE_DEMO_DIR}/data/rows.json`]: bytesOfText(64) },
          },
        ],
        'undeclared-demo-assets',
      ),
    ).toBe(1);
  });

  it('unlocatable-demo-layer: a declaration whose body directory is not on disk', () => {
    expect(
      findingsOfKind(
        [
          DEMO_BUDGET_COMPLIANT,
          { id: 'catalog', declares: 'declared', declaredLayer: 'backend/demo' },
        ],
        'unlocatable-demo-layer',
      ),
    ).toBe(1);
  });

  it('unreadable-demo-declaration: `demo: buildDemo()` is a finding, never a skip', () => {
    expect(
      findingsOfKind(
        [DEMO_BUDGET_COMPLIANT, { id: 'catalog', declares: 'computed' }],
        'unreadable-demo-declaration',
      ),
    ).toBe(1);
  });

  it('stale-budget-entry: an accepted floor over a module inside the shared one', () => {
    expect(
      findingsOfKind([DEMO_BUDGET_COMPLIANT], 'stale-budget-entry', {
        taxes: { bytes: 1024 * 1024, reason: 'accepted while the catalogue was stored' },
      }),
    ).toBe(1);
  });

  it('orphan-budget-entry: an accepted floor over a module this run does not see', () => {
    expect(
      findingsOfKind([DEMO_BUDGET_COMPLIANT], 'orphan-budget-entry', {
        gone: { bytes: 1024, reason: 'a module that has been renamed' },
      }),
    ).toBe(1);
  });

  it('budget-entry-without-a-reason: a number nobody can disagree with', () => {
    const over = shipping('catalog', DEMO_ASSET_BUDGET_BYTES + 1);
    expect(
      findingsOfKind([DEMO_BUDGET_COMPLIANT, over], 'budget-entry-without-a-reason', {
        catalog: { bytes: DEMO_ASSET_BUDGET_BYTES * 4, reason: '   ' },
      }),
    ).toBe(1);
  });

  it('every finding kind carries a remedy paragraph', () => {
    const kinds: readonly DemoDataBudgetFindingKind[] = [
      'demo-assets-over-budget',
      'undeclared-demo-assets',
      'unlocatable-demo-layer',
      'unreadable-demo-declaration',
      'stale-budget-entry',
      'orphan-budget-entry',
      'budget-entry-without-a-reason',
    ];
    for (const kind of kinds) expect(REMEDIES[kind].length).toBeGreaterThan(40);
  });

  it("the over-budget remedy names §6's escape hatch by its field name (§7.6)", () => {
    expect(REMEDIES['demo-assets-over-budget']).toContain('demo.package');
  });
});

describe('check:demo-data-budget — the discriminations', () => {
  it('a module inside the floor is not a finding', () => {
    expect(runOver([DEMO_BUDGET_COMPLIANT, shipping('catalog', 1024)]).findings).toEqual([]);
  });

  it('an accepted floor holds an over-budget module clean, and stays a ceiling', () => {
    const over = shipping('catalog', DEMO_ASSET_BUDGET_BYTES + 1);
    const accepted: DemoBudgetLedger = {
      catalog: { bytes: DEMO_ASSET_BUDGET_BYTES * 4, reason: 'the demo photographs, ruled on' },
    };
    expect(
      runOver([DEMO_BUDGET_COMPLIANT, over], accepted).findings.map((f) => f.kind),
    ).toEqual([]);
    const past = shipping('catalog', DEMO_ASSET_BUDGET_BYTES * 4 + 1);
    expect(
      runOver([DEMO_BUDGET_COMPLIANT, past], accepted)
        .findings.filter((f) => f.kind === 'demo-assets-over-budget').length,
    ).toBe(1);
  });

  it('a fixture beside a test ships nothing, so it is budgeted by nothing (D-218)', () => {
    // The same bytes, in the layer root beside a `.test.ts` rather than in a
    // directory of its own. `classifyAssetFile` answers `'fixture'`, the copy
    // step does not carry it, and a client never receives it.
    const result = runOver([
      DEMO_BUDGET_COMPLIANT,
      {
        id: 'catalog',
        declares: 'declared',
        files: {
          [`${FIXTURE_DEMO_DIR}/seed.ts`]: 'export const seedDemo = () => undefined;\n',
          [`${FIXTURE_DEMO_DIR}/demo.test.ts`]: 'it("x", () => undefined);\n',
          [`${FIXTURE_DEMO_DIR}/big.json`]: bytesOfText(DEMO_ASSET_BUDGET_BYTES + 1),
        },
      },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.assets).toEqual([]);
    // …and the walk still read it, which is what tells "not budgeted" from
    // "not looked at".
    expect(result.filesRead.some((path) => path.endsWith('big.json'))).toBe(true);
  });

  it('an extension nobody has ruled on ships nothing and is budgeted by nothing', () => {
    const result = runOver([
      DEMO_BUDGET_COMPLIANT,
      {
        id: 'catalog',
        declares: 'declared',
        files: {
          [`${FIXTURE_DEMO_DIR}/seed.ts`]: 'export const seedDemo = () => undefined;\n',
          [`${FIXTURE_DEMO_DIR}/media/photo.jpg`]: bytesOfText(DEMO_ASSET_BUDGET_BYTES + 1),
        },
      },
    ]);
    // `copy-package-assets.mjs` exits 1 on it, so it reaches no client — and the
    // moment a ruling puts `.jpg` in `RUNTIME_ASSET_EXTENSIONS` this check
    // budgets it in the same run, with no edit here.
    expect(result.findings).toEqual([]);
  });

  it('a `.ts` demo body is not an asset however large it is', () => {
    const result = runOver([
      DEMO_BUDGET_COMPLIANT,
      {
        id: 'catalog',
        declares: 'declared',
        files: {
          [`${FIXTURE_DEMO_DIR}/seed.ts`]: bytesOfText(DEMO_ASSET_BUDGET_BYTES * 2),
        },
      },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.assets).toEqual([]);
  });

  it('the probe vocabulary is derived, so an undeclared layer alone fires nothing', () => {
    // The same tree as the `undeclared-demo-assets` proof with the declaring
    // module removed: no manifest carries a specifier, so there is no layer path
    // to probe. Without this the finding above would be a proof of a check that
    // had quietly spelled `backend/demo` into itself.
    const result = runOver([
      {
        id: 'blog',
        declares: 'declined',
        files: { [`${FIXTURE_DEMO_DIR}/data/rows.json`]: bytesOfText(64) },
      },
    ]);
    expect(result.layerPaths).toEqual([]);
    expect(result.findings.filter((f) => f.kind === 'undeclared-demo-assets')).toEqual([]);
  });

  it('a module that names a package in `demo.package` needs no local layer (§6)', () => {
    const result = runOver([
      DEMO_BUDGET_COMPLIANT,
      {
        id: 'catalog',
        declares: 'declared',
        demoPackage: '@endora-commerce/mod-catalog-demo',
        declaredLayer: 'backend/demo',
      },
    ]);
    expect(result.delegated).toEqual(['catalog']);
    expect(result.findings).toEqual([]);
  });
});

describe('check:demo-data-budget — the five exit-2 refusals', () => {
  it('1 — the manifest index registers no module', () => {
    expect(vacuousModulePopulation({ registered: [], files: [] })).toContain(
      'registers no module',
    );
  });

  it('2 — the module walk came back short of the index', () => {
    expect(
      vacuousModulePopulation({
        registered: ['taxes', 'catalog'],
        files: ['/repo/modules/taxes/manifest.ts'],
      }),
    ).toContain('residue of the module tree');
  });

  it('3 — no module declares demo data at all: the conditional’s vacuous state', () => {
    const result = runOver([{ id: 'blog', declares: 'declined' }]);
    expect(result.declaring).toEqual([]);
    expect(vacuousDemoPopulation(result)).toContain('no registered module declares demo data');
  });

  it('3b — every declaring module delegates, so no layer here is measured', () => {
    const result = runOver([
      {
        id: 'catalog',
        declares: 'declared',
        demoPackage: '@endora-commerce/mod-catalog-demo',
        declaredLayer: 'backend/demo',
      },
    ]);
    expect(vacuousDemoPopulation(result)).toContain('`demo.package`');
  });

  it('3c — a declaring module with a local layer is not vacuous', () => {
    expect(vacuousDemoPopulation(runOver([DEMO_BUDGET_COMPLIANT]))).toBeNull();
  });

  it('4 — the demo-layer walk opened no file, which `read-size.ts` refuses', () => {
    // `sites` is legitimately zero — zero shipped assets is the invariant this
    // check locks — so the floor is `files`, and this is the state where the
    // manifests still declare layers and the walk has gone blind.
    expect(readSizeRefusal({ prefix: '[demo-data-budget]', files: 0, sites: 0 })?.kind).toBe(
      'read-nothing',
    );
    expect(
      readSizeRefusal({ prefix: '[demo-data-budget]', files: 32, sites: 0 }),
    ).toBeNull();
  });

  it('4b — a declared layer that vanished is a short walk on the second author', () => {
    expect(
      readSizeRefusal({
        prefix: '[demo-data-budget]',
        files: 28,
        sites: 0,
        coverage: [{ source: 'demo-declarations', expected: 8, covered: 7 }],
      })?.kind,
    ).toBe('short-walk');
  });

  it('5 — the manifest artefact this run would read is one its source has outrun', () => {
    // The declaration is read out of `dist/manifest.js`, so an author who
    // edited `src/manifest.ts` and did not rebuild would be answered about the
    // previous build — a `demo` field added or removed there is invisible.
    const fixture = createEmittingPackageFixture({ sourceIsNewer: true });
    try {
      const result = checkEmittedFreshness({
        read: [fixture.recordedLocation],
        packages: fixture.packages,
      });
      expect(result.findings.map((finding) => finding.kind)).toEqual(['stale-artefact']);
    } finally {
      fixture.cleanup();
    }
  });

  it('5b — an artefact whose source cannot be paired is refused, not reported current', () => {
    const fixture = createEmittingPackageFixture({ sourceIsNewer: false, sourceExists: false });
    try {
      const result = checkEmittedFreshness({
        read: [fixture.recordedLocation],
        packages: fixture.packages,
      });
      expect(result.findings.map((finding) => finding.kind)).toEqual(['unpairable-artefact']);
    } finally {
      fixture.cleanup();
    }
  });
});
