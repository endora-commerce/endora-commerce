/**
 * CI check — an entry point with no caller **decides** presence before it works
 * (issue #126; Constitution XVII).
 *
 * Routes are gated at the `ctx.routes` seam, workers at `defineModuleWorker`,
 * subscriptions at `ctx.subscribe` — and each of those seams has a static check.
 * A timer a module starts in its own plugin body had none: `defineModuleRoutes`
 * gates *requests* through an `onRequest` hook, and a plugin body is not a
 * request, so it runs at boot whatever the module's effective state and the
 * callback keeps firing every five minutes after an operator switches the module
 * off. In `price_lists` that meant price lists went on activating and expiring on
 * a timer — it changed what customers are charged, not merely what a log said.
 *
 * The rule this enforces is the one in `AGENTS.md`, "Module enable/disable",
 * item 3: **where nothing can catch the throw, presence is decided before the
 * work, not caught after it.** A timer callback has nowhere to throw *to*, so a
 * `ModuleDisabledError` raised inside it is either swallowed by a `catch` meant
 * for transient failures or it takes out the tick. The callback therefore asks
 * `effectiveState.isPresent('<own module>')` and returns — first, and **outside**
 * the `try`, so a genuine failure and a switched-off module do not collapse into
 * one silent no-op.
 *
 * ## What this check can see
 *
 * In a module's own sources — core under `src/modules`, overlay under `src/apps`:
 *
 *   1. `setInterval(...)` — a repeating entry point, always;
 *   2. a **self-rescheduling** `setTimeout(...)`: one whose callback re-arms a
 *      timer itself, or calls back into the function that armed this one. That
 *      is `search`'s reindex tick, and it is the same entry point wearing a
 *      different constructor;
 *   3. `process.on('SIGTERM' | 'beforeExit' | 'uncaughtException' | …, …)` — the
 *      other shape with no caller to answer. The tree has none today; it is here
 *      because the rule names it and a check that waits for the first site to
 *      appear is a check that arrives after it.
 *
 * ## What it cannot see, deliberately
 *
 *   - **A one-shot `setTimeout` inside an operation that already has a caller** —
 *     an `AbortController` deadline, a sleep between retries. Its throw has
 *     somewhere to go, and the tree holds ~20 of them; flagging those would drown
 *     the two sites that matter.
 *   - **Boot hooks.** `ctx.onBoot` does have a caller: `runBootHooks` wraps every
 *     hook and turns a throw into a `ModuleCompositionError` that aborts the
 *     boot. Whether a boot hook should run at all for an absent module is one
 *     decision the kernel makes for every module in one place, not a guard each
 *     module writes — so it is not this check's business.
 *   - **A timer reached through a helper in another file**, or one whose callback
 *     is an identifier this check cannot bind to a function in the same file. The
 *     analysis is single-file and syntactic; a scheduler abstracted behind an
 *     imported helper would pass unseen. If that shape ever arrives, the check
 *     has to grow — it will not fail loudly on its own.
 *   - **"first" in "first, and outside the try".** What is enforced is *outside
 *     the try*: a presence check nested in a `try` is reported. Ordering among
 *     the statements before it is not read.
 *
 * The kernel is out of scope for the same reason as in `check-subscribe-seam`: it
 * composes before any module and has no effective state to gate on.
 *
 * Usage: `tsx scripts/check-timer-presence.ts [--list]`
 * Exit 0 = every uncatchable entry point decides presence (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read — a vacuous pass is not a pass.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { moduleOf } from './check-port-dependencies.js';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** Process-lifecycle events: a handler for one of these has no caller either. */
