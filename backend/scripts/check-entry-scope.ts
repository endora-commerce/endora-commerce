/**
 * CI check — every non-HTTP entry point establishes a scope (feature 072, T037).
 *
 * The HTTP path has had an ambient `TenantContext` since feature 050 and now
 * gets a resolution scope with it (`kernel/request-scope-hook.ts`). Everything
 * else that starts an execution of its own had no such guarantee: measured
 * before this feature, the 15 CLI scripts mentioned `TenantContext` **zero**
 * times, two of the four interval sweeps established nothing at the timer, and
 * the webhook queue's consumer established nothing at all. They worked because
 * the rows they happen to touch carry no automatic tenant filter — an accident
 * of entity classification, not a property of the code.
 *
 * ## The population is **sites**, not files (issue #237)
 *
 * This check used to classify *files*, and said so: "a file that opens a scope
 * somewhere and forgets it elsewhere is a code-review problem". Code review is
 * what missed it. `kernel/lifecycle/registry-cache.ts` read `module_registrations`
 * and `settings` from a Redis pub/sub handler with no scope at all, and this
 * check reported the file `scoped` off a correctly-wrapped `setInterval` 130
 * lines below (issue #235). The file-level answer is a disjunction — one right
 * entry point vouches for every other one in the same file — and six files in
 * this tree carry more than one, which is precisely where a disjunction can hide
 * something.
 *
 * So an entry point is a **site**, and each site answers for itself. Six classes:
 *
 *   - **CLI scripts** — anything under a `scripts/` directory in `src/`;
 *   - **Declared programs** — a `src/` file `package.json` runs as a process of
 *     its own (see below);
 *   - **BullMQ consumers** — each `new Worker(...)` construction;
 *   - **Interval sweeps** — each repeating timer. `interval` is the *shape*, not
 *     the constructor: `setInterval`, and equally a `setTimeout` whose callback
 *     re-arms it. It is also the word the scope itself uses
 *     (`ScopeEntryPointKind`), which is why the label stays;
 *   - **Pub/sub handlers** — each `x.on('message', …)`. A message delivered off a
 *     socket the composition opened has no caller to inherit a context from;
 *     this is the class issue #235 was in, and the class this check had no
 *     population for at all;
 *   - **Process-lifecycle handlers** — each `process.on/once(...)`. Same
 *     argument, and `kernel/container.ts`'s `installShutdownDisposal` is the
 *     site that proves the file-level population could not reach it:
 *     `container.ts` is under no `scripts/` directory, is no declared program,
 *     constructs no `Worker` and starts no timer, so *no* file-level class ever
 *     contained it.
 *
 * The first two are file-level by nature — the entry is the file's own top-level
 * execution — and they keep one site per file. Their scope question is asked over
 * the file **minus** the callbacks of the site-shaped entry points in it, so a
 * program cannot read as scoped off a scope its Worker opens. That subtraction is
 * the file-level disjunction, removed at its last hiding place.
 *
 * Boot reconcilers are a seventh class and are *not* detectable: "a function the
 * composition root awaits before serving" has no syntactic marker. They are
 * covered by review and by `composition.ts` calling `enterSystemScope` for each
 * of the four.
 *
 * ## What "this site opens a scope" means, and how far it looks
 *
 * A site is scoped when `enterSystemScope` / `enterPlatformScope` is called in
 * its own callback, or in a function bound **in the same file** that the callback
 * calls — **one hop**, the depth `check-port-catches` follows `this.<method>()`
 * to. Deeper needs a call graph, which is a different project.
 *
 * Binding an identifier callback is **not** one of those hops: in
 * `new Worker(QUEUE, processor, …)`, `processor` *is* the callback, and half the
 * queues in this tree are written that way. The hop is counted from the callback
 * body. So what this cannot see, stated rather than discovered later:
 *
 *   - a callback that delegates to an **imported** function which opens the
 *     scope — reported as unscoped, and the ledger is where that gets answered;
 *   - a callback that delegates to a **method** (`this.handleMessage(…)`): only
 *     module-level bindings are resolved;
 *   - a scope opened two hops below the callback body.
 *
 * All three fail *loudly* — a site reads unscoped — which is the direction a
 * blind spot has to fail in.
 *
 * ## Why `package.json` is the second source of the population (issue #228)
 *
 * The shape classes were written from what the tree held when FR-020 landed.
 * `src/seeds/dev-catalog-seed.ts` is none of them: it is a top-level `main()`
 * that truncates and repopulates a dozen modules' tables, run by
 * `pnpm --filter backend run seed:dev`, and it established no scope. The check
 * printed `unscoped=0` — and that zero said nothing about the file, because the
 * file was never in the population.
 *
 * That is issue #215's failure by another mechanism: there the *walks* came back
 * short, here the *population definition* excluded a real entry point. Both
 * report a green that means "not looking", and nothing in the output told the
 * two apart.
 *
 * So the population has a second source, and it is not another shape: it is the
 * repository's own declaration of what it runs. Every `src/**.ts` path named by
 * a script in `backend/package.json` is a process entry point by construction —
 * `pnpm run <name>` starts it, no HTTP request is involved, and nothing above it
 * can open a scope on its behalf.
 *
 * The two sources are a **union**, and both halves are needed:
 * `sales_channels/scripts/backfill-quote-channel.ts` has no package script
 * (it is run directly), and the seed is under no `scripts/` directory. Either
 * source alone is smaller than the truth.
 *
 * Usage: `tsx scripts/check-entry-scope.ts [--list]`
 * Exit 0 = every entry site establishes a scope (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read — no sources, no sites, no declared program, a tree
 *          that is a residue of the module tree. A vacuous pass is not a pass.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  callbackOf,
  calleeName,
  enclosingName,
  findRepeatingTimerSites,
  type FunctionLike,
  localFunctions,
  MODULE_SCOPE,
  parseScript,
  receiverName,
  stringLiteralOf,
} from './lib/repeating-timers.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');

/** The two functions that open a scope. Nothing else counts as establishing one. */
const SCOPE_ENTRY_FUNCTIONS: ReadonlySet<string> = new Set([
  'enterPlatformScope',
  'enterSystemScope',
]);

