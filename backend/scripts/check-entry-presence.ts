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
 *      appear is a check that arrives after it;
 *   4. `ctx.onBoot(...)` in a **switchable** module — the fourth construct, and
 *      the reason this check is no longer named after timers (issue #146, D-68).
 *
 * Shapes 1 and 2 come from `lib/repeating-timers.ts`, which `check-entry-scope`
 * reads too (issue #128): that check classified interval entry points by
 * grepping for `setInterval(`, so the reindex loop was outside its population
 * and its unchanging count read as coverage. One recognizer, two rules — this
 * one asks whether the callback decides presence, that one whether the file
 * opens a scope. Shape 3 stays here: it has no caller to answer either, but it
 * starts no repeating execution, so it is not the shape the other check needs.
 *
 * ## Boot hooks, and why "add a probe at the top" is the wrong advice for some
 *
 * `runBootHooks` wraps every hook, attributes the failure to the module and
 * **re-throws** as `ModuleCompositionError`, which `index.ts` turns into
 * `process.exit(1)`. It does not catch, and it does not consult presence — so
 * "should this hook run for an absent module" is a decision per hook, not one
 * kernel decision, and it splits two ways (D-67/D-68):
 *
 *   - a hook that **does work** — a reconcile, a seed, a Redis or Postgres
 *     write — owes the probe a timer callback owes;
 *   - a hook that **contributes** an inert descriptor to another module's
 *     registry must **not** probe, because the host filters by contributor at
 *     enumeration and a probe would make runtime activation require a restart.
 *
 * A hook that does **both** is not repaired by a probe at all: probing it stops
 * the contribution too. `blog` and `cms` each registered an asset-reference
 * scanner beside their seed/reconcile work, and a single probe there would have
 * let an operator delete an asset a switched-off module's rows still embed —
 * data damage discovered at reactivation. Such a hook is reported as
 * `mixed-boot-hook`, with a remedy that says **split it first**; that is
 * deliberate, because two of the five working hooks in the tree were mixed and a
 * check whose only advice is "probe the top" teaches the wrong repair on 40% of
 * what it finds. `product_feeds/backend.ts` ships the split shape.
 *
 * "Does work" is recognised syntactically, the way the timer shapes are: an
 * `await` in the hook body, or a call on a receiver bound to the module's own
 * `emFactory` / `redis` / `.handle`. A body that only calls `register(…)` /
 * `push(…)` is a contribution and passes silently — which is what keeps the
 * ledger small, since ~20 of the tree's 27 hooks are contributions.
 *
 * A module whose manifest declares `activation.nonDeactivatable` is out of the
 * population: no **undeclared** absence puts its hooks in a deployment that does
 * not have it — the orchestrator refuses every withdrawal, and a composition
 * that omits the module refuses to boot (D-101). A deployment that declared the
 * omission ships neither the module nor its hooks, so there is still nothing
 * here to run. That derivation is shared with `check-port-catches`' `OWNER
 * LOCKED` through `lib/switchable-modules.ts`, so withdrawing a lock re-reds
 * both checks in the same run.
 *
 * ## What it cannot see, deliberately
 *
 *   - **A one-shot `setTimeout` inside an operation that already has a caller** —
 *     an `AbortController` deadline, a sleep between retries. Its throw has
 *     somewhere to go, and the tree holds ~20 of them; flagging those would drown
 *     the two sites that matter.
 *   - **A synchronous write reached through an imported helper**, and **a hook
 *     that awaits nothing**. Both read as contributions here. The analysis is
 *     syntactic and single-file: `seedThings(emFactory)` with no `await` and no
 *     receiver of its own is indistinguishable from `registerThings(registry)`.
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
 * Usage: `tsx scripts/check-entry-presence.ts [--list]`
 * Exit 0 = every uncatchable entry point decides presence (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read — no sources, or a manifest index that would have
 *          made every module look switchable. A vacuous pass is not a pass.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { moduleOf } from './check-port-dependencies.js';
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
import { loadLockedOwners } from './lib/switchable-modules.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';


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

/** The entry-point construct this finding is about. */
export type EntryConstruct = 'setInterval' | 'setTimeout' | 'process.on' | 'ctx.onBoot';

/** Why the site fails the rule. Each maps to its own line in the failure output. */
export type EntryFinding =
  /** Nothing in the callback asks `isPresent`. */
  | 'no-presence-decision'
  /** It asks, but from inside a `try` — where a switched-off module and a failed
   *  tick end up in the same `catch`. */
  | 'presence-decided-inside-try'
  /** It asks about a different module than the one that owns the file. */
  | 'presence-decided-for-another-module'
  /**
   * A boot hook that **does work and contributes** in one body. Neither answer
   * fits: probing it stops the contribution, leaving it unprobed keeps the work.
   * The remedy is a split, and the reported kind says so rather than repeating
   * the probe advice that is wrong here (D-68).
   */
  | 'mixed-boot-hook';

export interface UngatedEntry {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly moduleId: string;
  readonly construct: EntryConstruct;
  /**
   * The enclosing named function, or `<module scope>` — part of the ledger key.
   * A boot hook has no enclosing name worth keying on (every one of them sits in
   * `registerModule`), so it uses `onBoot#<n>`, its ordinal among the hooks the
   * file registers. That is stable under everything except reordering the hooks
   * themselves, which is a change to what each one is.
   */
  readonly scheduler: string;
  readonly finding: EntryFinding;
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

/**
 * Boot hooks that do work and may keep doing it while their module is off, with
 * the reason.
 *
 * Same key, same two-way rule and the same expectation as
 * {@link TIMERS_WITHOUT_PRESENCE}: this ledger is **not** expected to empty. An
 * entry says why a hook is *right* to run while its module is absent — which is
 * also how a contribution the syntax cannot tell from work gets recorded rather
 * than "fixed" with a probe that would break it.
 *
 * A hook reported as `mixed-boot-hook` may be ledgered too, but think twice: the
 * repair for a mixed hook is two hooks, and it is cheap. An entry here for a
 * mixed hook is a claim that the contribution beside the work is fine to lose
 * while the module is off.
 */
export const BOOT_HOOKS_WITHOUT_PRESENCE: Readonly<Record<string, string>> = {
  'modules/invoices/backend.ts:onBoot#3:ctx.onBoot':
    'Feature 078, D-95.3. The hook pins the system-default sales channel to its pre-D-95 ' +
    'numbering pattern, once, and then reports colliding patterns. It is a one-time migration ' +
    "of this module's own configuration, and activation is reversible where a migration is " +
    'not: probing presence means a deployment that happened to have `invoices` switched off ' +
    'during the upgrade gets the new `{channel}` default applied to its first channel instead, ' +
    'and its invoice numbers change shape. The write is idempotent and writes at most three ' +
    'rows, so a boot with the module off costs nothing and leaves the operator ' +
    'exactly the numbers they had. Retire this entry if the pin ever stops being one-time.',
};

/** `<file>:<scheduler>:<construct>` — the ledger key, and the identity of a site. */
export function keyOf(found: UngatedEntry): string {
  return `${found.file}:${found.scheduler}:${found.construct}`;
}

export interface EntryPresenceInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Modules whose manifest declares `activation.nonDeactivatable`, from
   * `lib/switchable-modules.ts`. Their boot hooks are out of the population: no
   * undeclared absence lets one run while the module is absent, and a declared
   * one ships neither the hook nor the module (D-101). Timers stay
   * in — `_lifecycle`'s lease heartbeat is ledgered rather than exempted, and
   * that entry is what documents the circularity behind it.
   *
   * Defaulting to empty widens the population rather than narrowing it, so a
   * caller that forgets it over-reports instead of going quietly blind.
   */
  readonly lockedModules?: ReadonlySet<string> | undefined;
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

/**
 * Names whose *use as a receiver* marks a hook body as doing work rather than
 * contributing: the module's own database factory, its Redis client and the
 * service handle its plugin returns. Passing one along (`seed(emFactory)`) is
 * not a call on it and does not count — see the header's blind spots.
 */
const WORK_RECEIVERS = new Set(['emFactory', 'em', 'redis', 'handle']);

/** Verbs a contribution uses to push a descriptor into somebody else's table. */
const CONTRIBUTION_VERBS = new Set(['register', 'push', 'unshift', 'add']);

/** Does any node under `root` satisfy `predicate`? */
function anyNode(root: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (predicate(node)) {
      hit = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(root);
  return hit;
}

/** Every identifier in a callee's property-access chain, innermost last. */
function calleeChain(node: ts.CallExpression): string[] {
  const names: string[] = [];
  let cursor: ts.Node = node.expression;
  while (ts.isPropertyAccessExpression(cursor)) {
    names.push(cursor.name.text);
    cursor = cursor.expression;
  }
  if (ts.isIdentifier(cursor)) names.push(cursor.text);
  if (ts.isCallExpression(cursor)) names.push(...calleeChain(cursor));
  return names;
}

/**
 * Does this hook body **do work** — the question that decides whether it owes a
 * presence probe?
 *
 * Syntactic, like every other shape here: an `await` anywhere in the body, a
 * call on the module's own `emFactory` / `em` / `redis` / `.handle`, or a call on
 * something the body just constructed (`new Reconciler(em).run()`).
 */
export function bootHookDoesWork(body: ts.Node): boolean {
  return anyNode(body, (node) => {
    if (ts.isAwaitExpression(node)) return true;
    if (!ts.isCallExpression(node)) return false;
    if (ts.isNewExpression(node.expression)) return true;
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isNewExpression(node.expression.expression)
    ) {
      return true;
    }
    const chain = calleeChain(node);
    // `emFactory()` itself is only a fork; what counts is a call *through* one of
    // these, which is why the receiver names are read from the chain's tail.
    return chain.slice(1).some((name) => WORK_RECEIVERS.has(name));
  });
}

/**
 * Does this hook body also **contribute** — push a descriptor into a registry
 * some other module reads?
 *
 * A `registry.register(…)` / `.push(…)` call, or a helper whose name says so
 * (`registerBlogAssetReferences(…)`). Both spellings shipped in the two mixed
 * hooks D-68 had to split.
 */
export function bootHookContributes(body: ts.Node): boolean {
  return anyNode(body, (node) => {
    if (!ts.isCallExpression(node)) return false;
    const name = calleeName(node);
    if (name === null) return false;
    if (CONTRIBUTION_VERBS.has(name)) return true;
    return /^register[A-Z]/.test(name);
  });
}

/** A `ctx.onBoot(...)` site, with the hook body this check has to classify. */
interface BootHookSite {
  readonly call: ts.CallExpression;
  readonly body: ts.Node;
  readonly line: number;
  /** 1-based position among the file's hooks — the ledger key's discriminator. */
  readonly ordinal: number;
}

/**
 * Every `onBoot(...)` registration in a file, in source order.
 *
 * The receiver is not required to be `ctx`: an overlay module composes through
 * the feature-057 factory and may name its context differently, and a hook this
 * check cannot see is exactly the hole it exists to close.
 */
function findBootHookSites(
  sf: ts.SourceFile,
  bindings: ReadonlyMap<string, FunctionLike>,
): BootHookSite[] {
  const sites: BootHookSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node) === 'onBoot') {
      const body = callbackOf(node.arguments[0], bindings);
      if (body !== null) {
        sites.push({
          call: node,
          body,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          ordinal: sites.length + 1,
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return sites;
}

/** Every uncatchable entry point in a module's sources that fails the rule. */
export function findUngatedEntries(input: EntryPresenceInput): UngatedEntry[] {
  const found: UngatedEntry[] = [];
  const locked = input.lockedModules ?? new Set<string>();

  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`);
    // Only a module has an effective state to gate on. A file outside one — the
    // kernel, `http/`, `db/`, a composition root — is not this rule's business.
    if (moduleId === null) continue;
    const sf = parseScript(file, text);
    const bindings = localFunctions(sf);

    const report = (
      node: ts.Node,
      construct: EntryConstruct,
      finding: EntryFinding,
      at?: { readonly line: number; readonly scheduler: string },
    ): void => {
      found.push({
        file,
        line: at?.line ?? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        moduleId,
        construct,
        scheduler: at?.scheduler ?? enclosingName(node) ?? MODULE_SCOPE,
        finding,
      });
    };

    const judge = (
      node: ts.CallExpression,
      construct: EntryConstruct,
      callback: ts.Node,
      at?: { readonly line: number; readonly scheduler: string },
    ): void => {
      const decision = presenceDecisionIn(callback, moduleId);
      if (decision.decidesOwnModule) return;
      if (decision.insideTry) return report(node, construct, 'presence-decided-inside-try', at);
      if (decision.decidesOtherModule) {
        return report(node, construct, 'presence-decided-for-another-module', at);
      }
      report(node, construct, 'no-presence-decision', at);
    };

    // Repeating timers come from the shared recognizer (issue #128), so this
    // check and `check-entry-scope` cannot disagree about what one is.
    for (const site of findRepeatingTimerSites(sf)) {
      const at = { line: site.line, scheduler: site.scheduler };
      // An unreadable callback is a finding, not a skip: what the check cannot
      // see, it must not vouch for.
      if (site.callback === null) report(site.call, site.construct, 'no-presence-decision', at);
      else judge(site.call, site.construct, site.callback, at);
    }

    // Process-lifecycle handlers are this check's alone: they have no caller to
    // answer either, but they start no repeating execution, so they are not the
    // shared shape.
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && calleeName(node) === 'on' && receiverName(node) === 'process') {
        const event = node.arguments[0] ? stringLiteralOf(node.arguments[0]) : null;
        const handler = callbackOf(node.arguments[1], bindings);
        if (event !== null && PROCESS_EVENTS.has(event)) {
          if (handler === null) report(node, 'process.on', 'no-presence-decision');
          else judge(node, 'process.on', handler);
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);

    // Boot hooks — the fourth construct (D-68). A module the orchestrator
    // refuses to switch off has no absent state for a hook to run in, so it is
    // out of the population; the derivation is shared with `check-port-catches`
    // so withdrawing a lock re-reds both checks on the same run.
    if (locked.has(moduleId)) continue;
    for (const site of findBootHookSites(sf, bindings)) {
      if (!bootHookDoesWork(site.body)) continue;
      const at = { line: site.line, scheduler: `onBoot#${site.ordinal}` };
      if (bootHookContributes(site.body)) {
        report(site.call, 'ctx.onBoot', 'mixed-boot-hook', at);
        continue;
      }
      judge(site.call, 'ctx.onBoot', site.body, at);
    }
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly UngatedEntry[];
  readonly ledgered: readonly UngatedEntry[];
  /** Ledger keys that no longer describe an ungated entry point. */
  readonly stale: readonly string[];
}

/** Both ledgers as one map — the keys carry their own construct, so they cannot collide. */
export const ENTRY_PRESENCE_LEDGER: Readonly<Record<string, string>> = {
  ...TIMERS_WITHOUT_PRESENCE,
  ...BOOT_HOOKS_WITHOUT_PRESENCE,
};

export function checkEntryPresence(
  input: EntryPresenceInput,
  ledger: Readonly<Record<string, string>> = ENTRY_PRESENCE_LEDGER,
): CheckResult {
  const all = findUngatedEntries(input);
  const keys = new Set(all.map(keyOf));
  return {
    total: all.length,
    violations: all.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: all.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

const EXPLANATION: Readonly<Record<EntryFinding, string>> = {
  'no-presence-decision':
    'asks nothing about the module before it works — add ' +
    "`if (!effectiveState.isPresent('<module>')) return;` as the callback's first statement",
  'presence-decided-inside-try':
    'asks inside a `try`, so a switched-off module and a failed tick share one `catch` — ' +
    'move the question outside it',
  'presence-decided-for-another-module':
    'asks about a different module than the one that owns the file',
  'mixed-boot-hook':
    'does work **and** contributes a descriptor to another module in one hook — do NOT put a ' +
    'presence check at the top of it. Split it in two first: the contribution hook stays ' +
    'unprobed (the host filters it by contributor, and probing it would make runtime ' +
    'activation require a restart, or worse — an asset-reference scanner that stops scanning ' +
    'lets an operator delete data a switched-off module still points at), the work hook gets ' +
    'the probe. `backend/src/modules/blog/backend.ts` and `product_feeds/backend.ts` ship the ' +
    'shape',
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

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[entry-presence]');
  const files = layout.sourceRoots.flatMap((root) => walk(root));
  // The locked-owner read below refuses a tree whose index went missing. It
  // does not refuse a **partial** move — index regenerated, half the modules
  // elsewhere — where the timers and boot hooks in the modules that left are
  // simply never classified and the run reports on what stayed (issue #215).
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[entry-presence]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  // Which modules an operator can switch off, read from their manifests at check
  // time (D-63's derivation, shared with `check-port-catches`). An unreadable
  // index would make every module look switchable — a *wider* population, but
  // one derived from nothing, so it exits 2 rather than reporting either colour.
  let locked: ReadonlySet<string>;
  try {
    locked = await loadLockedOwners(layout.manifestIndexPath);
  } catch (err: unknown) {
    console.error(
      `[entry-presence] the module manifests could not be read (${String(err)}) — ` +
        'refusing to classify boot hooks against a set derived from nothing',
    );
    process.exit(2);
    return;
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  const input = { sources, lockedModules: locked };
  const result = checkEntryPresence(input);

  if (listMode) {
    for (const entry of findUngatedEntries(input)) {
      const tag = ENTRY_PRESENCE_LEDGER[keyOf(entry)] !== undefined ? 'LEDGERED' : 'UNGATED ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler} — ${entry.finding}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). No `sites=`: this check
  // records the entry points that fail the rule and never counts the ones that
  // pass it, so there is no examined-site number to print without walking the
  // tree twice — ledgered in `test/helpers/check-read-sizes.ts`.
  reportReadSize({ prefix: '[entry-presence]', files: sources.size, coverage: [coverage] });
  console.log(
    `[entry-presence] uncatchable entry points not deciding presence=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(ENTRY_PRESENCE_LEDGER).length} ` +
      `locked-modules=${locked.size} stale=${result.stale.length}`,
  );

  const mixed = result.violations.filter((entry) => entry.finding === 'mixed-boot-hook');
  const plain = result.violations.filter((entry) => entry.finding !== 'mixed-boot-hook');

  if (plain.length > 0) {
    console.error(
      '\nA module starts work nothing can catch a throw from, and never asks whether the\n' +
        'module is present (Constitution XVII). A timer callback keeps firing and a boot hook\n' +
        'keeps running with the module switched off, so both go on writing while an operator\n' +
        "believes they stopped. Decide it: `if (!effectiveState.isPresent('<module>')) return;`\n" +
        '— first, and outside any `try`. `backend/src/modules/ksef/plugin.ts` (timer) and\n' +
        '`backend/src/modules/product_feeds/backend.ts` (boot hook) are the worked examples.\n',
    );
    for (const entry of plain) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler}: ${EXPLANATION[entry.finding]}`,
      );
    }
  }

  if (mixed.length > 0) {
    console.error(
      '\nA boot hook below does work **and** contributes to another module in one body.\n' +
        'Adding a presence check at the top of it is the WRONG repair: it would stop the\n' +
        'contribution as well, and a contribution the host filters by contributor is meant to\n' +
        'stay registered while its owner is off. `blog` and `cms` each registered an\n' +
        'asset-reference scanner beside their own work — probing those hooks would let an\n' +
        'operator delete an asset a switched-off module still references, which surfaces as\n' +
        'data loss at reactivation.\n\n' +
        'SPLIT IT FIRST: two `ctx.onBoot` calls — the contribution one unprobed, the work one\n' +
        'probed — then this check judges the work half on its own. See\n' +
        '`backend/src/modules/blog/backend.ts` and `backend/src/modules/cms/backend.ts`.\n',
    );
    for (const entry of mixed) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler}: ${EXPLANATION[entry.finding]}`,
      );
    }
  }

  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries (no longer describe an ungated entry point — delete them):',
    );
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
