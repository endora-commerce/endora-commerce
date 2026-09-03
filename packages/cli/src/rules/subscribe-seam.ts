/**
 * CI check — **a module's background consumers reach the module's own seam**:
 * an EventBus subscription through `ctx.subscribe` and never a bare
 * `eventBus.on` (issue #107), a BullMQ queue consumer through `ctx.worker` /
 * `defineModuleWorker` and never a `Worker` nobody registered. Constitution
 * XVII, in both halves.
 *
 * The second signal is here rather than in a script of its own because the
 * paragraph four lines below is the one that made it look unnecessary — *"routes
 * have the `ctx.routes` seam; workers have `defineModuleWorker`; subscriptions
 * had nothing"* — and it was wrong about workers in exactly the way it says
 * subscriptions were wrong. `pwa` constructed its push-delivery `Worker` and
 * dropped the value on the floor: in no per-module registry, so
 * `pauseWorkersFor('pwa')` reached nothing and an operator who switched `pwa`
 * off went on having push notifications delivered to their customers' devices.
 * One rule, one population (a module's own sources), one ledger.
 *

 * `ctx.subscribe` wraps the handler in `subscribeForModule`, which is what makes
 * the module's effective state decide whether the handler runs at all. A
 * registration written as `eventBus.on(...)` keeps its handler attached for the
 * process lifetime, so a module an operator switched off goes on reacting to
 * every event the platform emits.
 *
 * That is worse than a route that keeps answering, because a subscriber
 * **writes**: the sweep that produced this check found twenty-two such
 * registrations across nine modules; **ten** wrote to the platform's own
 * database — an invoice issued and e-mailed, a quote request flipped to
 * Completed, a push message row created and delivered to a device, a shopping
 * list created, a threshold row mirrored, a feed's and a PIM import's next-run
 * stamp written back — and **twenty-one of the twenty-two** mutated something,
 * the exception being `catalog`'s cache flush at the storefront.
 *
 * Routes have `check-kernel-boundary` and the `ctx.routes` seam; workers have
 * `defineModuleWorker`; subscriptions had nothing, which is why twenty-two
 * accumulated while every one of those modules' conversion tasks read done.
 *
 * ## What counts as a subscription
 *
 * A call `<receiver>.on(<event>, <handler>)` in a file that belongs to a module
 * — core under `src/modules`, overlay under `src/apps` — where the receiver
 * reads as an event bus. Three
 * signals, because the receiver is spelled several ways and the check follows
 * the shape rather than one literal:
 *
 *   1. the receiver's trailing identifier is bus-shaped — `eventBus`, `bus`,
 *      `events`, `options.eventBus`, `this.deps.eventBus`;
 *   2. the receiver is a cast around one — `(options.eventBus as CategoryEventBus).on`;
 *   3. the first argument is a **domain event name** (`a.b`, `a.b.v1`), which is
 *      what distinguishes a bus from a BullMQ worker (`'completed'`), an ioredis
 *      subscriber (`'message'`) and a Node stream (`'data'`).
 *
 * The kernel is deliberately out of scope. `src/kernel/settings` and
 * `src/kernel/sales-channels` each attach a cache invalidator with a bare
 * `eventBus.on`, and that is correct: the kernel composes before any module and
 * has no effective state to gate on — there is no operator switch that makes the
 * settings cache stop invalidating.
 *
 * ## What counts as a queue consumer
 *
 * Two findings, because the tree spells the same thing two ways and only one of
 * them names `Worker` at the site that matters:
 *
 *   1. **`ungated-construction`** — `new Worker(...)` in a module's own sources,
 *      where `Worker` is the binding the file imported from `bullmq`, and the
 *      value neither goes into a seam call nor is `return`ed. Returning it is
 *      what a *factory* does, and a factory is not the registration: ten of the
 *      fifteen constructions in the tree sit in a `services/queues/*.ts` whose
 *      caller wraps them.
 *   2. **`ungated-registration`** — a call to one of those factories whose value
 *      goes nowhere. This is the one `pwa` failed, and the one a check keyed on
 *      `new Worker(` cannot see at all.
 *
 * "Goes nowhere" is four questions, and each was a real shape in the tree when
 * this landed: it is not inside a seam call; it is not `return`ed; it is not
 * bound to a name this file later hands to a seam; and it is not bound to a name
 * this function **returns** — which is `pwa`'s repaired shape
 * (`const workers = […]; return { plugin, handle, workers }`) and `ksef`'s
 * (`worker = createKsefSubmitWorker(…)`, returned as `workers: worker ? [worker] : []`).
 * The last one is what T051's conversion made the common case: a module's
 * `plugin.ts` collects its workers and its `backend.ts` hands each to
 * `ctx.worker`, so the value crosses a file boundary. The analysis stops at the
 * return — it does not follow the value into the caller — which is stated here
 * rather than pretended away. What it still catches is the drop on the floor.
 *
 * The **seam** is likewise not two literals: `catalog` and `newsletter` take a
 * `registerWorker(worker, options)` callback from their own `backend.ts` whose
 * body is `ctx.worker(worker, options)`, so the forwarder names are derived from
 * the bodies that call the seam, exactly as the factory names are derived from
 * what they return. Neither set is written down; the next module will name both
 * something else.
 *
 * The factory set is **derived**, never a naming convention: pass one walks the
 * whole tree for functions that return a BullMQ `Worker` and records their
 * names, so `createPushDeliveryWorker` is recognised because of what it returns
 * and a `makeThing` that returns one would be too. A convention (`create*Worker`)
 * would have had issue #244's defect — a population defined by the presence of
 * the very habit the rule is about.
 *
 * What it cannot see, stated here rather than discovered later: a worker handed
 * across files to a caller that forgets the seam (the analysis stops at the
 * return), a `Worker` subclass, a construction behind a computed callee, and a
 * `defineModuleWorker` called with the **wrong module id** — that last one is a
 * different rule and `pauseWorkersFor` would find the worker under a name no
 * manifest has. The seam itself is recognised by callee name — `defineModuleWorker`,
 * or any `.worker(…)` — which over-approximates in the direction of "gated": a
 * module that had some *other* collaborator with a `worker(…)` method could hide
 * a bypass inside its arguments. There is no such method in the tree, and
 * narrowing the receiver to `ctx` would refuse the next author who names their
 * `ModuleContext` something else.
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis. `backend/scripts/check-subscribe-seam.ts` hosts it
 * over this repository's source roots; `endora check` hosts it over one module
 * package (`specs/101-endora-check/contracts/package-scope-layout.md` §6).
 *
 * The worker half's exit-2 floor — *no BullMQ worker site at all* — is a
 * statement about a **repository** whose tree is known to hold queue consumers.
 * A single package holding none is the ordinary case, so the package-scope host
 * declares that floor unevaluated on the rule's own line rather than refusing;
 * see `contracts/exit-reduction.md` § 1's partial verdict.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import {
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';
// `moduleOf` — attribute a file to a module over every root a module can live
// in — has its one CLI-side home in the relocated container-imports rule. The
// two copies still standing in `backend/scripts/` (this check's former import
// from `check-port-dependencies.ts`, and `check-container-imports.ts`' own) are
// pre-existing residue of the estate's growth, not something this relocation
// introduced; a third copy here would be.
import { moduleOf } from './container-imports.js';

/** An event name the payload of which is a domain event: `a.b`, `a.b.v1`. */
const DOMAIN_EVENT = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** A receiver whose trailing name says "event bus" whatever it is typed as. */
const BUS_RECEIVER = /^(event_?bus|bus|events|eventEmitter)$/i;