/** Process-lifecycle events: a handler for one of these has no caller either. */
const PROCESS_EVENTS: ReadonlySet<string> = new Set([
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGQUIT',
  'SIGUSR1',
  'SIGUSR2',
  'beforeExit',
  'exit',
  'uncaughtException',
  'unhandledRejection',
]);

export type EntryKind = 'cli' | 'program' | 'worker' | 'interval' | 'message' | 'process';

/**
 * The construct a site was built from, spelled the way the source spells it.
 *
 * Part of the ledger key, so `setInterval` and a self-rescheduling `setTimeout`
 * are different sites even in the same function — they are different code. The
 * two file-level classes carry their own kind here: their construct *is* the
 * file.
 */
export type EntryConstruct =
  | 'cli'
  | 'program'
  | 'new Worker'
  | 'setInterval'
  | 'setTimeout'
  | "on('message')"
  | 'process.on'
  | 'process.once';

/** The scheduler slot of a file-level site: the file's own top-level execution. */
export const FILE_SCOPE = '<file>';

export interface EntrySite {
  /** Path as {@link relative} reports it — `src/...`, the spelling the ledger uses. */
  readonly file: string;
  readonly kind: EntryKind;
  readonly construct: EntryConstruct;
  /** The nearest enclosing named function, `<module scope>`, or `<file>`. */
  readonly scheduler: string;
  /** 1-based line of the construct. */
  readonly line: number;
  readonly scoped: boolean;
}

/**
 * `<file>:<scheduler>:<construct>` — the ledger key, and the identity of a site.
 *
 * Line-independent, in the idiom of `check-entry-presence.ts`'s `keyOf`: moving
 * code inside a file does not invalidate an entry, and re-opening the hole
 * somewhere else does not silently inherit one.
 *
 * A key may cover **more than one site**: `index.ts` registers `SIGINT` and
 * `SIGTERM` in the same function with the same construct, and one entry
 * answering for both is what a reader wants there. It is deliberate, and it is
 * the granularity's floor — two sites the key cannot tell apart are two sites
 * one reason has to be true of.
 */