const PROCESS_EVENTS = new Set([
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

/** The scheduling call this finding is about. */
export type TimerConstruct = 'setInterval' | 'setTimeout' | 'process.on';

/** Why the site fails the rule. Each maps to its own line in the failure output. */
export type TimerFinding =
  /** Nothing in the callback asks `isPresent`. */
  | 'no-presence-decision'
  /** It asks, but from inside a `try` — where a switched-off module and a failed
   *  tick end up in the same `catch`. */
  | 'presence-decided-inside-try'
  /** It asks about a different module than the one that owns the file. */
  | 'presence-decided-for-another-module';

export interface UngatedTimer {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly moduleId: string;
  readonly construct: TimerConstruct;
  /** The enclosing named function, or `<module scope>` — part of the ledger key. */
  readonly scheduler: string;
  readonly finding: TimerFinding;
}

/**
 * Uncatchable entry points that may stay ungated, with the reason and the
 * question that would retire the entry.
 *
 * Keyed `<path under src/>:<scheduler>:<construct>` rather than by line, so
 * moving code inside a file does not invalidate an entry and re-opening the hole
 * does not silently inherit one. **Two-way**, in the idiom of
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered site fails the build, and a ledger
 * entry that no longer describes one fails it too.
 *
 * Unlike that ledger this one is not empty and is not expected to reach empty.
 * An entry here is a timer that must keep running while its module is off, and a
 * reason has to say why that is *correct* rather than why nobody has fixed it.
 */
export const TIMERS_WITHOUT_PRESENCE: Readonly<Record<string, string>> = {
  'modules/_lifecycle/services/lock.ts:acquireLifecycleLock:setInterval':
    'The lease heartbeat belongs to an in-flight lifecycle command that already holds the ' +
    'lock, and it stops when that command releases it. `_lifecycle` is non-deactivatable, so ' +
    'there is no state in which the gate would close — and asking the subsystem that resolves ' +
    "every module's presence whether it is present, from inside the lock that serialises " +
    'enable/disable, is circular. Retire this entry if a lease ever outlives the command that ' +
    'took it.',
};

/** `<file>:<scheduler>:<construct>` — the ledger key, and the identity of a site. */
export function keyOf(found: UngatedTimer): string {
  return `${found.file}:${found.scheduler}:${found.construct}`;
}

export interface TimerPresenceInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
}

/** The trailing identifier of a callee: `globalThis.setInterval` → `setInterval`. */
function calleeName(node: ts.CallExpression): string | null {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** The receiver of a call, as its trailing identifier: `process.on` → `process`. */
function receiverName(node: ts.CallExpression): string | null {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const receiver = expression.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (ts.isPropertyAccessExpression(receiver)) return receiver.name.text;
  return null;
}

function stringLiteralOf(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return stringLiteralOf(node.expression);
  }
  return null;
}

type FunctionLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

/** File-local `function f(){}` / `const f = () => {}` bindings, by name. */
function localFunctions(sf: ts.SourceFile): Map<string, FunctionLike> {
  const bindings = new Map<string, FunctionLike>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      bindings.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bindings;
}

/** The nearest named function around `node`, for the ledger key. */
function enclosingName(node: ts.Node): string | null {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (ts.isMethodDeclaration(cursor) && ts.isIdentifier(cursor.name)) return cursor.name.text;
    // `{ plugin: async (app) => { … } }` — the shape every module's plugin body
    // has, and the name a reader would use for it.
    if (
      ts.isPropertyAssignment(cursor) &&
      ts.isIdentifier(cursor.name) &&
      isFunctionLike(cursor.initializer)
    ) {
      return cursor.name.text;
    }
    if (
      ts.isVariableDeclaration(cursor) &&
      ts.isIdentifier(cursor.name) &&
      cursor.initializer &&
      isFunctionLike(cursor.initializer)
    ) {
      return cursor.name.text;
    }
  }
  return null;
}

/** True when the subtree contains a call to `name` (as an identifier or a tail). */
function callsAnyOf(root: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && names.has(name)) {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  root.forEachChild(visit);
  return found;
}

const TIMER_CALLS = new Set(['setInterval', 'setTimeout']);

/**
 * A `setTimeout` is this rule's business only when it repeats: the callback
 * re-arms a timer itself, or calls back into the function that armed this one.
 * That is the single shape a one-shot deadline cannot accidentally match.
 */
function isSelfRescheduling(callback: ts.Node, armedBy: string | null): boolean {
  if (callsAnyOf(callback, TIMER_CALLS)) return true;
  if (armedBy === null) return false;
  return callsAnyOf(callback, new Set([armedBy]));
}

/** Where a presence decision was found, and whether it is the right one. */
interface PresenceDecision {
  readonly decidesOwnModule: boolean;
  readonly decidesOtherModule: boolean;
  readonly insideTry: boolean;
}

/** Is `node` under a `try` that is itself inside `root`? */
function underTry(node: ts.Node, root: ts.Node): boolean {
  for (let cursor = node.parent; cursor && cursor !== root; cursor = cursor.parent) {
    if (ts.isTryStatement(cursor)) return true;
  }
  return false;
}

function presenceDecisionIn(callback: ts.Node, moduleId: string): PresenceDecision {
  let decidesOwnModule = false;
  let decidesOtherModule = false;
  let insideTry = false;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node) === 'isPresent') {
      const [argument] = node.arguments;
      const asked = argument === undefined ? null : stringLiteralOf(argument);
      if (asked === moduleId) {
        if (underTry(node, callback)) insideTry = true;
        else decidesOwnModule = true;
      } else {
        decidesOtherModule = true;
      }
    }
    node.forEachChild(visit);
  };
  visit(callback);

  return { decidesOwnModule, decidesOtherModule, insideTry };
}