/** What the key carries when the subscription's event name is not a literal. */
const DYNAMIC = '<dynamic>';

/**
 * Bare subscriptions that may stay bare, with the reason and the question that
 * would retire the entry.
 *
 * Keyed `<path under src/>:<event>` rather than by line, so moving code inside a
 * file does not invalidate an entry and re-opening the hole does not silently
 * inherit one. **Two-way**, in the idiom of `PORT_CATCHES_TO_DRAIN` and
 * `WIRING_RESOLUTIONS_TO_DRAIN`: an unledgered bare subscription fails the
 * build, and a ledger entry that no longer describes one fails it too.
 *
 * It is empty, and that is the point: every module subscription in the tree goes
 * through `ctx.subscribe`. An entry here is a module that reacts to events while
 * an operator believes it is switched off, so a reason has to say why that is
 * the least-wrong behaviour rather than that nobody has moved it yet.
 */
export const BARE_SUBSCRIPTIONS_TO_DRAIN: Readonly<Record<string, string>> = {};

/**
 * Queue consumers that may stay outside the seam, with the reason and the
 * question that would retire the entry.
 *
 * Keyed `<path under src/>:<spelling>`, two-way, and empty for the same reason
 * the subscription ledger is: a worker outside `ctx.worker` is a module doing
 * work while an operator believes it is switched off, and there is no per-worker
 * remedy — the registry is the only thing `pauseWorkersFor` and the presence
 * reconcile can reach. An entry has to say why *that* is the least-wrong
 * behaviour.
 */
