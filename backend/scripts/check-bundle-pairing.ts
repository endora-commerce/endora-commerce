/**
 * CI check — a module that ships a bundle in any language ships one in every
 * language the platform ships. **Repository-scope host** over the relocated
 * analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/bundle-pairing.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file supplies the population — every module the generated
 * manifest index registers, with the freshness refusal that keeps the manifest
 * half honest — and `endora check` supplies the one module a package declares.
 *
 * Usage: `tsx scripts/check-bundle-pairing.ts [--list]`
 * Exit 0 = every module that ships a bundle ships all of them; exit 1 = at least
 * one does not; exit 2 = the run could not see the population it judges —
 * no shipped language, no registered module, a module walk that came back short,
 * no bundle read at all, or a manifest artefact its source has outrun.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import {
  checkBundlePairing,
  nodeBundlePairingFs,
  PREFIX,
  REMEDIES,
  type ModuleUnderCheck,
} from '@endora-commerce/cli/rules/bundle-pairing.js';

import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/bundle-pairing.js';

/**
 * The manifest half of this run is **imported**, and a module package resolves
 * through its own `exports` map at its build output (D-164) — so an author who
 * edits `packages/modules/<id>/src/manifest.ts` and runs this check is answered
 * about the previous build. `bundlesDir` is exactly such a field, and
 * `undeclared-bundle-dir` is a finding *about* its absence, so a stale artefact
 * is the one thing that could make this check report the defect it exists for as
 * clean. Exit 2 rather than 1: the tree is not in violation, the run could not
 * see it (issue #113).
 */
interface LoadedModules {
  readonly modules: readonly ModuleUnderCheck[];
  /** The paths the index recorded for what this run read — the freshness input. */
  readonly manifestLocations: readonly string[];
}

async function loadModules(indexPath: string): Promise<LoadedModules> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifestPath?: string;
      manifest?: { i18n?: { bundlesDir?: string } };
    }>;
  };
  const entries = loaded.DISCOVERED_MANIFESTS ?? [];
  const modules: ModuleUnderCheck[] = [];
  const manifestLocations: string[] = [];
  for (const entry of entries) {
    if (entry.manifestPath === undefined) continue;
    manifestLocations.push(entry.manifestPath);
    modules.push({
      moduleId: entry.id,
      directory: dirname(entry.manifestPath),
      bundlesDir: entry.manifest?.i18n?.bundlesDir ?? null,
    });
  }
  return { modules, manifestLocations };
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);

  // § 4.1 — with no shipped language every module is vacuously paired, and the
  // whole predicate answers "clean" over a question it never asked.
  const languages = [...SUPPORTED_LANGUAGES];
  if (languages.length === 0) {
    console.error(
      `${PREFIX} the platform's shipped-language set is empty, so every module is vacuously ` +
        'paired and the predicate has nothing to compare; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  let loaded: LoadedModules;
  try {
    loaded = await loadModules(layout.manifestIndexPath);
  } catch (error: unknown) {
    // § 4.2 — the module set is the index's answer, not this check's.
    console.error(
      `${PREFIX} the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the population is derived from it, so there is nothing to ` +
        'judge; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // § 4.3 — issue #215's shared floor, and it is a **conjunction** because the
  // two halves of a module tree going missing look nothing alike. A module
  // contributes to this walk when the layout **places** it and the directory it
  // placed it at is really there:
  //
  //   * placement is the layout's answer, not this check's — `moduleDirectories`
  //     holds a module in the application tree, in a workspace package that
  //     declares itself one, or in the host, and a module in none of the three
  //     is absent from it. That is what sees the *half-moved* tree: sources at
  //     `packages/modules/<id>` with the `package.json` withheld, which no glob
  //     produces and no root covers. Measured — the module is missing from the
  //     map while its directory is on disk and readable, so an existence test
  //     alone reports it covered and leaves 68 modules judged behind a clean
  //     line;
  //   * existence is what sees the *moved* tree. The layout derives a
  //     host-resident root from the index's own `manifestPath`, so a registry
  //     pointing at `src/modules/<id>` places all 69 modules at directories that
  //     are not there — a placement test alone reports every one of them
  //     covered.
  //
  // Neither half is redundant, and each was measured failing on the fixture the
  // other one catches.
  const directories = [...layout.moduleDirectories]
    .filter(([, directory]) => nodeBundlePairingFs.isDirectory(directory))
    .map(([, directory]) => directory);
  const byDirectory = new Map(
    [...layout.moduleDirectories].map(([moduleId, directory]) => [directory, moduleId] as const),
  );
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: directories,
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  refuseStaleEmittedArtefacts(
    PREFIX,
    checkEmittedFreshness({
      read: loaded.manifestLocations,
      packages: emittingPackages(layout.repoRoot),
    }),
    layout.displayOf,
  );

  const result = checkBundlePairing({ modules: loaded.modules, languages });

  if (listMode) {
    for (const module of loaded.modules) {
      const state = result.shippingNothing.includes(module.moduleId) ? 'NONE   ' : 'SHIPS  ';
      console.log(
        `${state} ${module.moduleId.padEnd(24)} bundlesDir=${module.bundlesDir ?? '(none)'}`,
      );
    }
    console.log('');
  }

  // § 4.4, and the one a careless implementation omits: with a conditional
  // predicate, "no module ships a bundle" is *vacuously clean*. `files` is the
  // bundle files opened, so it is exactly that state — and `read-size.ts`
  // refuses it as `read-nothing` before this run can report a pass.
  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead.length,
    sites: result.classified.length,
    coverage: [
      coverage,
      {
        source: 'shipped-languages',
        expected: languages.length,
        covered: result.languagesProbed,
      },
    ],
  });
  console.log(
    `${PREFIX} modules shipping bundles=${result.shipping.length} ` +
      `shipping none=${result.shippingNothing.length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) {
    process.exit(0);
  }

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const language = finding.language === null ? '' : ` (${finding.language})`;
      console.error(
        `  - ${finding.moduleId}${language}: ${layout.displayOf(finding.path)}\n` +
          `      ${finding.detail}`,
      );
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
