/**
 * CI check — a module subscribes to the EventBus through its own seam, never
 * through a bare `eventBus.on` (issue #107; Constitution XVII).
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
 * Usage: `tsx scripts/check-subscribe-seam.ts [--list]`
 * Exit 0 = every module subscription goes through the seam (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale.
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

  if (listMode) {
    for (const entry of findBareSubscriptions({ sources })) {
      const tag =
        BARE_SUBSCRIPTIONS_TO_DRAIN[keyOf(entry)] !== undefined ? 'LEDGERED' : 'BARE    ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.receiver}.on('${entry.event}')`,
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

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
