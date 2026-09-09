import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkDemoDataBudget,
  vacuousDemoPopulation,
  DEMO_ASSET_BUDGET_BYTES,
  type DemoBudgetLedger,
  type DemoDataBudgetFindingKind,
  type DemoDataBudgetResult,
  type ModuleUnderCheck,
} from '../../scripts/check-demo-data-budget.js';

/**
 * A module-package tree on disk for `check:demo-data-budget`, plus the records
 * the generated manifest index would produce over it.
 *
 * **The fixture is a tree and a manifest text, never a classification**, and
 * that is the whole reason it exists rather than a literal array in each proof
 * (issue #130). The check's analysis is four steps and every one of them is a
 * step a hand-built input would skip:
 *
 *   1. read the manifest *artefact* as text and decide whether the module
 *      declares demo data, declines it, says nothing, or cannot be read —
 *      including resolving the **shorthand** `demo,` the emitted manifest
 *      actually writes;
 *   2. pull the relative `await import()` specifiers out of the declaration;
 *   3. map each one from the emitted tree back into the source tree through the
 *      package's own `rootDir`/`outDir`;
 *   4. walk that directory and ask `classifyAssetFile` — the one owner of "does
 *      this file ship" — about every file in it.
 *
 * A fixture that handed in "module `catalog` ships 400 KB" would prove the
 * arithmetic in step 5 and leave all four unproven.
 *
 * So a proof varies the **manifest text** and the **files on disk** together,
 * which is the pair a real run reads. Shared by the companion test and
 * `check-inventory.test.ts`' red proofs, in the idiom
 * `emitted-freshness-fixture.ts` established: two builders over one population
 * are two answers waiting to disagree.
 */

/** The emit layout every fixture package declares — `tsc`'s own default shape. */
export const FIXTURE_ROOT_DIR = 'src';
export const FIXTURE_OUT_DIR = 'dist';

/**
 * The demo layer path the fixture writes to by default.
 *
 * It is a **fixture's** spelling and never the check's: the check derives its
 * layer paths from the specifiers the declaring manifests carry, so a proof that
 * wants `undeclared-demo-assets` to fire has to include a *second* module that
 * declares a body at this path — which is the derivation working, and is
 * asserted as such in the companion test.
 */
export const FIXTURE_DEMO_DIR = 'backend/demo';

/** One module the fixture writes out. */
export interface FixtureDemoModule {
  readonly id: string;
  /**
   * What the module's manifest says about demo data.
   *
   * `'declared'` writes the emitted shape — a file-scope `const demo = { … }`
   * with two relative `await import()` bodies and a shorthand `demo,` inside the
   * manifest call. `'declined'` writes `demo: false`. `'absent'` writes no
   * `demo` name at all. `'computed'` writes `demo: buildDemo()`, the shape
   * nothing static can resolve.
   */
  readonly declares: 'declared' | 'declined' | 'absent' | 'computed';
  /**
   * The layer path the declaration's specifiers point at, package-source
   * relative. Defaults to {@link FIXTURE_DEMO_DIR}; a proof that wants
   * `unlocatable-demo-layer` points it somewhere and writes no files there.
   */
  readonly declaredLayer?: string;
  /**
   * Files written under the module's **source** tree, keyed by a path relative
   * to `src/`. Raw text, so a proof can size a file by writing bytes.
   */
  readonly files?: Readonly<Record<string, string>>;
  /** `demo.package` — the escape hatch (§6). */
  readonly demoPackage?: string;
}

export interface DemoDataBudgetFixture {
  /** The temporary root every package directory sits under. */
  readonly root: string;
  /** What the generated index and the package declarations hand the check. */
  readonly modules: readonly ModuleUnderCheck[];
  cleanup: () => void;
}

/** `'x'.repeat(bytes)` — a file of a known size, in one spelling. */
export function bytesOfText(bytes: number): string {
  return 'x'.repeat(bytes);
}

function manifestText(declaration: FixtureDemoModule): string {
  const layer = declaration.declaredLayer ?? FIXTURE_DEMO_DIR;
  switch (declaration.declares) {
    case 'declared': {
      const pkg =
        declaration.demoPackage === undefined
          ? ''
          : `    package: ${JSON.stringify(declaration.demoPackage)},\n`;
      return (
        `const demo = {\n` +
        `    summary: 'Demo rows for ${declaration.id}.',\n` +
        pkg +
        `    seed: async (context) => (await import('./${layer}/seed.js')).seedDemo(context),\n` +
        `    reset: async (context) => (await import('./${layer}/reset.js')).resetDemo(context),\n` +
        `};\n` +
        `export const manifest = defineModuleManifest({\n` +
        `    id: '${declaration.id}',\n` +
        `    demo,\n` +
        `});\n`
      );
    }
    case 'declined':
      return (
        `export const manifest = defineModuleManifest({\n` +
        `    id: '${declaration.id}',\n` +
        `    demo: false,\n` +
        `});\n`
      );
    case 'computed':
      return (
        `export const manifest = defineModuleManifest({\n` +
        `    id: '${declaration.id}',\n` +
        `    demo: buildDemo(),\n` +
        `});\n`
      );
    case 'absent':
      return `export const manifest = defineModuleManifest({ id: '${declaration.id}' });\n`;
  }
}

