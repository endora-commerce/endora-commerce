/**
 * CI check — no module imports the container library (feature 072, T041 /
 * FR-032). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/container-imports.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file resolves this repository's module walk roots and its
 * population floor; `endora check` resolves one package's. The forwarding
 * specifier is **bare**, never a path into `dist`.
 *
 * Usage: `tsx scripts/check-container-imports.ts [--list]`
 * Exit 0 = no module imports the container; exit 1 = at least one does.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  analyzeSource,
  collectModuleFiles,
  moduleOf,
} from '@endora-commerce/cli/rules/container-imports.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/container-imports.js';

const FORBIDDEN_PACKAGE = 'awilix';

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[container-imports]');
  const files = collectModuleFiles(layout.moduleWalkRoots);
  // `src/apps` is the second half of the scan and survives the module tree
  // moving: five overlay files were enough to clear an emptiness guard and let
  // the check print `module files=5 violations=0` (issue #215). The floor is
  // one file per registered module, read from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[container-imports]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const findings = files.flatMap((f) =>
    analyzeSource(readFileSync(f, 'utf8'), f, layout.hostResidentModules),
  );
  const rel = layout.displayOf;

  if (listMode) {
    const modules = new Set(
      files
        .map((file) => moduleOf(file, layout.hostResidentModules))
        .filter((id): id is string => id !== null),
    );
    console.log(`[container-imports] scanning ${modules.size} modules`);
  }

  // What was read, beside what was found (issue #244). `module files` below is
  // the same number today; it is printed in the shared grammar so the ratchet
  // reads one shape across every check rather than twenty-four spellings.
  reportReadSize({ prefix: '[container-imports]', files: files.length, coverage: [coverage] });
  console.log(
    `[container-imports] module files=${files.length} violations=${findings.length}`,
  );

  if (findings.length > 0) {
    console.error(
      `\nModules importing '${FORBIDDEN_PACKAGE}'. A module sees only ModuleContext — ` +
        `use ctx.asClass / ctx.asFunction / ctx.asValue to register and ctx.cradle() to ` +
        `resolve. If the context does not expose what you need, that is a kernel change ` +
        `(src/kernel/module-context.ts), not a local import:`,
    );
    for (const f of findings) {
      console.error(`  - ${f.moduleId}: ${rel(f.file)}:${f.line} imports '${f.specifier}'`);
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