export const WORKERS_OUTSIDE_THE_SEAM: Readonly<Record<string, string>> = {};

/** The seam a module's queue consumer has to reach, in the two spellings. */
const WORKER_SEAM_CALLEES = new Set(['defineModuleWorker', 'worker']);

/**
 * Every file the seam rule judges, under `roots`.
 *
 * Exported because both hosts walk: the repository's source roots and one
 * package's. A second copy would be two definitions of one population.
 */
export function collectSeamFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => walk(root));
}

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

export interface BareSubscription {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly moduleId: string;
  /** The event literal, or `<dynamic>` when the name is computed. */
  readonly event: string;
  /** The receiver as written, for the failure message. */
  readonly receiver: string;
}

/** `<file>:<event>` — the ledger key, and the identity of a site. */
export function keyOf(found: BareSubscription): string {
  return `${found.file}:${found.event}`;
}

export interface SubscribeSeamInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Directories whose files belong to a module no `modules/<id>/` segment names
   * — `lib/module-roots.ts`' `hostResidentModules` (feature 080, T040b).
   * Without it those files attribute to `null` and both halves of this check
   * read them as "not a module's", which is a clean line over an unprotected
   * subtree.
   */
  readonly hostResidentModules?: HostResidentModules | undefined;
}

/** The trailing identifier of a receiver: `this.deps.eventBus` → `eventBus`. */
function tailName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return tailName(node.expression);
  }
  return null;
}

/** The string an argument denotes, through any number of casts. */
function stringLiteralOf(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return stringLiteralOf(node.expression);
  }
  return null;
}

