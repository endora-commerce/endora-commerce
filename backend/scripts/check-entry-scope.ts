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
 * This check turns that accident into an invariant, so the *next* CLI script
 * cannot quietly establish nothing. It is deliberately coarse: it asks whether
 * an entry file names one of the sanctioned entry functions, not whether it
 * wraps the right expression. A file that opens a scope somewhere and forgets
 * it elsewhere is a code-review problem; a file with no scope at all is the
 * failure this catches, and it is the one that has actually happened.
 *
 * Four entry classes are detectable statically:
 *
 *   - **CLI scripts** — anything under a `scripts/` directory in `src/`.
 *   - **Declared programs** — a `src/` file `package.json` runs as a process of
 *     its own. See below.
 *   - **BullMQ consumers** — a file that constructs a `Worker`.
 *   - **Interval sweeps** — a file that starts a repeating timer. `interval` is
 *     the *shape*, not the constructor: `setInterval`, and equally a `setTimeout`
 *     whose callback re-arms it. It is also the word the scope itself uses
 *     (`ScopeEntryPointKind`), which is why the label stays.
 *
 * ## Why `package.json` is the second source of the population (issue #228)
 *
 * The first three classes are **shapes**, and the shapes were written from what
 * the tree held when FR-020 landed. `src/seeds/dev-catalog-seed.ts` is none of
 * them: it is a top-level `main()` that truncates and repopulates a dozen
 * modules' tables, run by `pnpm --filter backend run seed:dev`, and it
 * established no scope. The check printed `unscoped=0` — and that zero said
 * nothing about the file, because the file was never in the population.
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
 * can open a scope on its behalf. A new runnable file therefore enters the
 * population the day its package script is written, rather than the day someone
 * remembers to teach this file a new shape.
 *
 * The two sources are a **union**, and both halves are needed:
 * `sales_channels/scripts/backfill-quote-channel.ts` has no package script
 * (it is run directly), and the seed is under no `scripts/` directory. Either
 * source alone is smaller than the truth.
 *
 * That last class was classified by grepping for `setInterval(` until issue #128,
 * so `search`'s reindex loop — a self-rescheduling `setTimeout` — was outside the
 * population this check reports on, and the count it printed never moved because
 * it could only move for one spelling. The shape is now recognised by
 * `lib/repeating-timers.ts`, shared with `check-entry-presence`, which reads the
 * callback rather than the call: a second detector for one shape is how the two
 * drift, and the drift is what hid the site.
 *
 * Boot reconcilers are the fourth class and are *not* detectable: "a function
 * the composition root awaits before serving" has no syntactic marker. They are
 * covered by review and by `composition.ts` calling `enterSystemScope` for each
 * of the four.
 *
 * Usage: `tsx scripts/check-entry-scope.ts [--list]`
 * Exit 0 = every entry point establishes a scope; exit 1 = at least one does not.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasRepeatingTimer } from './lib/repeating-timers.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');

/** The two functions that open a scope. Nothing else counts as establishing one. */
const ENTRY_TOKENS = ['enterPlatformScope(', 'enterSystemScope('] as const;

export type EntryKind = 'cli' | 'program' | 'worker' | 'interval';

export interface EntryPoint {
  readonly file: string;
  readonly kind: EntryKind;
  readonly scoped: boolean;
}

/**
 * Files that are an entry point by shape but need no scope, each with the reason.
 *
 * Keep it short and keep the reasons falsifiable — "it currently works" is not
 * one. Paths are relative to `backend/`.
 */
export const NO_SCOPE_NEEDED: ReadonlyMap<string, string> = new Map([
  [
    'src/modules/_lifecycle/services/lock.ts',
    'Lease refresh: one Redis EVAL per tick, no EntityManager. A tenant context ' +
      'would be dead weight and the entry would emit an escape-hatch audit record ' +
      'every few seconds for the life of every lease.',
  ],
  [
    'src/modules/settings/scripts/modules-install.ts',
    'Deprecation shim: spawns `module:install` and forwards argv. The scope is ' +
      'established by the script it spawns.',
  ],
  [
    'src/modules/settings/scripts/modules-uninstall.ts',
    'Deprecation shim: spawns `module:uninstall` and forwards argv.',
  ],
  [
    'src/index.ts',
    'The HTTP server root. It composes and listens; it opens no EntityManager ' +
      'of its own. Every execution underneath it opens its own scope — ' +
      '`kernel/request-scope-hook.ts` per request, `composition.ts` and ' +
      '`kernel/compose.ts` per boot reconciler and boot hook. Falsified the day ' +
      'this file does database work directly.',
  ],
  [
    'src/worker.ts',
    'The queue-consumer process root. It composes the same graph as the API and ' +
      'never listens; every consumer opens its own scope at its `new Worker(...)`, ' +
      'and all eleven of them are in this population and scoped. The two ' +
      '`process.once` shutdown handlers close the app and dispose the ' +
      'composition — no query, nothing to scope.',
  ],
  [
    'src/db/migrate.ts',
    'The migration runner. MikroORM\'s migrator executes each migration through ' +
      'the connection as SQL and builds no entity query, so no global tenant ' +
      'filter is ever consulted; no migration in the tree touches the ' +
      'EntityManager. Falsified the day one does — and that migration would need ' +
      'the scope, not this runner.',
  ],
]);

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