export function keyOf(site: EntrySite): string {
  return `${site.file}:${site.scheduler}:${site.construct}`;
}

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
  'src/modules/_lifecycle/services/lock.ts:acquireLifecycleLock:setInterval':
    'Lease refresh: one Redis EVAL per tick, no EntityManager. A tenant context ' +
    'would be dead weight and the entry would emit an escape-hatch audit record ' +
    'every few seconds for the life of every lease.',

  'src/modules/settings/scripts/modules-install.ts:<file>:cli':
    'Deprecation shim: spawns `module:install` and forwards argv. The scope is ' +
    'established by the script it spawns.',

  'src/modules/settings/scripts/modules-uninstall.ts:<file>:cli':
    'Deprecation shim: spawns `module:uninstall` and forwards argv.',

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

  'src/kernel/container.ts:installShutdownDisposal:process.once':
    'Issue #237 — the site no file-level class contained: `container.ts` is under ' +
    'no `scripts/` directory, is no declared program, constructs no `Worker` and ' +
    'starts no timer, so the check that classified files had nowhere to put it. ' +
    'The handler calls `container.dispose()`, which runs the registrations\' ' +
    'disposers — closing Redis clients, queue connections and the ORM. Closing a ' +
    'connection is not a query, so there is no filter to resolve and nothing to ' +
    'attribute. Falsified the day a disposer *reads* on its way out — a final ' +
    'flush, a "worker stopped" row — which would need the scope here, at the ' +
    'signal, since a disposer has no caller of its own either.',

  "src/modules/admin_actions/services/admin-actions-service.ts:<module scope>:on('message')":
    'A synchronous, EntityManager-free cache drop: the handler compares the ' +
    'channel and calls `invalidate()`, which clears a `Map` and bumps a counter. ' +
    'Nothing is read, so nothing needs a scope; the refill happens lazily on the ' +
    'next caller\'s stack, which is a request or another entry point and already ' +
    'has one. Falsified the moment this handler *reloads* instead of dropping — ' +
    'that is issue #235 exactly, and the repair then is `enterSystemScope` here.',

  "src/modules/custom_fields/services/custom-field-definitions-cache.ts:start:on('message')":
    'The same shape and the same falsifier as the `admin_actions` handler above: ' +
    '`handleMessage` parses the payload and clears the cached definitions for one ' +
    'entity type. No EntityManager, no read — the next caller reloads, inside its ' +
    'own scope. Retire this entry the day the handler warms the cache instead of ' +
    'emptying it.',

  'src/db/migrate.ts:<file>:program':
    "The migration runner. MikroORM's migrator executes each migration through " +
    'the connection as SQL and builds no entity query, so no global tenant ' +
    'filter is ever consulted; no migration in the tree touches the ' +
    'EntityManager. Falsified the day one does — and that migration would need ' +
    'the scope, not this runner.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every spelling a site-shaped entry point can start with. Loose on purpose — see below. */
