/**
 * CI check — a BullMQ queue name is a value the library accepts.
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/queue-names.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) and its header carries the whole reasoning — including why it is a
 * check of its own rather than a widening of `check:subscribe-seam`. This file
 * supplies this repository's source roots, its module-population floor and the
 * *site* floor that belongs to a tree known to hold queues; `endora check`
 * supplies one package's.
 *
 * Usage: `tsx scripts/check-queue-names.ts [--list]`
 * Exit 0 = every queue name this could resolve is one BullMQ accepts; exit 1 =
 * at least one contains `:`; exit 2 = the walk read nothing, or the BullMQ
 * vocabulary resolved to no queue name at all, which is the shape a green would
 * be a lie.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  checkQueueNames,
  collectQueueNameFiles,
  remedyFor,
} from '@endora-commerce/cli/rules/queue-names.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/queue-names.js';

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Every root a source file can live in, derived (feature 080, T040a): the
  // application's own tree plus each package. A colon is fatal wherever it is
  // written, so unlike the seam rule this one does not narrow to module files —
  // the platform's own queue would stop the boot just as dead. The *floor*
  // below is still the module population, because that is the population whose
  // expected size an independent artefact states.
  const layout = await requireModuleLayout('[queue-names]');
  const files = collectQueueNameFiles(layout.sourceRoots);

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  const coverage = await refuseVacuousModulePopulation({
    prefix: '[queue-names]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const result = checkQueueNames({
    sources,
    hostResidentModules: layout.hostResidentModules,
  });

  // Issue #113, and the floor this rule cannot do without. The module
  // population above stays satisfied by a tree of files holding no queue at
  // all, so if `bullmq` renamed an export, or the walk stopped reaching the
  // module packages, every construction would read as "not a queue" and this
  // check would print a clean line over an unprotected tree. `resolved` rather
  // than `sites` is the predicate on purpose: a run that finds constructions
  // and can resolve none of their names has judged nothing.
  if (result.resolved.length === 0) {
    console.error(
      '[queue-names] resolved no BullMQ queue name at all. This tree has queues, so either ' +
        'the walk missed them, the `bullmq` import shape changed, or constant resolution ' +
        'stopped working — a green here would mean "not looking".',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const site of result.sites) {
      const tag = site.name === null ? 'UNRESOLVED' : 'READ      ';
      console.log(
        `${tag} ${site.file}:${site.line}  [${site.moduleId ?? '-'}] new ${site.className}(` +
          `${site.spelling}) = ${site.name ?? '?'} (${site.resolution})`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). `sites` is the finer
  // population and is the number that moves when a module gains a queue while
  // the file count stands still (#235/#237's shape).
  reportReadSize({
    prefix: '[queue-names]',
    files: sources.size,
    sites: result.sites.length,
    coverage: [coverage],
  });
  console.log(
    `[queue-names] queue-name sites read=${result.sites.length} ` +
      `resolved=${result.resolved.length} unresolved=${result.sites.length - result.resolved.length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA BullMQ queue name contains `:`, which the library refuses in `new QueueBase`\n' +
        'before it reaches Redis. This is not a style finding: the module\'s worker start\n' +
        'throws, its plugin never finishes loading, the process never listens — and the\n' +
        'same throw lands in the activation control\'s gate-off phase, so an operator\n' +
        'cannot switch the module off either (Constitution XVII).\n',
    );
    for (const finding of result.findings) {
      console.error(`  - ${finding.site.file}:${finding.site.line}  ${remedyFor(finding)}`);
    }
  }

  process.exit(result.findings.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