/**
 * Strip comments and string literals before pattern-matching.
 *
 * Not cosmetic: two files document the rule this check enforces by quoting
 * `new Worker(...)` in a comment, and matching those made the check report the
 * two files that explain the invariant as the two that break it.
 */
export function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:[^`\\]|\\.)*`/g, "''")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, "''");
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
 * Which entry class `file` belongs to, or `null` when it is not an entry point.
 *
 * `declared` is the set `declaredProgramEntryPoints` returned, passed in rather
 * than read here so a caller — a test especially — decides what the repository
 * says it runs. A file under `scripts/` that is *also* declared stays `cli`:
 * fourteen of the fifteen are both, and moving them would make the count move
 * for no reason.
 */
export function classify(
  file: string,
  source: string,
  declared: ReadonlySet<string> = NOTHING_DECLARED,
): EntryKind | null {
  if (/\/scripts\//.test(file)) return 'cli';
  if (declared.has(relative(file))) return 'program';
  const code = stripCommentsAndStrings(source);
  if (/new Worker[<(]/.test(code)) return 'worker';
  // The repeating-timer shape is read from the syntax tree, not from the text:
  // a comment quoting the call is not a call, and a `setTimeout` is an entry
  // point only when its callback re-arms it.
  if (hasRepeatingTimer(file, source)) return 'interval';
  return null;
}

export function establishesScope(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  return ENTRY_TOKENS.some((token) => code.includes(token));
}

export function analyzeSource(
  file: string,
  source: string,
  declared: ReadonlySet<string> = NOTHING_DECLARED,
): EntryPoint | null {
  const kind = classify(file, source, declared);
  if (kind === null) return null;
  return { file, kind, scoped: establishesScope(source) };
}

/**
 * The path as the allow-list spells it: everything from the last `/src/` on.
 * Derived from the path itself rather than from `SRC_ROOT` so the predicates
 * below are testable without knowing where the checkout lives.
 */
export function relative(file: string): string {
  const marker = file.lastIndexOf('/src/');
  return marker === -1 ? file : file.slice(marker + 1);
}

export function violationsOf(entries: readonly EntryPoint[]): EntryPoint[] {
  return entries.filter((e) => !e.scoped && !NO_SCOPE_NEEDED.has(relative(e.file)));
}

/** Allow-list entries that no longer name an unscoped entry point. */
export function staleAllowances(entries: readonly EntryPoint[]): string[] {
  const unscoped = new Set(entries.filter((e) => !e.scoped).map((e) => relative(e.file)));
  return [...NO_SCOPE_NEEDED.keys()].filter((path) => !unscoped.has(path));
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  // Every CLI script, worker and sweep this check classifies is a module's, and
  // its exemptions are keyed by `src/modules/**` paths — so a walk over the
  // residue left when the module tree moves recognises almost no entry point at
  // all and still clears the `entries.length === 0` floor (issue #215).
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
        'refusing to report a vacuous pass over half this check\'s population',
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

  const entries = files
    .map((f) => analyzeSource(f, readFileSync(f, 'utf8'), declared))
    .filter((e): e is EntryPoint => e !== null);
  const violations = violationsOf(entries);
  const stale = staleAllowances(entries);

  if (listMode) {
    for (const entry of entries) {
      const tag = entry.scoped
        ? 'scoped   '
        : NO_SCOPE_NEEDED.has(relative(entry.file))
          ? 'exempt   '
          : 'UNSCOPED ';
      console.log(`${tag} ${entry.kind.padEnd(8)} ${relative(entry.file)}`);
    }
    console.log('');
  }

  // Finding no entry point at all means the classifier stopped recognising one,
  // which reads exactly like a clean tree and is not one. The per-class counts
  // printed below are the weaker signal and deliberately not asserted here: a
  // class that silently narrows to one spelling still prints a number, and did.
  if (entries.length === 0) {
    console.error(
      '[entry-scope] no entry point recognised in the whole tree — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const byKind = (kind: EntryKind): number => entries.filter((e) => e.kind === kind).length;
  // `entries` is printed because the population size is the number that says
  // whether a widening did anything: a finding count that moves without it is
  // finding something else (issue #228).
  console.log(
    `[entry-scope] entries=${entries.length} cli=${byKind('cli')} ` +
      `program=${byKind('program')} worker=${byKind('worker')} ` +
      `interval=${byKind('interval')} unscoped=${violations.length}`,
  );

  if (violations.length > 0) {
    console.error(
      '\nEntry points that establish no scope. Wrap the entry in ' +
        '`enterSystemScope(reason, …)` (kernel/scope.ts) — not the shared service it ' +
        'calls, which may also be reachable from a request:',
    );
    for (const v of violations) console.error(`  - ${v.kind}: ${relative(v.file)}`);
  }

  if (stale.length > 0) {
    console.error('\nNO_SCOPE_NEEDED names files that are no longer unscoped entry points:');
    for (const path of stale) console.error(`  - ${path}`);
  }

  if (unresolved.length > 0) {
    console.error(
      '\npackage.json runs these `src/` files and they are not in the tree — ' +
        'the population lost an entry point to a rename:',
    );
    for (const path of unresolved) console.error(`  - ${path}`);
  }

  process.exit(
    violations.length === 0 && stale.length === 0 && unresolved.length === 0 ? 0 : 1,
  );
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
