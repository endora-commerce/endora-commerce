/**
 * CI check — a module's background consumers reach the module's seam.
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/subscribe-seam.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file supplies this repository's source roots, its
 * module-population floor and the worker-site refusal that belongs to a tree
 * known to hold queue consumers; `endora check` supplies one package's.
 *
 * Usage: `tsx scripts/check-subscribe-seam.ts [--list]`
 * Exit 0 = every module subscription and every module queue consumer goes
 * through its seam (or is ledgered); exit 1 = at least one does not, or a ledger
 * entry is stale; exit 2 = the walk read nothing, or the BullMQ vocabulary
 * resolved to no construction at all, which is the shape a green would be a lie.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  BARE_SUBSCRIPTIONS_TO_DRAIN,
  checkSubscribeSeam,
  checkWorkerSeam,
  collectSeamFiles,
  findBareSubscriptions,
  keyOf,
  workerKeyOf,
  WORKERS_OUTSIDE_THE_SEAM,
} from '@endora-commerce/cli/rules/subscribe-seam.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/subscribe-seam.js';

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Every root a module's source can live in, derived (feature 080, T040a):
  // the application's own tree, plus each module that has become a workspace
  // package. Reading only the first would leave a moved module unjudged while
  // the floor below still passed on the union.
  const layout = await requireModuleLayout('[subscribe-seam]');
  const files = collectSeamFiles(layout.sourceRoots);

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  // The population is `src/modules`, and the rest of `src/` is 7% of it: a walk
  // that reads only the remainder finds no `eventBus.on` and says so, which is
  // the same green as a clean tree (issue #215). Derived from the manifest
  // index, so nothing here is a number anybody chose.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[subscribe-seam]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const seamInput = { sources, hostResidentModules: layout.hostResidentModules };
  const result = checkSubscribeSeam(seamInput);
  const workers = checkWorkerSeam(seamInput);

  // Issue #113's shape for the worker half, and it needs its own refusal: the
  // subscription half's floor is the module population, which stays satisfied
  // by files carrying no queue at all. If BullMQ's `Worker` stopped being a
  // named export — or the queue files moved out of the walk — every module's
  // consumer would read as "not a worker" and this check would print a clean
  // line over an unprotected tree.
  if (workers.sites.length === 0) {
    console.error(
      '[subscribe-seam] read no BullMQ worker site at all. The tree has queue consumers, so ' +
        'either the walk missed them or the `Worker` import shape changed — a green here would ' +
        'mean "not looking".',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const entry of findBareSubscriptions({ sources })) {
      const tag =
        BARE_SUBSCRIPTIONS_TO_DRAIN[keyOf(entry)] !== undefined ? 'LEDGERED' : 'BARE    ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.receiver}.on('${entry.event}')`,
      );
    }
    for (const site of workers.sites) {
      const tag = site.gated
        ? 'SEAMED  '
        : WORKERS_OUTSIDE_THE_SEAM[workerKeyOf(site)] !== undefined
          ? 'LEDGERED'
          : 'UNGATED ';
      console.log(
        `${tag} ${site.file}:${site.line}  [${site.moduleId ?? '-'}] ${site.spelling} (${site.kind})`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244): the seam's finding count
  // is zero on a clean tree and zero on a tree this never opened.
  reportReadSize({
    prefix: '[subscribe-seam]',
    files: sources.size,
    coverage: [coverage],
  });
  console.log(
    `[subscribe-seam] module subscriptions bypassing the seam=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(BARE_SUBSCRIPTIONS_TO_DRAIN).length} stale=${result.stale.length}`,
  );
  console.log(
    `[subscribe-seam] module queue consumers read=${workers.sites.length} ` +
      `outside-the-seam=${workers.violations.length} ledgered=${workers.ledgered.length} ` +
      `ledger-size=${Object.keys(WORKERS_OUTSIDE_THE_SEAM).length} stale=${workers.stale.length}`,
  );

  if (workers.violations.length > 0) {
    console.error(
      '\nA module built a BullMQ queue consumer outside its gating seam, so the platform\n' +
        'cannot stop it: it is in no per-module registry, `pauseWorkersFor` reaches nothing,\n' +
        'and the presence reconcile has nothing to reconcile. The module goes on doing work\n' +
        'with an operator believing it is switched off (Constitution XVII).\n' +
        'Hand the worker to `ctx.worker(worker)` — or `defineModuleWorker(<id>, worker)` in a\n' +
        'module still shaped as a `plugin.ts` — and keep the returned instance.\n',
    );
    for (const site of workers.violations) {
      console.error(
        `  - ${site.file}:${site.line}  [${site.moduleId}] ${site.spelling} (${site.kind})`,
      );
    }
  }
  if (workers.stale.length > 0) {
    console.error('\nStale worker-ledger entries (no longer describe an ungated consumer):');
    for (const key of workers.stale) console.error(`  - ${key}`);
  }

  if (result.violations.length > 0) {
    console.error(
      '\nA module subscribed to the EventBus outside its gating seam, so the handler\n' +
        'keeps running with the module switched off (Constitution XVII).\n' +
        'Register it from `backend.ts` with `ctx.subscribe(event, handler)`; where the\n' +
        'handler lives in a plugin body, move the registration rather than the logic.\n',
    );
    for (const entry of result.violations) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.receiver}.on('${entry.event}')`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe a bare subscription — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  const failed =
    result.violations.length > 0 ||
    result.stale.length > 0 ||
    workers.violations.length > 0 ||
    workers.stale.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
