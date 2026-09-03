/**
 * CI check — a non-HTTP entry point establishes its own scope (feature 072,
 * FR-020). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/entry-scope.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its six site classes, its one-hop scope search and its
 * population walk. This file resolves this repository's module walk roots, its
 * declared programs and its population floor, and it holds `NO_SCOPE_NEEDED`
 * below: a ledger is a statement about *this* tree's sites and does not travel.
 * The forwarding specifier is **bare**, never a path into `dist`.
 *
 * Usage: `tsx scripts/check-entry-scope.ts [--list]`
 * Exit 0 = every entry site establishes a scope (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read — no sources, no sites, no declared program, a tree
 *          that is a residue of the module tree. A vacuous pass is not a pass.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectEntryScopeSources,
  declaredProgramEntryPoints,
  findEntrySites,
  keyOf,
  staleAllowances,
  violationsOf,
  type EntryKind,
} from '@endora-commerce/cli/rules/entry-scope.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/entry-scope.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Entry sites that need no scope, each with the reason.
 *
 * Keep it short and keep the reasons falsifiable — "it currently works" is not
 * one, and neither is "harmless". Say what would make the entry wrong.
 *
 * **Two-way**: an unledgered unscoped site fails the build, and an entry that no
 * longer describes an unscoped site fails it too.
 */
