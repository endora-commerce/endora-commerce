/**
 * CI check — a module package's Page Builder renderers stay in their lane.
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/block-renderers.js`
 * (`specs/141-module-block-renderers/`, plan D11; one analysis, two hosts).
 * This file supplies the population and `endora check` supplies the one module
 * a package declares.
 *
 * ## The population, and why it is two derivations
 *
 *  1. **Every module the generated manifest index registers**, read at its own
 *     directory. Most ship no renderer layer today, and they are read anyway:
 *     `layer-without-subpath` is a finding about a package that *has* a layer's
 *     sources and does not publish them, which only a walk of every package can
 *     see. The shared module-population floor holds this half, so a moved
 *     module tree is refused rather than reported clean (issue #215).
 *  2. **The module packages under the application's acceptance directory** —
 *     the synthetic third-party modules the acceptance criteria install from a
 *     tarball. They are not workspace members, so nothing else in the estate
 *     reads them, and `block-renderers-fixture` is the one package in this
 *     repository that ships all three layers. It is what keeps this check's
 *     subject non-empty here: a rule that landed over no layer at all would be
 *     green for a reason nobody could tell from "not looking" (issue #113).
 *
 * Usage: `tsx scripts/check-block-renderers.ts [--list]`
 * Exit 0 = every renderer layer stays in its lane; exit 1 = at least one does
 * not; exit 2 = the run could not see what it judges — no registered module, a
 * module walk that came back short, no renderer layer read at all, a declared
 * stylesheet that is not there, or a renderer claim whose manifest declares no
 * readable `blocks`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkBlockRenderers,
  declaredLayerCount,
  describeBlockRendererPackage,
  displayPath,
  PREFIX,
  REMEDIES,
  type BlockRendererPackage,
} from '@endora-commerce/cli/rules/block-renderers.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/block-renderers.js';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The acceptance directory's module packages: every directory beside the
 * manifest index's application root's `acceptance/` that declares itself one.
 * Derived by the package's own `endora` block — the directory names are not
 * spelled, so a fourth fixture is read the day it is added.
 */
export function acceptanceModulePackages(applicationRoot: string): string[] {
  const acceptance = join(applicationRoot, 'acceptance');
  if (!isDirectory(acceptance)) return [];
  return readdirSync(acceptance)
    .sort()
    .map((entry) => join(acceptance, entry))
    .filter((dir) => isDirectory(dir) && existsSync(join(dir, 'package.json')));
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);

  // Half 1 — the registered modules, at the directories the layout placed them.
  const directories = [...layout.moduleDirectories]
    .map(([, directory]) => directory)
    .filter((directory) => isDirectory(directory));
  const byDirectory = new Map(
    [...layout.moduleDirectories].map(([moduleId, directory]) => [directory, moduleId] as const),
  );
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: directories,
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  // Half 2 — the acceptance fixtures. The application root is the manifest
  // index's own ancestor: `<app>/src/…/index.generated.ts`.
  let applicationRoot = dirname(layout.manifestIndexPath);
  while (!existsSync(join(applicationRoot, 'package.json'))) {
    const parent = dirname(applicationRoot);
    if (parent === applicationRoot) break;
    applicationRoot = parent;
  }

  const packages: BlockRendererPackage[] = [];
  for (const directory of [...directories, ...acceptanceModulePackages(applicationRoot)]) {
    // A host-resident module (the lifecycle's own) is a directory and not a
    // package; it can ship no layer, and `describe` answers `null` for it.
    const described = describeBlockRendererPackage(directory);
    if (described !== null) packages.push(described);
  }

  const result = checkBlockRenderers(packages);
  const declaredLayers = packages.reduce((sum, pkg) => sum + declaredLayerCount(pkg), 0);
  const filesRead = packages.reduce((sum, pkg) => sum + pkg.filesRead.length, 0);

  if (listMode) {
    for (const pkg of packages) {
      const layers = [
        pkg.storefront === null ? null : 'storefront',
        pkg.email === null ? null : 'email',
        pkg.stylesheet === null ? null : 'blocks.css',
      ].filter((layer): layer is string => layer !== null);
      console.log(`${pkg.moduleId.padEnd(24)} ${layers.length === 0 ? '(no renderer layer)' : layers.join(', ')}`);
    }
    console.log('');
  }

  if (result.missingStylesheets.length > 0) {
    console.error(
      `${PREFIX} a package declares \`./blocks.css\` and the file is not there: ` +
        `${result.missingStylesheets.map((path) => layout.displayOf(path)).join(', ')} — the ` +
        'stylesheet is part of what this run judges, so it cannot report without it',
    );
    process.exit(2);
  }
  if (result.unreadableManifests.length > 0) {
    console.error(
      `${PREFIX} ${result.unreadableManifests.join(', ')} contribute${result.unreadableManifests.length === 1 ? 's' : ''} ` +
        'a block renderer and the `blocks` its manifest declares could not be read as a literal ' +
        'array — a renderer is judged against that declaration; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // With a conditional predicate, "no package ships a renderer layer" is
  // *vacuously clean*. The expectation of zero is refused by `read-size.ts`
  // before this run can report a pass over nothing.
  reportReadSize({
    prefix: PREFIX,
    files: filesRead,
    sites: result.claims,
    coverage: [
      coverage,
      { source: 'renderer-layers', expected: declaredLayers, covered: result.layersRead },
    ],
  });
  console.log(
    `${PREFIX} packages read=${packages.length} renderer layers=${result.layersRead} ` +
      `renderer claims=${result.claims} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const byPackage = new Map(packages.map((pkg) => [pkg.packageName, pkg] as const));
  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const pkg = byPackage.get(finding.packageName);
      const where = pkg === undefined ? finding.path : displayPath(pkg, finding.path);
      console.error(`  - ${finding.packageName}: ${where}:${String(finding.line)}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