/** Every `<bus>.on(<event>, <handler>)` in a module's own sources. */
export function findBareSubscriptions(input: SubscribeSeamInput): BareSubscription[] {
  const found: BareSubscription[] = [];

  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;
  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`, hostResident);
    // Only a module has an effective state to gate on. A file outside one —
    // the kernel, `http/`, `db/`, a composition root — is not this rule's
    // business.
    if (moduleId === null) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'on' &&
        node.arguments.length >= 2
      ) {
        const receiver = tailName(node.expression.expression);
        const [nameArgument] = node.arguments;
        // `'order.status_changed.v1' as never` is the spelling `pwa` used to
        // satisfy an untyped bus, so the cast is unwrapped before the literal
        // is read — otherwise the ledger key would say `<dynamic>` for an event
        // written out in full.
        const literal = nameArgument === undefined ? null : stringLiteralOf(nameArgument);
        const looksLikeBus = receiver !== null && BUS_RECEIVER.test(receiver);
        const looksLikeDomainEvent = literal !== null && DOMAIN_EVENT.test(literal);
        if (looksLikeBus || looksLikeDomainEvent) {
          found.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            moduleId,
            event: literal ?? DYNAMIC,
            receiver: receiver ?? '(expression)',
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

/* ------------------------------------------------------------------ workers */

export type WorkerSiteKind = 'construction' | 'registration';

export interface WorkerSite {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** `null` outside a module — a factory in a shared directory, say. */
  readonly moduleId: string | null;
  readonly kind: WorkerSiteKind;
  /** `new Worker` or the factory's name, for the failure message and the key. */
  readonly spelling: string;
  /** Reached `defineModuleWorker` / `ctx.worker`, or was handed to a caller. */
  readonly gated: boolean;
}

/** `<file>:<spelling>` — the ledger key, and the identity of a site. */
export function workerKeyOf(site: WorkerSite): string {
  return `${site.file}:${site.spelling}`;
}

/** The local name a file bound BullMQ's `Worker` to, if it imported one. */
function bullmqWorkerBinding(sf: ts.SourceFile): string | null {
  let binding: string | null = null;
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (stringLiteralOf(statement.moduleSpecifier) !== 'bullmq') continue;
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      // `import { Worker }` and `import { Worker as BullWorker }` alike: what
      // matters is the *imported* name, and the local one is what the site says.
      if ((element.propertyName ?? element.name).text === 'Worker') {
        binding = element.name.text;
      }
    }
  }
  return binding;
}

/** The callee's own name, whichever of the two shapes it is written in. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** True when `node` sits inside the arguments of a call to a seam or a forwarder. */
function insideSeamCall(node: ts.Node, seams: ReadonlySet<string>): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (!ts.isCallExpression(cursor)) continue;
    const name = calleeName(cursor);
    if (name !== null && seams.has(name)) return true;
  }
  return false;
}

/** True when `node`'s value is itself returned — a factory hands it to its caller. */
function isHandedToCaller(node: ts.Node): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isReturnStatement(cursor)) return true;
    if (ts.isArrowFunction(cursor) && cursor.body === node) return true;
    if (ts.isFunctionLike(cursor)) return false;
  }
  return false;
}

/**
 * The name a call's value lands in, through the wrappers that do not change
 * whose value it is: an array or object literal, a conditional, a cast, a
 * `push` onto a collection.
 *
 * `const workers = runWorkers ? [createXWorker(…)] : []` and
 * `worker = createXWorker(…)` both answer with the collection's name, which is
 * what the two rules below then ask about.
 */
function boundCollectionName(node: ts.Node): string | null {
  let current: ts.Node = node;
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isVariableDeclaration(cursor) && ts.isIdentifier(cursor.name)) return cursor.name.text;
    if (
      ts.isBinaryExpression(cursor) &&
      cursor.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(cursor.left)
    ) {
      return cursor.left.text;
    }
    if (ts.isCallExpression(cursor) && calleeName(cursor) === 'push') {
      const receiver = cursor.expression;
      if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression)) {
        return receiver.expression.text;
      }
      return null;
    }
    const transparent =
      ts.isArrayLiteralExpression(cursor) ||
      ts.isObjectLiteralExpression(cursor) ||
      ts.isPropertyAssignment(cursor) ||
      ts.isShorthandPropertyAssignment(cursor) ||
      ts.isConditionalExpression(cursor) ||
      ts.isParenthesizedExpression(cursor) ||
      ts.isAsExpression(cursor) ||
      ts.isNonNullExpression(cursor);
    if (!transparent) return null;
    current = cursor;
  }
  void current;
  return null;
}

/** Every identifier mentioned in a `return` of the function that encloses `node`. */
function namesReturnedFromEnclosingFunction(node: ts.Node): Set<string> {
  let fn: ts.Node | undefined;
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionLike(cursor)) {
      fn = cursor;
      break;
    }
  }
  const names = new Set<string>();
  if (!fn) return names;
  const collect = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) names.add(n.text);
    if (ts.isShorthandPropertyAssignment(n)) names.add(n.name.text);
    n.forEachChild(collect);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && n !== fn) return;
    if (ts.isReturnStatement(n) && n.expression) collect(n.expression);
    n.forEachChild(visit);
  };
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (body && !ts.isBlock(body)) {
    collect(body);
    return names;
  }
  if (body) body.forEachChild(visit);
  return names;
}

/** The nearest enclosing function's name, for the factory index. */
function enclosingFunctionName(node: ts.Node): string | null {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) || ts.isMethodDeclaration(cursor)) {
      return cursor.name && ts.isIdentifier(cursor.name) ? cursor.name.text : null;
    }
    if (ts.isFunctionExpression(cursor) || ts.isArrowFunction(cursor)) {
      const parent = cursor.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      return null;
    }
  }
  return null;
}

/**
 * Pass one — every function in the walked tree that returns a BullMQ `Worker`.
 *
 * Derived rather than conventional (see the header): the second finding needs to
 * know that `createPushDeliveryWorker(...)` **is** a worker, and the only honest
 * source for that is what the function returns.
 */
export function findWorkerFactories(input: SubscribeSeamInput): Set<string> {
  const names = new Set<string>();
  for (const [file, text] of input.sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const binding = bullmqWorkerBinding(sf);
    if (binding === null) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === binding) {
        if (isHandedToCaller(node)) {
          const name = enclosingFunctionName(node);
          if (name !== null) names.add(name);
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return names;
}

/**
 * Pass one-and-a-half — the names that **forward** to the seam.
 *
 * `catalog` and `newsletter` take a `registerWorker(worker, options)` callback
 * from their own `backend.ts`, whose body is `ctx.worker(worker, options)`. That
 * is the seam reached one hop away, and a rule that knew only the two literal
 * spellings would report both modules as bypassing it. The set is **derived**
 * from the bodies rather than written down, for the reason the factory set is:
 * the next module will name its callback something else.
 */
export function findSeamForwarders(input: SubscribeSeamInput): Set<string> {
  const names = new Set<string>();
  for (const [file, text] of input.sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        const body = node.initializer;
        if ((ts.isArrowFunction(body) || ts.isFunctionExpression(body)) && callsSeam(body)) {
          names.add(node.name.text);
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return names;
}

/** Does this function body call one of the two literal seam spellings? */
function callsSeam(fn: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && WORKER_SEAM_CALLEES.has(name)) found = true;
    }
    node.forEachChild(visit);
  };
  fn.forEachChild(visit);
  return found;
}

/**
 * Pass two — every queue-consumer site in a module's own sources, gated or not.
 *
 * The whole population is returned, not only the findings: the caller reports
 * how many it read, and a vocabulary that resolved to nothing is exit 2 rather
 * than a clean bill of health (issue #113).
 */
export function findWorkerSites(
  input: SubscribeSeamInput,
  factories: ReadonlySet<string>,
  forwarders: ReadonlySet<string> = new Set(),
): WorkerSite[] {
  const sites: WorkerSite[] = [];
  const seams = new Set([...WORKER_SEAM_CALLEES, ...forwarders]);
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;

  for (const [file, text] of input.sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const binding = bullmqWorkerBinding(sf);
    const lineOf = (node: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    // One file-local pass first: which names does this file hand to a seam? A
    // module that writes `const w = createXWorker(…)` and registers `w` two
    // lines down is right, and the check has to be able to say so.
    const registeredBindings = new Set<string>();
    const collectRegistered = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        if (name !== null && seams.has(name)) {
          for (const argument of node.arguments) {
            if (ts.isIdentifier(argument)) registeredBindings.add(argument.text);
          }
        }
      }
      node.forEachChild(collectRegistered);
    };
    sf.forEachChild(collectRegistered);

    /**
     * Gated when the value reaches the seam here, or leaves this function for a
     * caller that will. Since the T051 conversion the second is the common
     * shape: a module's `plugin.ts` collects its workers and its `backend.ts`
     * hands each to `ctx.worker`, so the value crosses a file boundary and this
     * analysis stops at the return — stated in the header rather than pretended
     * away. What it still catches is the drop on the floor, which is the defect.
     */
    const isGated = (node: ts.Node): boolean => {
      if (insideSeamCall(node, seams) || isHandedToCaller(node)) return true;
      const bound = boundCollectionName(node);
      if (bound === null) return false;
      return registeredBindings.has(bound) || namesReturnedFromEnclosingFunction(node).has(bound);
    };

    const visit = (node: ts.Node): void => {
      if (
        binding !== null &&
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === binding
      ) {
        sites.push({
          file,
          line: lineOf(node),
          moduleId: moduleOf(`/src/${file}`, hostResident),
          kind: 'construction',
          spelling: `new ${binding}`,
          gated: isGated(node),
        });
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (factories.has(callee)) {
          sites.push({
            file,
            line: lineOf(node),
            moduleId: moduleOf(`/src/${file}`, hostResident),
            kind: 'registration',
            spelling: callee,
            gated: isGated(node),
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  sites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return sites;
}

export interface WorkerSeamResult {
  /** Every site read, gated or not — the population, for the read-size line. */
  readonly sites: readonly WorkerSite[];
  readonly violations: readonly WorkerSite[];
  readonly ledgered: readonly WorkerSite[];
  readonly stale: readonly string[];
}

export function checkWorkerSeam(
  input: SubscribeSeamInput,
  ledger: Readonly<Record<string, string>> = WORKERS_OUTSIDE_THE_SEAM,
): WorkerSeamResult {
  const sites = findWorkerSites(input, findWorkerFactories(input), findSeamForwarders(input));
  // Only a module has an effective state to gate on; a factory in a shared
  // directory is judged where it is called.
  const ungated = sites.filter((site) => !site.gated && site.moduleId !== null);
  const keys = new Set(ungated.map(workerKeyOf));
  return {
    sites,
    violations: ungated.filter((site) => ledger[workerKeyOf(site)] === undefined),
    ledgered: ungated.filter((site) => ledger[workerKeyOf(site)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly BareSubscription[];
  readonly ledgered: readonly BareSubscription[];
  /** Ledger keys that no longer describe a bare subscription — the staleness half. */
  readonly stale: readonly string[];
}

export function checkSubscribeSeam(
  input: SubscribeSeamInput,
  ledger: Readonly<Record<string, string>> = BARE_SUBSCRIPTIONS_TO_DRAIN,
): CheckResult {
  const all = findBareSubscriptions(input);
  const keys = new Set(all.map(keyOf));
  return {
    total: all.length,
    violations: all.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: all.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