export const NO_SCOPE_NEEDED: Readonly<Record<string, string>> = {
  'packages/platform/src/lifecycle/services/lock.ts:acquireLifecycleLock:setInterval':
    'Lease refresh: one Redis EVAL per tick, no EntityManager. A tenant context ' +
    'would be dead weight and the entry would emit an escape-hatch audit record ' +
    'every few seconds for the life of every lease.',


  'src/index.ts:<file>:program':
    'The HTTP server root. It composes and listens; it opens no EntityManager ' +
    'of its own. Every execution underneath it opens its own scope — ' +
    '`kernel/request-scope-hook.ts` per request, `composition.ts` and ' +
    '`kernel/compose.ts` per boot reconciler and boot hook. Falsified the day ' +
    'this file does database work directly.',

  'src/index.ts:main:process.once':
    'The two shutdown handlers, `SIGINT` and `SIGTERM`, under one key because ' +
    'they are one decision. Each closes the Fastify app and disposes the ' +
    'composition — no query, nothing to scope. Falsified the day shutdown ' +
    'flushes anything through the EntityManager.',

  'src/worker.ts:<file>:program':
    'The queue-consumer process root. It composes the same graph as the API and ' +
    'never listens; every consumer opens its own scope at its `new Worker(...)`, ' +
    'and all fifteen of those sites are in this population and scoped.',

  'src/worker.ts:main:process.once':
    'The same two shutdown handlers as `index.ts`, closing the app and disposing ' +
    'the composition. No query, nothing to scope.',

  'packages/platform/src/kernel/container.ts:installShutdownDisposal:process.once':
    'Issue #237 — the site no file-level class contained: `container.ts` is under ' +
    'no `scripts/` directory, is no declared program, constructs no `Worker` and ' +
    'starts no timer, so the check that classified files had nowhere to put it. ' +
    'The handler calls `container.dispose()`, which runs the registrations\' ' +
    'disposers — closing Redis clients, queue connections and the ORM. Closing a ' +
    'connection is not a query, so there is no filter to resolve and nothing to ' +
    'attribute. Falsified the day a disposer *reads* on its way out — a final ' +
    'flush, a "worker stopped" row — which would need the scope here, at the ' +
    'signal, since a disposer has no caller of its own either.',

  "packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.ts:start:on('message')":
    'A synchronous, EntityManager-free cache drop: `handleMessage` parses the ' +
    'payload and clears the cached definitions for one entity type. No ' +
    'EntityManager, no read — the next caller reloads, inside its own scope. ' +
    'Retire this entry the day the handler warms the cache instead of emptying ' +
    'it, which is issue #235 exactly and would need `enterSystemScope` here. ' +
    '(`admin_actions` had the identical entry until D-174 removed its handler: ' +
    'the module registers an `InProcessCacheLayer` and the platform\'s own ' +
    'state-changed subscriber drops it, so the module owns no `on(\'message\')` ' +
    'site at all.)',

  'src/db/migrate.ts:<file>:program':
    "The migration runner. MikroORM's migrator executes each migration through " +
    'the connection as SQL and builds no entity query, so no global tenant ' +
    'filter is ever consulted; no migration in the tree touches the ' +
    'EntityManager. Falsified the day one does — and that migration would need ' +
    'the scope, not this runner.',
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[entry-scope]');
  const files = layout.sourceRoots.flatMap((root) => collectEntryScopeSources(root));
  // Every CLI script, worker and sweep this check classifies is a module's, and
  // its exemptions are keyed by `src/modules/**` paths — so a walk over the
  // residue left when the module tree moves recognises almost no entry point at
  // all and still clears the `sites.length === 0` floor (issue #215).
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[entry-scope]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const declaredPaths = declaredProgramEntryPoints(
    readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf8'),
  );
  const walked = new Set(files.map(layout.displayOf));
  // The second population source can go short the same two ways the walk can:
  // a `scripts` block this cannot read at all, and a declaration whose file has
  // been renamed away underneath it. The first is "not looking" and exits 2;
  // the second is a package script pointing at nothing, reported below.
  if (declaredPaths.length === 0) {
    console.error(
      '[entry-scope] backend/package.json declares no `src/**.ts` entry point — ' +
        "refusing to report a vacuous pass over half this check's population",
    );
    process.exit(2);
  }
  const unresolved = declaredPaths.filter((path) => !walked.has(path));
  if (unresolved.length === declaredPaths.length) {
    console.error(
      `[entry-scope] backend/package.json declares ${declaredPaths.length} ` +
        '`src/**.ts` entry point(s) and the walk found none of them — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const declared = new Set(declaredPaths);

  const sites = files.flatMap((file) =>
    findEntrySites(file, readFileSync(file, 'utf8'), declared, layout.displayOf),
  );
  const violations = violationsOf(sites, NO_SCOPE_NEEDED);
  const stale = staleAllowances(sites, NO_SCOPE_NEEDED);

  if (listMode) {
    for (const site of sites) {
      const tag = site.scoped
        ? 'scoped   '
        : NO_SCOPE_NEEDED[keyOf(site)] !== undefined
          ? 'exempt   '
          : 'UNSCOPED ';
      console.log(
        `${tag} ${site.kind.padEnd(8)} ${site.file}:${site.line} ${site.construct} in ` +
          site.scheduler,
      );
    }
    console.log('');
  }

  // Finding no entry site at all means the classifier stopped recognising one,
  // which reads exactly like a clean tree and is not one. The per-class counts
  // printed below are the weaker signal and deliberately not asserted here: a
  // class that silently narrows to one spelling still prints a number, and did.
  if (sites.length === 0) {
    console.error(
      '[entry-scope] no entry site recognised in the whole tree — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  // The site-shaped half has its own way of going quietly blind, and the two
  // file-level classes would hide it: they come out of `package.json` and a path
  // test, so they keep printing numbers even if the syntax walk stops finding
  // anything at all. A tree with 15 `new Worker` sites in it cannot have none.
  const constructed = sites.filter((site) => site.kind !== 'cli' && site.kind !== 'program');
  if (constructed.length === 0) {
    console.error(
      '[entry-scope] no worker, timer or handler site recognised in the whole tree — ' +
        'the syntax walk found nothing and only the file-level classes answered; ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const byKind = (kind: EntryKind): number => sites.filter((site) => site.kind === kind).length;
  // What was read, in the shared grammar (issue #244): the walk's own size, the
  // entry sites classified inside it, and **both** independent derivations this
  // check's population has — the manifest index for the module tree and
  // `package.json` for the declared programs, which is the source issue #228
  // added because the three shape classes could not see `dev-catalog-seed.ts`.
  //
  // `files=` here is the walk, not `files=` on the line below it: that one
  // counts the files that *hold* a site, which moves with the findings and so
  // cannot answer "did you read the tree".
  reportReadSize({
    prefix: '[entry-scope]',
    files: files.length,
    sites: sites.length,
    coverage: [
      coverage,
      {
        source: 'package-scripts',
        expected: declaredPaths.length,
        covered: declaredPaths.length - unresolved.length,
      },
    ],
  });
  // The per-class counts below are the population size for each shape: a
  // finding count that moves without them is finding something else (issues
  // #228, #237).
  console.log(
    `[entry-scope] sites=${sites.length} files=${new Set(sites.map((s) => s.file)).size} ` +
      `cli=${byKind('cli')} program=${byKind('program')} worker=${byKind('worker')} ` +
      `interval=${byKind('interval')} message=${byKind('message')} process=${byKind('process')} ` +
      `unscoped=${violations.length} ledger-size=${Object.keys(NO_SCOPE_NEEDED).length} ` +
      `stale=${stale.length}`,
  );

  if (violations.length > 0) {
    console.error(
      '\nEntry sites that establish no scope. Wrap the site — the callback that runs with ' +
        'no caller — in `enterSystemScope(reason, …)` (kernel/scope.ts), not the shared ' +
        'service it calls, which may also be reachable from a request:',
    );
    for (const site of violations) {
      console.error(`  - ${site.kind}: ${site.file}:${site.line} ${site.construct} in ${site.scheduler}`);
    }
  }

  if (stale.length > 0) {
    console.error('\nNO_SCOPE_NEEDED names sites that are no longer unscoped entry points:');
    for (const key of stale) console.error(`  - ${key}`);
  }

  if (unresolved.length > 0) {
    console.error(
      '\npackage.json runs these `src/` files and they are not in the tree — ' +
        'the population lost an entry point to a rename:',
    );
    for (const path of unresolved) console.error(`  - ${path}`);
  }

  process.exit(violations.length === 0 && stale.length === 0 && unresolved.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
