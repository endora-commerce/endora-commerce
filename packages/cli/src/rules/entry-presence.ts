/**
 * An entry point with no caller **decides** presence before it works
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
 * work, not caught after it.**
 *
 * The whole of the reasoning — the four constructs, why a mixed boot hook is
 * reported rather than probed, and what this analysis deliberately cannot see —
 * is in `backend/scripts/check-entry-presence.ts`, the repository-scope host,
 * whose header it has always been. Two things live there rather than here and
 * both are deliberate:
 *
 *   * **the ledgers.** `TIMERS_WITHOUT_PRESENCE` and
 *     `BOOT_HOOKS_WITHOUT_PRESENCE` are entries about *these* modules, and a
 *     third-party package is in no such ledger — the same placement
 *     `check:command-coverage`'s `MIGRATED_MODULES` has. It is also load-bearing
 *     for a second reason: `check:lock-claims`' population includes
 *     `backend/scripts/check-*.ts` precisely because that is where a check's own
 *     ledger reasons live, so moving these two out of that tree would take them
 *     out of that check's population without anything saying so.
 *   * **the default for `checkEntryPresence`'s ledger argument.** It has none
 *     here: a host must state which ledger it is judging against, because
 *     "whichever one the library happened to carry" is how a package inherits
 *     this repository's exemptions.
 *
 * `specs/101-endora-check/contracts/package-scope-layout.md` §6 — one analysis,
 * two hosts.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import {
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';
import { moduleOf } from '../lib/port-registrations.js';
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
} from '../lib/repeating-timers.js';

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
  /**
   * Directories whose files belong to a module that no `modules/<id>/` segment
   * names — `lib/module-roots.ts`' `hostResidentModules` (feature 080, T040b).
   *
   * Without it `_lifecycle`'s lease heartbeat attributes to `null` and this
   * rule skips it as "not a module's file", which is the ledger entry below
   * going stale while the timer it describes is still there.
   */
  readonly hostResidentModules?: HostResidentModules | undefined;
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

  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`, hostResident);
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

export function checkEntryPresence(
  input: EntryPresenceInput,
  ledger: Readonly<Record<string, string>>,
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

export const EXPLANATION: Readonly<Record<EntryFinding, string>> = {
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


/** The sentence an author reads for one site. One spelling, two hosts. */
export function remedyFor(found: UngatedEntry): string {
  return `${found.construct} in ${found.file} (${found.scheduler}) ${EXPLANATION[found.finding]}`;
}

/**
 * Every source this rule reads under `roots`.
 *
 * One spelling, both hosts: the repository host supplies its source roots and the
 * package host supplies one package's, and neither gets to differ about which
 * files are in the population.
 */
export function collectPresenceFiles(roots: readonly string[], out: string[] = []): string[] {
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const full = join(root, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        collectPresenceFiles([full], out);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}
