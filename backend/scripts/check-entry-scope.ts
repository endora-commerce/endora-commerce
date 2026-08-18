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
 * Three entry classes are detectable statically:
 *
 *   - **CLI scripts** — anything under a `scripts/` directory in `src/`.
 *   - **BullMQ consumers** — a file that constructs a `Worker`.
 *   - **Interval sweeps** — a file that starts a repeating timer. `interval` is
 *     the *shape*, not the constructor: `setInterval`, and equally a `setTimeout`
 *     whose callback re-arms it. It is also the word the scope itself uses
 *     (`ScopeEntryPointKind`), which is why the label stays.
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

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** The two functions that open a scope. Nothing else counts as establishing one. */
const ENTRY_TOKENS = ['enterPlatformScope(', 'enterSystemScope('] as const;

export type EntryKind = 'cli' | 'worker' | 'interval';

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

/** Which entry class `file` belongs to, or `null` when it is not an entry point. */
export function classify(file: string, source: string): EntryKind | null {
  if (/\/scripts\//.test(file)) return 'cli';
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

export function analyzeSource(file: string, source: string): EntryPoint | null {
  const kind = classify(file, source);
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
  const entries = files
    .map((f) => analyzeSource(f, readFileSync(f, 'utf8')))
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
  console.log(
    `[entry-scope] cli=${byKind('cli')} worker=${byKind('worker')} ` +
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

  process.exit(violations.length === 0 && stale.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
