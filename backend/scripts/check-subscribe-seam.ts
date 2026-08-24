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
 *      goes nowhere: not into a seam call, not `return`ed, and not bound to a
 *      name this file later hands to a seam. This is the one `pwa` failed, and
 *      the one a check keyed on `new Worker(` cannot see at all.
 *
 * The factory set is **derived**, never a naming convention: pass one walks the
 * whole tree for functions that return a BullMQ `Worker` and records their
 * names, so `createPushDeliveryWorker` is recognised because of what it returns
 * and a `makeThing` that returns one would be too. A convention (`create*Worker`)
 * would have had issue #244's defect — a population defined by the presence of
 * the very habit the rule is about.
 *
 * What it cannot see, stated here rather than discovered later: a worker handed
 * across files to a caller that forgets the seam (the binding rule is one file
 * deep), a `Worker` subclass, a construction behind a computed callee, and a
 * `defineModuleWorker` called with the **wrong module id** — that last one is a
 * different rule and `pauseWorkersFor` would find the worker under a name no
 * manifest has. The seam itself is recognised by callee name — `defineModuleWorker`,
 * or any `.worker(…)` — which over-approximates in the direction of "gated": a
 * module that had some *other* collaborator with a `worker(…)` method could hide
 * a bypass inside its arguments. There is no such method in the tree, and
 * narrowing the receiver to `ctx` would refuse the next author who names their
 * `ModuleContext` something else.
 *
 * Usage: `tsx scripts/check-subscribe-seam.ts [--list]`
 * Exit 0 = every module subscription and every module queue consumer goes
 * through its seam (or is ledgered); exit 1 = at least one does not, or a ledger
 * entry is stale; exit 2 = the walk read nothing, or the BullMQ vocabulary
 * resolved to no construction at all, which is the shape a green would be a lie.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { moduleOf } from './check-port-dependencies.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';


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

  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`);
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

/** True when `node` sits inside the arguments of a `defineModuleWorker` / `ctx.worker` call. */
function insideSeamCall(node: ts.Node): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (!ts.isCallExpression(cursor)) continue;
    const callee = cursor.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (name !== null && WORKER_SEAM_CALLEES.has(name)) return true;
  }
  return false;
}

/** True when `node`'s value leaves the function — a factory hands it to its caller. */
function isHandedToCaller(node: ts.Node): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isReturnStatement(cursor)) return true;
    if (ts.isArrowFunction(cursor) && cursor.body === node) return true;
    if (ts.isFunctionLike(cursor)) return false;
  }
  return false;
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
 * Pass two — every queue-consumer site in a module's own sources, gated or not.
 *
 * The whole population is returned, not only the findings: the caller reports
 * how many it read, and a vocabulary that resolved to nothing is exit 2 rather
 * than a clean bill of health (issue #113).
 */
export function findWorkerSites(
  input: SubscribeSeamInput,
  factories: ReadonlySet<string>,
): WorkerSite[] {
  const sites: WorkerSite[] = [];

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
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name !== null && WORKER_SEAM_CALLEES.has(name)) {
          for (const argument of node.arguments) {
            if (ts.isIdentifier(argument)) registeredBindings.add(argument.text);
          }
        }
      }
      node.forEachChild(collectRegistered);
    };
    sf.forEachChild(collectRegistered);

    /** The binding a call's value lands in, when it lands in one. */
    const boundName = (node: ts.Node): string | null => {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isBinaryExpression(parent) && ts.isIdentifier(parent.left)) return parent.left.text;
      return null;
    };

    const visit = (node: ts.Node): void => {
      if (
        binding !== null &&
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === binding
      ) {
        const bound = boundName(node);
        sites.push({
          file,
          line: lineOf(node),
          moduleId: moduleOf(`/src/${file}`),
          kind: 'construction',
          spelling: `new ${binding}`,
          gated:
            insideSeamCall(node) ||
            isHandedToCaller(node) ||
            (bound !== null && registeredBindings.has(bound)),
        });
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (factories.has(callee)) {
          const bound = boundName(node);
          sites.push({
            file,
            line: lineOf(node),
            moduleId: moduleOf(`/src/${file}`),
            kind: 'registration',
            spelling: callee,
            gated:
              insideSeamCall(node) ||
              isHandedToCaller(node) ||
              (bound !== null && registeredBindings.has(bound)),
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
  const sites = findWorkerSites(input, findWorkerFactories(input));
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

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Every root a module's source can live in, derived (feature 080, T040a):
  // the application's own tree, plus each module that has become a workspace
  // package. Reading only the first would leave a moved module unjudged while
  // the floor below still passed on the union.
  const layout = await requireModuleLayout('[subscribe-seam]');
  const files = layout.sourceRoots.flatMap((root) => walk(root));

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

  const result = checkSubscribeSeam({ sources });
  const workers = checkWorkerSeam({ sources });

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