export function createDemoDataBudgetFixture(
  declarations: readonly FixtureDemoModule[],
): DemoDataBudgetFixture {
  const root = mkdtempSync(join(tmpdir(), 'demo-data-budget-'));
  const modules: ModuleUnderCheck[] = [];

  for (const declaration of declarations) {
    const packageRoot = join(root, declaration.id);
    // The manifest is written into the **emitted** tree, which is where the
    // platform reads it from (D-164) and therefore where this check does. The
    // source tree beside it is what the walk measures, and the mapping between
    // the two is the package's own declared emit layout — so the fixture
    // exercises step 3 rather than short-circuiting it.
    const emittedDir = join(packageRoot, FIXTURE_OUT_DIR);
    mkdirSync(emittedDir, { recursive: true });
    writeFileSync(join(emittedDir, 'manifest.js'), manifestText(declaration), 'utf8');

    for (const [relativePath, content] of Object.entries(declaration.files ?? {})) {
      const target = join(packageRoot, FIXTURE_ROOT_DIR, ...relativePath.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    modules.push({
      moduleId: declaration.id,
      manifestPath: join(emittedDir, 'manifest.js'),
      packageRoot,
      emit: { rootDir: FIXTURE_ROOT_DIR, outDir: FIXTURE_OUT_DIR },
    });
  }

  return { root, modules, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * A compliant declaring module — the one every proof needs beside its defect.
 *
 * `undeclared-demo-assets` probes the layer paths the *declaring* manifests
 * carry, so a tree in which nobody declares one has no path to probe and that
 * finding cannot fire. It is also what keeps {@link vacuousDemoPopulation} from
 * refusing the run before the finding is reached.
 */
export const DEMO_BUDGET_COMPLIANT: FixtureDemoModule = {
  id: 'taxes',
  declares: 'declared',
  files: {
    'backend/demo/seed.ts': 'export const seedDemo = () => undefined;\n',
    'backend/demo/reset.ts': 'export const resetDemo = () => undefined;\n',
  },
};

/**
 * A declaring module whose demo layer ships one shippable asset of `bytes`.
 *
 * The asset goes in a **subdirectory** of the layer, which is not decoration:
 * every demo layer in this tree holds a `demo.test.ts`, so a shippable file
 * beside it is a `'fixture'` that ships to nobody (D-218). A directory of its
 * own is the layout D-218's own remedy names, and it is the one in which a
 * demo asset is a client's bytes.
 */
export function demoBudgetShipping(
  id: string,
  bytes: number,
  name = 'data/catalogue.json',
): FixtureDemoModule {
  return {
    id,
    declares: 'declared',
    files: {
      [`${FIXTURE_DEMO_DIR}/seed.ts`]: 'export const seedDemo = () => undefined;\n',
      [`${FIXTURE_DEMO_DIR}/reset.ts`]: 'export const resetDemo = () => undefined;\n',
      [`${FIXTURE_DEMO_DIR}/${name}`]: bytesOfText(bytes),
    },
  };
}

/** The whole result, over a fixture tree written and removed around the run. */
export function runDemoDataBudget(
  declarations: readonly FixtureDemoModule[],
  ledger: DemoBudgetLedger = {},
): DemoDataBudgetResult {
  const fixture = createDemoDataBudgetFixture(declarations);
  try {
    return checkDemoDataBudget({
      modules: fixture.modules,
      budgetBytes: DEMO_ASSET_BUDGET_BYTES,
      ledger,
    });
  } finally {
    fixture.cleanup();
  }
}

/** How many findings of one kind the check reports over a fixture tree. */
export function demoBudgetFindings(
  declarations: readonly FixtureDemoModule[],
  kind: DemoDataBudgetFindingKind,
  ledger: DemoBudgetLedger = {},
): number {
  return runDemoDataBudget(declarations, ledger).findings.filter(
    (finding) => finding.kind === kind,
  ).length;
}

/** 1 when the conditional predicate refuses this tree as vacuously clean. */
export function demoBudgetVacuous(declarations: readonly FixtureDemoModule[]): number {
  return vacuousDemoPopulation(runDemoDataBudget(declarations)) === null ? 0 : 1;
}

/**
 * 1 when a file the walk **read** produced no finding, 0 otherwise.
 *
 * Both halves are the proof. "No finding" alone is what a check that stopped
 * walking also prints, so a discrimination that did not assert the read would
 * pass over a blind run — which is issue #244's shape inside a red proof.
 */
export function demoBudgetDiscrimination(
  declarations: readonly FixtureDemoModule[],
  fileName: string,
): number {
  const result = runDemoDataBudget(declarations);
  const read = result.filesRead.some((path) => path.endsWith(fileName));
  return read && result.findings.length === 0 ? 1 : 0;
}
