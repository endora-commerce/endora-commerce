/**
 * CI check — MikroORM's decorators come only from `@mikro-orm/decorators/legacy`
 * (issue #1866). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/entity-decorators.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file walks this repository's source roots — the
 * application's `src`, the platform's and every module package's — and holds
 * the walk to the module population floor; `endora check` walks one package.
 *
 * Usage: `tsx scripts/check-entity-decorators.ts`
 * Exit 0 = every decorator comes from the sanctioned specifier; exit 1 = at
 * least one does not; exit 2 = the walk read nothing, or less than every
 * registered module.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  analyzeSource,
  collectSourceFiles,
  findingMessage,
} from '@endora-commerce/cli/rules/entity-decorators.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/entity-decorators.js';

const PREFIX = '[entity-decorators]';

async function main(): Promise<void> {
  const layout = await requireModuleLayout(PREFIX);
  const files = collectSourceFiles(layout.sourceRoots);
  if (files.length === 0) {
    console.error(`${PREFIX} the source roots held no file — refusing to report a vacuous pass`);
    process.exit(2);
  }
  // The platform root and `src` are read too, but a moved module tree must not
  // hide behind them (issue #215): one file per registered module, from the
  // manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const findings = files.flatMap((file) => analyzeSource(readFileSync(file, 'utf8'), file));

  reportReadSize({ prefix: PREFIX, files: files.length, coverage: [coverage] });
  console.log(`${PREFIX} files=${files.length} findings=${findings.length}`);

  if (findings.length > 0) {
    console.error(`\n${PREFIX} MikroORM decorators imported from somewhere other than '@mikro-orm/decorators/legacy':`);
    for (const finding of findings) {
      console.error(`  - ${layout.displayOf(finding.file)}:${finding.line} [${finding.kind}] ${findingMessage(finding)}`);
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