const SITE_TOKENS = /new Worker|setInterval|setTimeout|\.\s*(?:on|once)\s*\(/;

/**
 * Could this source hold a site-shaped entry point at all?
 *
 * Parsing all 1458 files under `src/` to answer "no" for most of them costs more
 * than the whole check; 54 of them contain one of these tokens anywhere, comments
 * included, and those are the ones that reach the parser.
 *
 * Deliberately **over**-inclusive, and only over-inclusive: this is a raw-text
 * test, so a comment quoting `new Worker(...)` costs one parse and nothing else —
 * the syntax tree still decides. A second, stripped pass would save four of those
 * 54 parses and pay for it with the one failure mode this check exists to remove:
 * a regex-based stripper mangling a line and silently taking a real site out of
 * the population.
 */
function mayHoldSite(source: string): boolean {
  return SITE_TOKENS.test(source);
}

/**
 * The `src/` files `package.json` runs as a process of their own.
 *
 * Read out of the **command**, not out of the script name: `seed:dev` is
 * `pnpm run migration:up && tsx --env-file-if-exists=.env src/seeds/…`, so the
 * entry point is the second of two commands behind three flags. `dist/` paths
 * are ignored (this check reads sources) and so are `scripts/` paths outside
 * `src/`, which the walk never sees.
 */
export function declaredProgramEntryPoints(packageJson: string): string[] {
  const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
  const found = new Set<string>();
  for (const command of Object.values(parsed.scripts ?? {})) {
    for (const match of command.matchAll(/\bsrc\/[\w./@-]+\.ts\b/g)) found.add(match[0]);
  }
  return [...found].sort();
}

const NOTHING_DECLARED: ReadonlySet<string> = new Set();

/**
 * The path as the ledger spells it: everything from the last `/src/` on.
 * Derived from the path itself rather than from `SRC_ROOT` so the predicates
 * here are testable without knowing where the checkout lives.
 */
export function relative(file: string): string {
  const marker = file.lastIndexOf('/src/');
  return marker === -1 ? file : file.slice(marker + 1);
}

/**
 * Which file-level class this file belongs to, or `null` for neither.
 *
 * A file under `scripts/` that is *also* declared stays `cli`: fourteen of the
 * fifteen are both, and moving them would make the count move for no reason.
 */
export function fileLevelKind(
  file: string,
  declared: ReadonlySet<string> = NOTHING_DECLARED,
): 'cli' | 'program' | null {
  if (/\/scripts\//.test(file)) return 'cli';
  if (declared.has(relative(file))) return 'program';
  return null;
}

interface ScopeSearch {
  /** How many local-binding hops are left. */
  readonly depth: number;
  /** Subtrees that belong to another site and must not answer for this one. */
  readonly skip: ReadonlySet<ts.Node>;
}

/**
 * Does `root` open a scope — directly, or one local hop down?
 *
 * The hop resolves a called identifier against the file's own function bindings,
 * which is how a `new Worker(QUEUE, processor)` whose `processor` wraps itself is
 * read correctly. It stops there on purpose; see the header for what that cannot
 * see, and why every one of those cases fails loudly rather than quietly.
 */
function opensScope(
  root: ts.Node,
  bindings: ReadonlyMap<string, FunctionLike>,
  search: ScopeSearch,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || search.skip.has(node)) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null) {
        if (SCOPE_ENTRY_FUNCTIONS.has(name)) {
          found = true;
          return;
        }
        if (search.depth > 0 && ts.isIdentifier(node.expression)) {
          const target = bindings.get(name);
          if (target !== undefined && opensScope(target, bindings, { ...search, depth: 0 })) {
            found = true;
            return;
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(root);
  return found;
}

/** A site-shaped entry point before its scope question is answered. */
interface RawSite {
  readonly kind: EntryKind;
  readonly construct: EntryConstruct;
  readonly node: ts.Node;
  /** The body that runs with no caller, or `null` when it could not be bound. */
  readonly callback: ts.Node | null;
  readonly line: number;
  readonly scheduler: string;
}

/** Every `new Worker(...)`, pub/sub handler and process-lifecycle handler in a file. */
function findConstructedSites(sf: ts.SourceFile, bindings: ReadonlyMap<string, FunctionLike>): RawSite[] {
  const sites: RawSite[] = [];
  const at = (node: ts.Node): { line: number; scheduler: string } => ({
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    scheduler: enclosingName(node) ?? MODULE_SCOPE,
  });

  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      sites.push({
        kind: 'worker',
        construct: 'new Worker',
        node,
        // BullMQ's processor is the second argument; the first is the queue name.
        callback: callbackOf(node.arguments?.[1], bindings),
        ...at(node),
      });
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const event = node.arguments[0] === undefined ? null : stringLiteralOf(node.arguments[0]);
      if (name === 'on' && event === 'message') {
        sites.push({
          kind: 'message',
          construct: "on('message')",
          node,
          callback: callbackOf(node.arguments[1], bindings),
          ...at(node),
        });
      } else if (
        (name === 'on' || name === 'once') &&
        receiverName(node) === 'process' &&
        // An event this cannot read as a literal is *in* — `container.ts` loops
        // over its signals, and a population that required a literal would have
        // no site for the one file that motivated the class.
        (event === null || PROCESS_EVENTS.has(event))
      ) {
        sites.push({
          kind: 'process',
          construct: name === 'on' ? 'process.on' : 'process.once',
          node,
          callback: callbackOf(node.arguments[1], bindings),
          ...at(node),
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return sites;
}

/**
 * Every entry site in one file, with its own scope answer.
 *
 * The top of the analysis: source **text** in, sites out. A caller — a test
 * especially — decides what the repository says it runs by passing `declared`,
 * the set `declaredProgramEntryPoints` returned.
 */
export function findEntrySites(
  file: string,
  source: string,
  declared: ReadonlySet<string> = NOTHING_DECLARED,
): EntrySite[] {
  const fileKind = fileLevelKind(file, declared);
  if (fileKind === null && !mayHoldSite(source)) return [];

  const path = relative(file);
  const sf = parseScript(file, source);
  const bindings = localFunctions(sf);

  const raw: RawSite[] = [
    ...findRepeatingTimerSites(sf).map(
      (timer): RawSite => ({
        kind: 'interval',
        construct: timer.construct,
        node: timer.call,
        callback: timer.callback,
        line: timer.line,
        scheduler: timer.scheduler,
      }),
    ),
    ...findConstructedSites(sf, bindings),
  ];

  const sites: EntrySite[] = raw.map((site) => ({
    file: path,
    kind: site.kind,
    construct: site.construct,
    scheduler: site.scheduler,
    line: site.line,
    // A callback this cannot bind to a function in this file is not vouched for.
    scoped:
      site.callback !== null &&
      opensScope(site.callback, bindings, { depth: 1, skip: new Set() }),
  }));

  if (fileKind !== null) {
    // The file's own top-level execution, asked over everything **except** the
    // bodies that belong to the sites above: a program that reads as scoped off
    // the `enterSystemScope` inside its Worker is the file-level disjunction
    // this check was rewritten to remove.
    const skip = new Set(raw.map((site) => site.callback).filter((cb): cb is ts.Node => cb !== null));
    sites.unshift({
      file: path,
      kind: fileKind,
      construct: fileKind,
      scheduler: FILE_SCOPE,
      line: 1,
      scoped: opensScope(sf, bindings, { depth: 0, skip }),
    });
  }

  sites.sort((a, b) => a.line - b.line);
  return sites;
}

export function violationsOf(sites: readonly EntrySite[]): EntrySite[] {
  return sites.filter((site) => !site.scoped && NO_SCOPE_NEEDED[keyOf(site)] === undefined);
}

/** Ledger entries that no longer name an unscoped entry site. */
export function staleAllowances(sites: readonly EntrySite[]): string[] {
  const unscoped = new Set(sites.filter((site) => !site.scoped).map(keyOf));
  return Object.keys(NO_SCOPE_NEEDED).filter((key) => !unscoped.has(key));
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  // Every CLI script, worker and sweep this check classifies is a module's, and
  // its exemptions are keyed by `src/modules/**` paths — so a walk over the
  // residue left when the module tree moves recognises almost no entry point at
  // all and still clears the `sites.length === 0` floor (issue #215).
  await refuseVacuousModulePopulation({
    prefix: '[entry-scope]',
    srcRoot: SRC_ROOT,
    files,
  });
  const declaredPaths = declaredProgramEntryPoints(
    readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf8'),
  );
  const walked = new Set(files.map(relative));
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

  const sites = files.flatMap((file) => findEntrySites(file, readFileSync(file, 'utf8'), declared));
  const violations = violationsOf(sites);
  const stale = staleAllowances(sites);

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
  // `sites` and `files` are printed because the population size is the number
  // that says whether a widening did anything: a finding count that moves
  // without it is finding something else (issues #228, #237).
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