/** Every uncatchable entry point in a module's sources that fails the rule. */
export function findUngatedTimers(input: TimerPresenceInput): UngatedTimer[] {
  const found: UngatedTimer[] = [];

  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`);
    // Only a module has an effective state to gate on. A file outside one — the
    // kernel, `http/`, `db/`, a composition root — is not this rule's business.
    if (moduleId === null) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = localFunctions(sf);

    const report = (node: ts.Node, construct: TimerConstruct, finding: TimerFinding): void => {
      found.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        moduleId,
        construct,
        scheduler: enclosingName(node) ?? '<module scope>',
        finding,
      });
    };

    /** Resolve the callback argument to a function body we can read. */
    const callbackOf = (argument: ts.Node | undefined): ts.Node | null => {
      if (argument === undefined) return null;
      if (isFunctionLike(argument)) return argument;
      if (ts.isIdentifier(argument)) return bindings.get(argument.text) ?? null;
      return null;
    };

    const judge = (node: ts.CallExpression, construct: TimerConstruct, callback: ts.Node): void => {
      const decision = presenceDecisionIn(callback, moduleId);
      if (decision.decidesOwnModule) return;
      if (decision.insideTry) return report(node, construct, 'presence-decided-inside-try');
      if (decision.decidesOtherModule) {
        return report(node, construct, 'presence-decided-for-another-module');
      }
      report(node, construct, 'no-presence-decision');
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        const callback = callbackOf(node.arguments[0]);

        if (name === 'setInterval') {
          // An unreadable callback is a finding, not a skip: what the check
          // cannot see, it must not vouch for.
          if (callback === null) report(node, 'setInterval', 'no-presence-decision');
          else judge(node, 'setInterval', callback);
        } else if (name === 'setTimeout' && callback !== null) {
          if (isSelfRescheduling(callback, enclosingName(node))) {
            judge(node, 'setTimeout', callback);
          }
        } else if (name === 'on' && receiverName(node) === 'process') {
          const event = node.arguments[0] ? stringLiteralOf(node.arguments[0]) : null;
          const handler = callbackOf(node.arguments[1]);
          if (event !== null && PROCESS_EVENTS.has(event)) {
            if (handler === null) report(node, 'process.on', 'no-presence-decision');
            else judge(node, 'process.on', handler);
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly UngatedTimer[];
  readonly ledgered: readonly UngatedTimer[];
  /** Ledger keys that no longer describe an ungated entry point. */
  readonly stale: readonly string[];
}

export function checkTimerPresence(
  input: TimerPresenceInput,
  ledger: Readonly<Record<string, string>> = TIMERS_WITHOUT_PRESENCE,
): CheckResult {
  const all = findUngatedTimers(input);
  const keys = new Set(all.map(keyOf));
  return {
    total: all.length,
    violations: all.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: all.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

const EXPLANATION: Readonly<Record<TimerFinding, string>> = {
  'no-presence-decision':
    'asks nothing about the module before it works — add ' +
    "`if (!effectiveState.isPresent('<module>')) return;` as the callback's first statement",
  'presence-decided-inside-try':
    'asks inside a `try`, so a switched-off module and a failed tick share one `catch` — ' +
    'move the question outside it',
  'presence-decided-for-another-module':
    'asks about a different module than the one that owns the file',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  if (files.length === 0) {
    console.error('[timer-presence] no sources under src/ — refusing to report a vacuous pass');
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(SRC_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  const result = checkTimerPresence({ sources });

  if (listMode) {
    for (const entry of findUngatedTimers({ sources })) {
      const tag = TIMERS_WITHOUT_PRESENCE[keyOf(entry)] !== undefined ? 'LEDGERED' : 'UNGATED ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler} — ${entry.finding}`,
      );
    }
    console.log('');
  }

  console.log(
    `[timer-presence] uncatchable entry points not deciding presence=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(TIMERS_WITHOUT_PRESENCE).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA module schedules work nothing can catch a throw from, and never asks whether the\n' +
        'module is present (Constitution XVII). The callback keeps firing with the module\n' +
        'switched off, so it goes on writing while an operator believes it stopped.\n' +
        "Decide it: `if (!effectiveState.isPresent('<module>')) return;` — first, and outside\n" +
        'any `try`. `backend/src/modules/ksef/plugin.ts` is the worked example.\n',
    );
    for (const entry of result.violations) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler}: ${EXPLANATION[entry.finding]}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe an ungated timer — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
