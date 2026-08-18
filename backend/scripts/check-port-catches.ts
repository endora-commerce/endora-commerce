/**
 * CI check — a `catch` around a gated-port call may not swallow the module's
 * presence answer (issue #84; the deferred half of feature 072's D-43).
 *
 * `lazyPort` resolves the name inside the *forwarded call*, so a switched-off
 * owner surfaces as `ModuleDisabledError` at the call site rather than at
 * wiring time. A `try { … } catch { return null }` around one therefore
 * converts fail-closed into fail-open, and does it silently: the caller answers
 * "no data" where the truthful answer is "this capability is off", and the
 * operator reads a working screen that is lying to them.
 *
 * The measured shape, before this check existed: 51 `try` blocks in `src/**`
 * reached a gated port; 27 already re-threw, and 24 did not. They were not one
 * bug repeated — they were three:
 *
 *   - **defensive** — a `catch` over a port whose own return type already says
 *     "nothing applies" (`resolveLinePrice` → `null`, `taxRateFor` →
 *     `{ rate: 0, source: 'none' }`). The `catch` adds nothing except the
 *     ability to hide a 503. Deleted.
 *   - **a degrade that belongs to the owner** — the caller genuinely wants "no
 *     restriction" or "no data" as an answer, in which case the answer belongs
 *     in the port's return type (`allowedIdsFor(): Promise<string[] | null>` is
 *     the repo's worked example), not in a `catch` at the call site.
 *   - **a narrow tolerance that is correct** — a per-item import failure
 *     recorded as an issue, a compensating cleanup on a rollback path. Those
 *     keep the `catch` and add `rethrowIfModuleDisabled(error)`, because a
 *     presence answer is about the whole operation rather than the one item: an
 *     import that "completed with 4 000 failures" is a worse report than one
 *     that stopped and named the module that is off.
 *
 * ## What counts as a gated-port call
 *
 * A gated port is a name registered through `ctx.di.providePort`. Reaching one
 * is spelled several ways, and the check follows the value rather than the
 * literal:
 *
 *   1. the port name itself, read from a cradle or destructured — `taxService`;
 *   2. a **local alias** a module binds to a `lazyPort` proxy —
 *      `const cartService = lazyPort<CartService>(ctx, 'cartService')`;
 *   3. a **deps-object key** or **constructor parameter** the proxy is passed
 *      as — `promotion: lazyPort(ctx, 'promotionService')` reached later as
 *      `this.promotion.applyToCart(…)`. This is the dominant shape by far: 121
 *      of the tree's ~130 `lazyPort` calls are property assignments in a deps
 *      object, so a check that only knew the port's own name would see almost
 *      none of them.
 *   4. a **holder built around it** — `new CartPricingRecompute(em,
 *      lazyPort(ctx, 'pricingService'), cache)` reached later as
 *      `deps.cartPricingRecompute.recompute(…)`. The `catch` wraps the holder,
 *      never the resolution (issue #133).
 *   5. a **name a root contributes** — `registerValues(container, {
 *      shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor() })`,
 *      resolved by the module as an ordinary cradle name. No `lazyPort` literal
 *      appears anywhere on that path (issue #113).
 *
 * Shapes 4 and 5 were one blind spot seen twice: the port arrived by a route the
 * analysis did not walk. Both close with **one** mechanism — the alias table is
 * a *fixpoint over port-carrying values* rather than a scan for `lazyPort`
 * literals. A value carries the gate if it is a resolution, if it is
 * constructed from one, if it is handed to a factory, or if it is a closure
 * whose body reads one; every name such a value is bound to becomes an alias,
 * and that feeds the next round until nothing new appears. Shape 4 is the round
 * that binds the holder; shape 5 is the round that binds a root's registration
 * key. Two shapes, one loop — which is why they are not two checks.
 *
 * What does **not** carry is as load-bearing as what does, and each exclusion
 * paid for itself in false positives when it was missing:
 *
 *   - **a call's result** — `proxy.applyToCart(…)` *is* the gated call, but the
 *     discount it returns is data. Propagating through an arbitrary callee made
 *     an alias of every local downstream of a port, `JSON.stringify` included;
 *   - **an object literal** — a deps bag is a record, not a port. Tainting the
 *     bag made `this.deps.<anything>()` in the receiving class a port call, 39
 *     of them in one run;
 *   - **a field read off a port** — `p.attributeValues[key]` is a value.
 *
 * ## The one hop backwards, and why it is not that propagation (D-88)
 *
 * A **method of the same class** whose body reaches a gated port is itself a
 * carrier *for the purposes of a `catch` around a call to it*. So
 * `try { await this.settlePaid(…) } catch { … }` is judged exactly as
 * `try { await this.receiveHandler.receive(…) } catch { … }` is.
 *
 * The next reader of "a call's **result** does not carry", sitting three lines
 * above a rule that follows calls, will assume one of the two is wrong. They are
 * not, and the difference is **directional**. The excluded rule runs *forward*:
 * from a port, through an arbitrary callee, into every local downstream of the
 * value it returned — which is how `JSON.stringify(x)` became a port and why one
 * run produced 39 false findings. This one runs *backward*: from a **callee's
 * body** to the **call site**, inside one class. Nothing about a value's
 * contents is inferred; the gates the method carries are exactly the gates its
 * body reaches, which is what feeds D-63's `OWNER LOCKED` derivation unchanged.
 *
 * The limit is `this`, and only `this`:
 *
 *   - **same class only** — `this.<name>(…)` where `<name>` is declared in the
 *     enclosing class. Not a free function, not an imported helper, not a method
 *     on an injected collaborator that is not itself a port.
 *   - **transitive through the class** — a private method calling another
 *     private method that reaches a gate carries too, bounded by the same
 *     fixpoint round-cap the alias table uses.
 *
 * What is **not** seen, deliberately: a helper in another file reached through
 * an import, a callback passed in from outside the class, a method on an
 * injected collaborator. Each of those is a value crossing a file boundary,
 * where the check would need whole-program call-graph resolution to stay
 * precise and where "port-carrying" stops being decidable from names. A class is
 * the one scope where the callee's body and the call site are guaranteed to be
 * in the same author's hands, which is why the line is drawn there and not one
 * hop further.
 *
 * The blast radius was measured before the widening landed: **8 sites, 7 of them
 * already correct by hand** — six payment and shipping gateways that each
 * derived the answer themselves and wrote three to five lines of comment
 * justifying it, plus one that re-throws unconditionally — and **one live
 * fail-open**, `organizations/services/org-registration-notifier.ts`, where
 * `onError?.(err)` swallowed a 503 from `admin_notifications` and every
 * organization registration went silently un-notified. That is the shape the
 * hop exists for: a public `handle(payload)`, a `try` around the domain
 * application, and private methods underneath that reach the port. It is the
 * dominant integration skeleton in this tree, which makes it the worst possible
 * place for a check to stop looking.
 *
 * Aliases are **scoped**, and by the scope the binding actually has. A `const`
 * is file-scoped, because it is: `catalog` renames its bulk-operation service to
 * `queue` in one file and holds a BullMQ queue under the same spelling in
 * another. A deps-object key or a constructor parameter is module-scoped,
 * because the receiving class reads it from another file. A root's container
 * registration is visible everywhere, because a container name is global by
 * construction. A gated port's own name is global too, *except inside the module
 * that owns it*, where the same identifier normally denotes the module's own
 * instance — `invoices` holds a real `invoiceService` and never resolves its own
 * port.
 *
 * `PORT_CATCH_WHY=1` prints every alias with the site that introduced it, which
 * is the first question a newly-red site raises.
 *
 * ## What counts as handling it
 *
 * A `catch` passes when it does one of four things:
 *
 *   - re-throws unconditionally (its last statement is a `throw`);
 *   - calls `rethrowIfModuleDisabled(error)` — the kernel's one-line narrowing;
 *   - names `ModuleDisabledError` itself;
 *   - hands the error to a **delegate that re-throws it** — a helper whose last
 *     statement is `throw <its own parameter>` (`toCatalogHttpError(…): never`)
 *     or whose body calls the narrowing on the caller's behalf
 *     (`ReturnEmailNotifier#contained`). Without this the widening reported
 *     eight sites that were already correct.
 *
 * Anything else is a violation, including `catch (err) { if (rare) throw err; }`
 * — a conditional re-throw is exactly the shape that keeps the presence answer.
 * Adding the one-line call is cheaper than teaching a static check to read a
 * condition, and it says at the site what the site decided.
 *
 * ## `OWNER LOCKED` — the answer the check derives for itself (D-63)
 *
 * A `catch` can only swallow a presence answer that is **reachable**. When
 * every gate the alias carries belongs to a module whose manifest declares
 * `activation.nonDeactivatable`, there is no state in which that gate says no:
 * the orchestrator refuses the flip on both axes, with no `--force`. The site
 * is reported as `OWNER LOCKED` rather than as a violation to drain, and a
 * ledger entry for one reads **stale** — there is nothing left to repair, so a
 * note saying "drain me" is a debt the tree does not owe.
 *
 * It is derived from `manifest.ts` on every run rather than written into a
 * reason string, and that is the whole of its safety: an owner who un-locks a
 * module re-reds every site that was resting on that lock, in the same run,
 * with no ledger edit. A hand-written "locked" would go stale in silence, which
 * is the failure mode a two-way ledger exists to prevent.
 *
 * It is **not** "ignore this file". The `catch` still swallows every other
 * error and the check still names the site; what changes is what the reader is
 * being asked to do about it.
 *
 * Usage: `tsx scripts/check-port-catches.ts [--list]`
 * Exit 0 = every such `catch` handles it (or is ledgered, or its owners are
 * locked); exit 1 = at least one does not, or a ledger entry is stale.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { moduleOf, providedPortNames } from './check-port-dependencies.js';
import {
  loadManifestActivations,
  lockedOwners,
  type ManifestActivationInput,
} from './lib/switchable-modules.js';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** A file that belongs to no module — a composition root, `http/`, `db/`. */
const ROOT = '(root)';

/** Every alias is visible here: a gated port's own name, outside its owner. */
const EVERYWHERE = '*';

/**
 * Sites where absorbing the presence answer is, today, the least-wrong
 * behaviour — with the reason, and the question that would retire the entry.
 *
 * Keyed `<path under src/>:<port or alias>` rather than by line, so moving code
 * inside a file does not invalidate an entry and re-opening the hole does not
 * silently inherit one. **Two-way**, in the idiom of
 * `WIRING_RESOLUTIONS_TO_DRAIN` and `KERNEL_MODULE_IMPORTS_TO_DRAIN`: an
 * unledgered violation fails the build, and a ledger entry that no longer
 * describes a violation fails it too.
 *
 * There are three shapes here, and each entry says which it is. A fourth
 * answer, `OWNER LOCKED`, is **derived** and never written here — see the
 * header.
 *
 *   - **After the fact** — the guarded call runs after the operation it belongs
 *     to has already committed, so re-throwing would report a failure for work
 *     that succeeded. That is a design question about compensating actions, not
 *     a `catch` somebody forgot to narrow.
 *   - **A degrade the owner should be answering** — the caller genuinely wants
 *     "this capability is not here" and is right to keep serving without it
 *     (Constitution XVII: a module that is off behaves as if never installed).
 *     `rethrowIfModuleDisabled` would be the *wrong* fix — it would 503 a
 *     surface that has a defined behaviour without the module. The answer
 *     belongs in the port's or the contribution's return type, or in a
 *     `nonBindingDependencies` entry; until it is there, the `catch` is the only
 *     place it is written down, and the entry names what would move it.
 *   - **Boot hook** — the presence answer is decided at the top of the hook
 *     (D-62), so what the `catch` absorbs is an ordinary failure with no caller
 *     to report to. These entries are not drainable and say so.
 */
export const PORT_CATCHES_TO_DRAIN: Readonly<Record<string, string>> = {
  'modules/organizations/routes.public.ts:onLogin':
    'LEDGER-PERMANENT (D-70), and the tolerance here is the requirement rather than ' +
    'a swallow somebody forgot to narrow. Feature 037 FR-007/FR-008 and SC-004 say ' +
    'in so many words that a merge failure must not break the login, and the `catch` ' +
    'covers four failure modes of which a presence answer is one: a transient ' +
    'database error, a concurrent merge, a malformed cookie token. Narrowing it with ' +
    '`rethrowIfModuleDisabled` would be worse than deleting it, not a compromise — ' +
    '`setSessionCookie` has already written the session cookie onto the response at ' +
    'routes.public.ts:160, so the 503 would reach a buyer who is authenticated, ' +
    'which is the same argument the `webhooks` entry makes about a delivery already ' +
    'attempted. What makes the site safe is not the shape of the `catch`: `carts` is ' +
    'locked, and the comparison adoption is now **decided** in the root contribution ' +
    '(`composition.ts`, `effectiveState.isPresent("comparisons")`) rather than ' +
    'attempted, so no presence answer reaches this `catch` at all. Two tests hold ' +
    'both halves, and deleting either half fails one of them: ' +
    '`test/contract/auth/customer-login-cart-merge.contract.test.ts:203` goes red if ' +
    'the `catch` goes, and ' +
    '`test/contract/organizations/login-comparisons-off.contract.test.ts` goes red if ' +
    'the probe goes — its third assertion, that no `cart_merge_on_login_failed` line ' +
    'is logged, is what tells a decided adoption from a caught one, because the ' +
    'first two assertions pass with no probe at all. Nothing is: do not drain this.',
  'modules/webhooks/services/webhook-delivery-worker.ts:recordDelivery':
    'LEDGER-PERMANENT, and not because nobody has looked (D-60). This is a ' +
    '**self-edge**: `webhooks` resolves its own gated port per call, deliberately, ' +
    'so a job draining mid-flight still meets the gate. The only reachable presence ' +
    'answer is an operator flipping the module off *between* the HTTP attempt and ' +
    'the bookkeeping write, and both alternatives to swallowing it are worse. ' +
    'Re-throwing fails the BullMQ job after the endpoint was called, so the retry ' +
    'delivers the same event twice — the one outcome a webhook consumer must not ' +
    'see. A probe before the attempt cannot help, because the flip happens after ' +
    'it. "The attempt and its record being one write" was the retiring question ' +
    'this entry used to carry; it is a distributed-transaction wish rather than a ' +
    'fix, and it is not what this entry is waiting for. Nothing is: do not drain ' +
    'this by narrowing it.',
  'modules/product_feeds/backend.ts:run':
    'BOOT HOOK, and now a genuine tolerance rather than a swallowed presence ' +
    'answer (issue #147, D-62). The hook asks ' +
    "`effectiveState.isPresent('product_feeds')` first, and outside every `try` — " +
    'outside, because `runBootHooks` does not catch: it re-throws as ' +
    '`ModuleCompositionError` and `index.ts` exits (issue #146, D-67), so a ' +
    '`ModuleDisabledError` raised inside the `try` would either take out the boot ' +
    'or share one silent no-op with a transient failure. With the presence question ' +
    'answered before the work, the only thing left for the `reconcile` helper to ' +
    'absorb is an ordinary failure of the reconcile itself — an unbootable API ' +
    'costing no more than a drifted schedule the next boot repairs. Narrowing it to ' +
    're-throw was tried and reverted: it changed what the harness boots with, and ' +
    'three `product_feeds` taxonomy contract tests went red. Permanent, therefore, ' +
    'with the reason stated: the presence question this entry used to hold has been ' +
    'moved out of the `catch` and is pinned by ' +
    '`test/unit/product_feeds/boot-reconcile-presence.test.ts`.',
  'modules/pim_ergonode/backend.ts:handle':
    'BOOT HOOK, and not drainable (D-62). The import twin of the `product_feeds` ' +
    'reconcile above — same presence probe at the top of the hook, same ' +
    'log-and-continue for what is left, and the same measurement that re-throwing ' +
    'is the wrong fix for both.',
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

export interface PortCatch {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly moduleId: string;
  /** The alias or port name the `try` body called through. */
  readonly port: string;
  readonly handled: boolean;
  /** The gated port names that alias carries — what the `catch` could swallow. */
  readonly gates: readonly string[];
  /** The modules owning those gates — whose locks an `OWNER LOCKED` site rests on. */
  readonly gateOwners: readonly string[];
  /** Every one of those gates is owned by a `nonDeactivatable` module (D-63). */
  readonly ownerLocked: boolean;
}

/** `<file>:<port>` — the ledger key, and the identity of a site. */
export function keyOf(found: PortCatch): string {
  return `${found.file}:${found.port}`;
}

/**
 * The part of a module manifest this check reads: which modules the platform
 * refuses to switch off (D-63). Structural rather than `ModuleManifest`, so a
 * fixture can supply the two fields the derivation looks at and nothing else —
 * and so the derivation itself stays inside the analysis, where a red proof can
 * reach it.
 *
 * Both the shape and `lockedOwners` come from `lib/switchable-modules.ts`, which
 * `check-entry-presence` reads as well (D-68): the same lock decides whether a
 * `catch` is `OWNER LOCKED` and whether a module's boot hooks are in that
 * check's population, so an owner who withdraws one re-reds both on the same
 * run. Re-exported here because this check's own tests and its inventory entry
 * name it.
 */
export type { ManifestActivationInput };
export { lockedOwners };

export interface PortCatchInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * The deployment's manifests. Omitted means *nothing is locked*: a caller
   * that supplies none gets the pre-D-63 classification, which is the safe
   * default — a site is only ever retired by a lock somebody declared.
   */
  readonly manifests?: readonly ManifestActivationInput[];
}

interface Analysis {
  /** Names registered through `di.providePort`, and the module that owns each. */
  readonly portOwners: ReadonlyMap<string, string>;
  /** Alias → the modules whose files may read it as a gated port. */
  readonly aliases: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Alias → the gated port names it carries.
   *
   * Keyed by name alone rather than by name and scope, and deliberately
   * over-approximating: two modules spelling one alias differently merge their
   * gates, which can only make the `OWNER LOCKED` test *harder* to satisfy. The
   * error this cannot make is the one that matters — retiring a site whose gate
   * an operator can still close.
   */
  readonly gatesOf: ReadonlyMap<string, ReadonlySet<string>>;
  /** Does `name`, read inside `moduleId`, stand for a gated port? */
  readsAsPort(name: string, moduleId: string, file: string): boolean;
}

/**
 * The awilix resolver-builder chain. `ctx.asFunction(f).singleton()` is the
 * factory `f` in another wrapper, so whatever `f` carries the registration
 * carries — unlike an ordinary method call on a value, whose result is data.
 */
const RESOLVER_BUILDERS = new Set(['singleton', 'scoped', 'transient', 'inject', 'disposer']);

/** Where such a chain starts — the registration wrapping a factory. */
const RESOLVER_ENTRIES = new Set(['asFunction', 'asValue', 'asClass']);

/**
 * A call that claims a **container** name — `registerValues(container, …)`,
 * `composedModules.contribute(…)`, `ctx.di.register(…)`,
 * `ctx.di.providePort(…)`.
 *
 * `contribute` is the same claim as `registerValues` made inside D-45's window
 * (issue #52), and it has to be read here for the same reason: a root moving 72
 * contributions onto the method would otherwise take every one of those names
 * out of this analysis, and the check would go quiet without anything changing
 * about the tree.
 *
 * Deliberately narrow. Matching a bare `.register(` would also match Fastify's
 * `app.register(plugin, options)` and turn every option key in the tree into an
 * alias. The caller narrows it further: only a **root's** registration key is
 * published everywhere, because a root belongs to no module and a module's own
 * internal names (`mailer`, `client`, `settings`) collide with half the tree.
 */
function isContainerRegistration(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'registerValues';
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (method === 'contribute') return true;
  if (method !== 'register' && method !== 'providePort') return false;
  return tailName(node.expression.expression) === 'di';
}

/**
 * Which names stand for a gated port, and where each one may be read.
 *
 * A **fixpoint**, because the shapes chain without bound: a `lazyPort` is bound
 * to a local, the local passed to a constructor, the constructed holder given a
 * deps-object key, that key registered on the container by a root, and the
 * container name resolved by a module three files away. Each round can only add
 * aliases, and a round that adds none is the last.
 */
function analyze(sources: ReadonlyMap<string, string>): Analysis {
  const parsed = new Map<string, ts.SourceFile>();
  for (const [file, text] of sources) {
    parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }

  const portOwners = new Map<string, string>();
  for (const [file, sf] of parsed) {
    if (!file.endsWith('backend.ts')) continue;
    const owner = moduleOf(`/src/${file}`);
    if (owner === null) continue;
    for (const name of providedPortNames(sf.getFullText(), file)) portOwners.set(name, owner);
  }

  const aliases = new Map<string, Set<string>>();
  /** Alias → the gated port names it carries; see {@link Analysis.gatesOf}. */
  const gatesOf = new Map<string, Set<string>>();
  /** True when the alias is new — which is what keeps the fixpoint running. */
  let grew = false;
  const addAlias = (
    name: string,
    scope: string,
    where?: string,
    gates?: ReadonlySet<string>,
  ): void => {
    const scopes = aliases.get(name) ?? new Set<string>();
    aliases.set(name, scopes);
    if (!scopes.has(scope)) {
      scopes.add(scope);
      grew = true;
      if (process.env.PORT_CATCH_WHY) console.error(`ALIAS ${name} @${scope} <- ${where ?? '-'}`);
    }
    if (gates === undefined) return;
    // Gates keep the fixpoint running on their own: a holder can be bound
    // before the round that discovers what it was built from.
    const carried = gatesOf.get(name) ?? new Set<string>();
    gatesOf.set(name, carried);
    for (const gate of gates) {
      if (carried.has(gate)) continue;
      carried.add(gate);
      grew = true;
      if (process.env.PORT_CATCH_WHY) console.error(`GATE  ${name} <- ${gate} @${where ?? '-'}`);
    }
  };
  // A gated port's own name reads as one everywhere except inside its owner,
  // where the identical identifier is normally the module's own instance.
  for (const name of portOwners.keys()) addAlias(name, EVERYWHERE, undefined, new Set([name]));

  const readsAsPort = (name: string, moduleId: string, file: string): boolean => {
    const scopes = aliases.get(name);
    if (scopes === undefined) return false;
    if (scopes.has(moduleId) || scopes.has(file)) return true;
    return scopes.has(EVERYWHERE) && portOwners.get(name) !== moduleId;
  };

  /** `lazyPort<T>(ctx, 'gatedName')`, and only a gated one. */
  const isProxyCall = (node: ts.Node): boolean => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== 'lazyPort'
    ) {
      return false;
    }
    const [, nameArgument] = node.arguments;
    return (
      nameArgument !== undefined &&
      ts.isStringLiteralLike(nameArgument) &&
      portOwners.has(nameArgument.text)
    );
  };

  // Declarations, so an argument's position can be turned into the parameter
  // name the receiving code reads it by.
  const classes = new Map<string, ts.ClassDeclaration>();
  const functions = new Map<string, ts.FunctionDeclaration | ts.ArrowFunction>();
  for (const sf of parsed.values()) {
    const collect = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) classes.set(node.name.text, node);
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isArrowFunction(node.initializer)
      ) {
        functions.set(node.name.text, node.initializer);
      }
      node.forEachChild(collect);
    };
    sf.forEachChild(collect);
  }

  /**
   * One round over every file. Reads the alias table as it stands and adds to
   * it; `grew` says whether another round can find anything new.
   */
  const round = (): void => {
    for (const [file, sf] of parsed) {
      const scope = moduleOf(`/src/${file}`) ?? ROOT;
      const reads = (name: string): boolean => readsAsPort(name, scope, file);
      const at = (node: ts.Node): string =>
        `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

      /**
       * Does evaluating this expression yield a value that still reaches the
       * gate?
       *
       * Calls are the deliberate exception: `proxy.applyToCart(…)` *is* the
       * gated call, but its **result** is data, so carriage does not survive a
       * call. What does survive is construction — a holder given the proxy
       * keeps forwarding to it — and a closure, which has not run yet.
       */
      const carries = (node: ts.Node): boolean => {
        if (isProxyCall(node)) return true;
        if (ts.isIdentifier(node)) return reads(node.text);
        // `cradle().promotionService`, `this.deps.promotion` — the **trailing**
        // name is what the gate answers for. A field read *off* a port
        // (`proxy.rows`, `p.attributeValues[k]`) is data, and treating it as a
        // carrier cascaded through every local it was ever assigned to.
        if (ts.isPropertyAccessExpression(node)) return reads(node.name.text);
        if (
          ts.isParenthesizedExpression(node) ||
          ts.isAwaitExpression(node) ||
          ts.isNonNullExpression(node) ||
          ts.isAsExpression(node) ||
          ts.isSatisfiesExpression(node)
        ) {
          return carries(node.expression);
        }
        if (ts.isConditionalExpression(node)) {
          return carries(node.whenTrue) || carries(node.whenFalse);
        }
        // `port ?? fallback`, `flag && port` — a comparison yields a boolean.
        if (ts.isBinaryExpression(node)) {
          const operator = node.operatorToken.kind;
          if (
            operator !== ts.SyntaxKind.QuestionQuestionToken &&
            operator !== ts.SyntaxKind.BarBarToken &&
            operator !== ts.SyntaxKind.AmpersandAmpersandToken
          ) {
            return false;
          }
          return carries(node.left) || carries(node.right);
        }
        // An object literal deliberately does **not** carry, however many ports
        // it holds: a deps bag is a record, and tainting the bag makes every
        // `this.deps.anythingAtAll()` in the receiving class read as a port
        // call. Its carrying keys become aliases one by one instead, which is
        // where the port is actually reached.
        if (ts.isArrayLiteralExpression(node)) return node.elements.some(carries);
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return bodyReads(node, reads);
        if (ts.isNewExpression(node)) return (node.arguments ?? []).some(carries);
        if (ts.isCallExpression(node)) {
          // A **factory** hands the port on, and `ctx.asFunction(f).singleton()`
          // is `f` in a wrapper. Every other call returns data — including
          // `proxy.applyToCart(…)`, which *is* the gated call but whose result
          // is a discount, and `JSON.stringify(payloadFromAPort)`, which is a
          // string. Carriage through an arbitrary callee turned every local
          // downstream of a port into an alias.
          const callee = node.expression;
          const argumentsCarry = (): boolean => (node.arguments ?? []).some(carries);
          if (ts.isPropertyAccessExpression(callee)) {
            if (RESOLVER_BUILDERS.has(callee.name.text)) return carries(callee.expression);
            return RESOLVER_ENTRIES.has(callee.name.text) && argumentsCarry();
          }
          if (!ts.isIdentifier(callee)) return false;
          return (
            (RESOLVER_ENTRIES.has(callee.text) || functions.has(callee.text)) && argumentsCarry()
          );
        }
        return false;
      };

      /**
       * **Which** gates a carrying expression reaches — the input to D-63's
       * `OWNER LOCKED` derivation.
       *
       * A blunt walk of the whole expression rather than a mirror of
       * {@link carries}: it is only ever asked about a value that already
       * carries, and over-collecting can only add owners, which can only make
       * the "every owner is locked" test harder to pass. Under-collecting is
       * the error that would matter, because it retires a site whose gate an
       * operator can still close.
       */
      const gatesIn = (node: ts.Node): Set<string> => {
        const found = new Set<string>();
        const record = (name: string): void => {
          if (portOwners.has(name)) found.add(name);
          for (const gate of gatesOf.get(name) ?? []) found.add(gate);
        };
        const scan = (inner: ts.Node): void => {
          if (ts.isTypeNode(inner)) return;
          if (isProxyCall(inner) && ts.isCallExpression(inner)) {
            const [, nameArgument] = inner.arguments;
            if (nameArgument !== undefined && ts.isStringLiteralLike(nameArgument)) {
              found.add(nameArgument.text);
            }
            return;
          }
          if (ts.isPropertyAccessExpression(inner)) {
            if (reads(inner.name.text)) record(inner.name.text);
            scan(inner.expression);
            return;
          }
          if (ts.isIdentifier(inner) && reads(inner.text)) record(inner.text);
          inner.forEachChild(scan);
        };
        scan(node);
        return found;
      };

      const visit = (node: ts.Node): void => {
        // `const cartService = lazyPort(…)`, `const recompute = new X(port)`.
        // Scoped to the **file**, because a `const` is: `catalog` renames its
        // bulk-operation service to `queue` in one file and holds a BullMQ
        // queue under the same spelling in another, and a module-wide binding
        // read the second as a port.
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          carries(node.initializer)
        ) {
          addAlias(node.name.text, file, at(node), gatesIn(node.initializer));
        }
        // `{ promotion: lazyPort(ctx, 'promotionService') }` — a deps-object key.
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
          if (carries(node.initializer)) {
            addAlias(node.name.text, scope, at(node), gatesIn(node.initializer));
          }
        }
        if (ts.isShorthandPropertyAssignment(node) && reads(node.name.text)) {
          addAlias(node.name.text, scope, at(node), gatesIn(node.name));
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          // `new CartService(emFactory, lazyPort(…))` — the parameter it lands on.
          const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
          if (callee !== null && node.arguments) {
            node.arguments.forEach((argument, index) => {
              if (!carries(argument)) return;
              const declaration = ts.isNewExpression(node)
                ? classes.get(callee)?.members.find(ts.isConstructorDeclaration)
                : functions.get(callee);
              const parameter = declaration?.parameters[index];
              if (parameter && ts.isIdentifier(parameter.name)) {
                addAlias(parameter.name.text, scope, at(node), gatesIn(argument));
              }
            });
          }
          // A name a **root** contributes is global: it belongs to no module,
          // and whichever module resolves it gets the port behind it. That is
          // the shape the five e-mail notifiers arrived by (issue #113). A
          // module's own `ctx.di.register` key stays module-scoped — it is
          // either a port, and already global by the rule above, or an internal
          // name whose spelling (`mailer`, `client`, `settings`) collides with
          // half the tree.
          if (scope === ROOT && ts.isCallExpression(node) && isContainerRegistration(node)) {
            for (const argument of node.arguments) {
              if (!ts.isObjectLiteralExpression(argument)) continue;
              for (const property of argument.properties) {
                if (
                  ts.isPropertyAssignment(property) &&
                  ts.isIdentifier(property.name) &&
                  carries(property.initializer)
                ) {
                  addAlias(
                    property.name.text,
                    EVERYWHERE,
                    at(property),
                    gatesIn(property.initializer),
                  );
                }
                if (ts.isShorthandPropertyAssignment(property) && reads(property.name.text)) {
                  addAlias(property.name.text, EVERYWHERE, at(property), gatesIn(property.name));
                }
              }
            }
          }
        }
        node.forEachChild(visit);
      };
      sf.forEachChild(visit);
    }
  };

  // Bounded so a pathological tree cannot spin: each round can only add
  // aliases, and the deepest chain the tree holds today is five hops.
  for (let pass = 0; pass < 24; pass += 1) {
    grew = false;
    round();
    if (!grew) break;
  }

  return { portOwners, aliases, gatesOf, readsAsPort };
}

/**
 * Does a closure's body reach the gate? A `() => cradle().portName()` has not
 * resolved anything yet, so the closure itself carries and every name it is
 * bound to is an alias.
 *
 * Property *names* and parameter *names* are skipped: `{ promotion: 1 }`
 * mentions an alias without reading one.
 */
function bodyReads(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  reads: (name: string) => boolean,
): boolean {
  let hit = false;
  const scan = (node: ts.Node): void => {
    if (hit || ts.isTypeNode(node)) return;
    if (ts.isPropertyAccessExpression(node)) {
      if (reads(node.name.text)) {
        hit = true;
        return;
      }
      scan(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      scan(node.initializer);
      return;
    }
    if (ts.isParameter(node)) {
      if (node.initializer) scan(node.initializer);
      return;
    }
    if (ts.isIdentifier(node) && reads(node.text)) {
      hit = true;
      return;
    }
    node.forEachChild(scan);
  };
  scan(fn.body);
  return hit;
}

/** The trailing identifier of a receiver: `this.deps.x` → `x`, `y` → `y`. */
function tailName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return tailName(node.expression);
  }
  return null;
}

/**
 * Functions the `catch` may hand the error to and still be handling it.
 *
 * Two shapes exist in the tree, and both are correct code the literal rule read
 * as a violation: `toCatalogHttpError(err, key): never`, whose last statement is
 * `throw err`, and `ReturnEmailNotifier#contained(rc, kind, error)`, which calls
 * `rethrowIfModuleDisabled` on the caller's behalf. The requirement is narrow on
 * purpose — the delegate must **end** by re-throwing its own parameter, or name
 * the kernel's narrowing. A helper that ends by throwing something it built
 * itself converts the presence answer and does not qualify.
 */
function collectRethrowDelegates(parsed: Iterable<ts.SourceFile>): Set<string> {
  const delegates = new Set<string>();
  const qualifies = (
    parameters: readonly ts.ParameterDeclaration[],
    body: ts.Node | undefined,
  ): boolean => {
    if (body === undefined || !ts.isBlock(body)) return false;
    let names = false;
    const scan = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        (node.text === 'rethrowIfModuleDisabled' || node.text === 'ModuleDisabledError')
      ) {
        names = true;
      }
      node.forEachChild(scan);
    };
    body.forEachChild(scan);
    if (names) return true;
    const last = body.statements.at(-1);
    if (!last || !ts.isThrowStatement(last) || !last.expression) return false;
    if (!ts.isIdentifier(last.expression)) return false;
    const thrown = last.expression.text;
    return parameters.some(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === thrown,
    );
  };

  for (const sf of parsed) {
    const collect = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        qualifies(node.parameters, node.body)
      ) {
        delegates.add(node.name.text);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
        qualifies(node.initializer.parameters, node.initializer.body)
      ) {
        delegates.add(node.name.text);
      }
      node.forEachChild(collect);
    };
    sf.forEachChild(collect);
  }
  return delegates;
}

/** Does this `catch` let `ModuleDisabledError` through? */
function handles(clause: ts.CatchClause, delegates: ReadonlySet<string>): boolean {
  const last = clause.block.statements.at(-1);
  if (last && ts.isThrowStatement(last)) return true;
  let named = false;
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'rethrowIfModuleDisabled') named = true;
    if (ts.isIdentifier(node) && node.text === 'ModuleDisabledError') named = true;
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : null;
      if (callee !== null && delegates.has(callee)) named = true;
    }
    node.forEachChild(scan);
  };
  clause.block.forEachChild(scan);
  return named;
}

/**
 * How many rounds the method fixpoint runs before it gives up.
 *
 * The same cap the alias table uses, for the same reason: a chain of private
 * methods is bounded in practice, and a cap makes "did not converge" a bug
 * report rather than a hang.
 */
const METHOD_HOP_ROUNDS = 12;

/** The name of a class member as `this.<name>` would spell it, or `null`. */
function memberName(name: ts.PropertyName | undefined): string | null {
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return null;
}

/** `this.<name>` / `this.#name`, as the receiver of a call — the name, or `null`. */
function thisMethodCalled(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return null;
  const name = node.expression.name;
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text : null;
}

/** The class a node sits inside, by name — `null` for a class expression. */
function enclosingClassName(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at)) return at.name?.text ?? null;
  }
  return null;
}

/** `<file>#<class>#<method>` — a method's identity for the hop. */
function methodKey(file: string, className: string, method: string): string {
  return `${file}#${className}#${method}`;
}

/**
 * Which methods carry a gate into a `catch` around a call to them (D-88).
 *
 * Two passes and then a fixpoint. The first records, per class member, the port
 * or alias names its body reaches directly — the same three call shapes the
 * `try` scan reads, so a method and a `try` block agree about what a port call
 * looks like by construction. The second records `this.<name>(…)` edges inside
 * the class. The fixpoint then walks the edges backwards until nothing new
 * appears, which is what makes a private method calling a private method that
 * reaches a gate carry as well.
 *
 * Nothing crosses a class boundary here, and nothing crosses a file boundary:
 * that is the whole limit, and it is stated in the header because one hop is a
 * limit too.
 */
function collectCarryingMethods(
  parsed: ReadonlyMap<string, ts.SourceFile>,
  readsAsPortIn: (file: string, name: string) => boolean,
  declaresMember: (file: string, className: string, name: string) => boolean,
): Map<string, Set<string>> {
  /** method key → the port/alias names its body reaches. */
  const carries = new Map<string, Set<string>>();
  /** method key → the method keys it calls through `this`. */
  const edges = new Map<string, Set<string>>();

  for (const [file, sf] of parsed) {
    const reads = (name: string): boolean => readsAsPortIn(file, name);

    const record = (className: string, method: string, body: ts.Node): void => {
      const key = methodKey(file, className, method);
      const ports = carries.get(key) ?? new Set<string>();
      const calls = edges.get(key) ?? new Set<string>();
      const scan = (inner: ts.Node): void => {
        if (ts.isCallExpression(inner)) {
          const hop = thisMethodCalled(inner);
          if (hop !== null && declaresMember(file, className, hop)) {
            calls.add(methodKey(file, className, hop));
          } else if (ts.isPropertyAccessExpression(inner.expression)) {
            const receiver = tailName(inner.expression.expression);
            if (receiver !== null && reads(receiver)) ports.add(receiver);
            else if (reads(inner.expression.name.text)) ports.add(inner.expression.name.text);
          }
          if (
            ts.isIdentifier(inner.expression) &&
            inner.expression.text !== 'lazyPort' &&
            reads(inner.expression.text)
          ) {
            ports.add(inner.expression.text);
          }
          if (ts.isIdentifier(inner.expression) && inner.expression.text === 'requireModuleEnabled') {
            ports.add('requireModuleEnabled');
          }
        }
        inner.forEachChild(scan);
      };
      body.forEachChild(scan);
      carries.set(key, ports);
      edges.set(key, calls);
    };

    for (const [className, members] of classesIn(sf)) {
      for (const [name, body] of members) record(className, name, body);
    }
  }

  for (let round = 0; round < METHOD_HOP_ROUNDS; round += 1) {
    let grew = false;
    for (const [key, calls] of edges) {
      const ports = carries.get(key);
      if (ports === undefined) continue;
      for (const callee of calls) {
        for (const port of carries.get(callee) ?? []) {
          if (!ports.has(port)) {
            ports.add(port);
            grew = true;
          }
        }
      }
    }
    if (!grew) break;
  }

  // A method that reaches nothing is not a carrier; dropping it here keeps the
  // lookup at the `try` site a presence test rather than a size test.
  for (const [key, ports] of [...carries]) if (ports.size === 0) carries.delete(key);
  return carries;
}

/** Class name → its method-shaped members, by the name `this.<x>` spells. */
function classesIn(sf: ts.SourceFile): Map<string, Map<string, ts.Node>> {
  const classes = new Map<string, Map<string, ts.Node>>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const members = classes.get(node.name.text) ?? new Map<string, ts.Node>();
      for (const member of node.members) {
        const name = memberName(member.name);
        if (name === null) continue;
        if (ts.isMethodDeclaration(member) && member.body) members.set(name, member.body);
        else if (
          ts.isPropertyDeclaration(member) &&
          member.initializer &&
          (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
        ) {
          members.set(name, member.initializer.body);
        }
      }
      classes.set(node.name.text, members);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return classes;
}

/** Every `try` in `src/**` whose body calls through a gated port. */
export function findPortCatches(input: PortCatchInput): PortCatch[] {
  const analysis = analyze(input.sources);
  const locked = lockedOwners(input.manifests ?? []);
  /**
   * D-63 — every gate this alias carries is owned by a module the platform
   * refuses to switch off, so the `catch` has no reachable presence answer to
   * swallow. An alias carrying no gate at all (`requireModuleEnabled`) is never
   * locked: nothing is known about what it answers.
   */
  const isOwnerLocked = (gates: readonly string[]): boolean =>
    gates.length > 0 &&
    gates.every((gate) => {
      const owner = analysis.portOwners.get(gate);
      return owner !== undefined && locked.has(owner);
    });
  const found: PortCatch[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  for (const [file, text] of input.sources) {
    parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  const delegates = collectRethrowDelegates(parsed.values());
  /**
   * The classes each file declares, by member name.
   *
   * It decides a **shadowing** rule the pre-D-88 check got wrong in one
   * direction: `this.close(…)` where `close` is a method of the enclosing class
   * is that method, never a module-scoped alias that happens to share the
   * spelling. `product_feeds` holds both — a plugin closure bound to `close` and
   * a `TaxonomyRefreshService#close` that writes a check row — and without this
   * the hop reported the second as though it reached the first's twenty gates.
   */
  const declaredMembers = new Map<string, Map<string, ReadonlySet<string>>>();
  for (const [file, sf] of parsed) {
    declaredMembers.set(
      file,
      new Map([...classesIn(sf)].map(([name, members]) => [name, new Set(members.keys())])),
    );
  }
  const declaresMember = (file: string, className: string, name: string): boolean =>
    declaredMembers.get(file)?.get(className)?.has(name) === true;
  const carryingMethods = collectCarryingMethods(
    parsed,
    (file, name) => analysis.readsAsPort(name, moduleOf(`/src/${file}`) ?? ROOT, file),
    declaresMember,
  );

  for (const [file] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`) ?? ROOT;
    const sf = parsed.get(file) as ts.SourceFile;

    const readsAsPort = (name: string): boolean => analysis.readsAsPort(name, moduleId, file);

    const visit = (node: ts.Node): void => {
      if (ts.isTryStatement(node) && node.catchClause) {
        /**
         * The name the site is reported under → the port/alias names it stands
         * for. Identity for a direct reach; for a D-88 method hop the key is the
         * method and the value is what its body reaches, so `gates` — and with
         * it the `OWNER LOCKED` derivation — comes out unchanged.
         */
        const ports = new Map<string, Set<string>>();
        const add = (name: string, via: Iterable<string>): void => {
          const carried = ports.get(name) ?? new Set<string>();
          for (const one of via) carried.add(one);
          ports.set(name, carried);
        };
        const className = enclosingClassName(node);
        /** D-88's shadowing rule — see {@link declaredMembers}. */
        const ownMethod = (inner: ts.CallExpression): string | null => {
          const method = className === null ? null : thisMethodCalled(inner);
          return method !== null && className !== null && declaresMember(file, className, method)
            ? method
            : null;
        };
        const scan = (inner: ts.Node): void => {
          if (
            ts.isCallExpression(inner) &&
            ts.isPropertyAccessExpression(inner.expression) &&
            ownMethod(inner) === null
          ) {
            const receiver = tailName(inner.expression.expression);
            if (receiver !== null && readsAsPort(receiver)) {
              add(receiver, [receiver]);
            } else if (readsAsPort(inner.expression.name.text)) {
              // `this.deps.getTransactionalEmailSender()` — the alias is the
              // thing being called, not the object it hangs off.
              add(inner.expression.name.text, [inner.expression.name.text]);
            }
          }
          if (
            ts.isCallExpression(inner) &&
            ts.isIdentifier(inner.expression) &&
            inner.expression.text !== 'lazyPort' &&
            readsAsPort(inner.expression.text)
          ) {
            add(inner.expression.text, [inner.expression.text]);
          }
          // `requireModuleEnabled('x')` throws the same error, on purpose.
          if (
            ts.isCallExpression(inner) &&
            ts.isIdentifier(inner.expression) &&
            inner.expression.text === 'requireModuleEnabled'
          ) {
            add('requireModuleEnabled', ['requireModuleEnabled']);
          }
          // D-88 — one hop backwards, through `this` and nothing else.
          if (ts.isCallExpression(inner) && className !== null) {
            const method = ownMethod(inner);
            const carried =
              method === null ? undefined : carryingMethods.get(methodKey(file, className, method));
            if (method !== null && carried !== undefined) add(method, carried);
          }
          inner.forEachChild(scan);
        };
        node.tryBlock.forEachChild(scan);

        if (ports.size > 0) {
          const handled = handles(node.catchClause, delegates);
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          for (const [port, via] of ports) {
            const gates = [
              ...new Set(
                [...via].flatMap((one) => [
                  ...(analysis.portOwners.has(one) ? [one] : []),
                  ...(analysis.gatesOf.get(one) ?? []),
                ]),
              ),
            ].sort();
            found.push({
              file,
              line,
              moduleId,
              port,
              handled,
              gates,
              gateOwners: [
                ...new Set(
                  gates
                    .map((gate) => analysis.portOwners.get(gate))
                    .filter((owner): owner is string => owner !== undefined),
                ),
              ].sort(),
              ownerLocked: isOwnerLocked(gates),
            });
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
  readonly violations: readonly PortCatch[];
  readonly ledgered: readonly PortCatch[];
  /** Sites retired by D-63: every gate they carry has a locked owner. */
  readonly ownerLocked: readonly PortCatch[];
  /** Ledger keys that no longer describe a violation — the staleness half. */
  readonly stale: readonly string[];
}

export function checkPortCatches(
  input: PortCatchInput,
  ledger: Readonly<Record<string, string>> = PORT_CATCHES_TO_DRAIN,
): CheckResult {
  const all = findPortCatches(input);
  const unhandled = all.filter((entry) => !entry.handled);
  const ownerLocked = unhandled.filter((entry) => entry.ownerLocked);
  const open = unhandled.filter((entry) => !entry.ownerLocked);
  // An `OWNER LOCKED` site is deliberately **not** in the key set: a ledger
  // entry over one therefore reads stale and has to go, which is what makes the
  // classification re-red the site if the lock is ever withdrawn (D-63).
  const keys = new Set(open.map(keyOf));
  return {
    total: all.length,
    violations: open.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: open.filter((entry) => ledger[keyOf(entry)] !== undefined),
    ownerLocked,
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  if (files.length === 0) {
    console.error('[port-catches] no sources under src/ — refusing to report a vacuous pass');
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(SRC_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  // The locks, read from the manifests rather than listed here (D-63), through
  // the helper `check-entry-presence` reads too (D-68). The same index
  // `check-port-dependencies.ts` derives `neverAbsentOwners` from, so no two of
  // the three can disagree about which modules are locked.
  let manifests: readonly ManifestActivationInput[];
  try {
    manifests = await loadManifestActivations(SRC_ROOT);
  } catch (err: unknown) {
    console.error(
      `[port-catches] the manifest index could not be read (${String(err)}) — every site ` +
        'would read as unlocked, refusing to report a classification nothing was read for',
    );
    process.exit(2);
    return;
  }

  const result = checkPortCatches({ sources, manifests });

  if (listMode) {
    for (const entry of findPortCatches({ sources, manifests })) {
      const tag = entry.handled
        ? 'HANDLED '
        : entry.ownerLocked
          ? 'LOCKED  '
          : PORT_CATCHES_TO_DRAIN[keyOf(entry)] !== undefined
            ? 'LEDGERED'
            : 'BARE    ';
      console.log(`${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.port}`);
    }
    console.log('');
  }

  if (result.ownerLocked.length > 0) {
    console.log(
      'OWNER LOCKED — the `catch` stays, and there is nothing to drain: every gate it\n' +
        'carries belongs to a module the platform refuses to switch off, so the presence\n' +
        'answer it would swallow is unreachable. Un-lock an owner and these come back:\n',
    );
    for (const entry of result.ownerLocked) {
      console.log(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] via ${entry.port} ` +
          `— locked by ${entry.gateOwners.join(', ')} (gates: ${entry.gates.join(', ')})`,
      );
    }
    console.log('');
  }

  console.log(
    `[port-catches] guarded-port catches=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `owner-locked=${result.ownerLocked.length} ` +
      `ledger-size=${Object.keys(PORT_CATCHES_TO_DRAIN).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA `catch` around a gated-port call swallows `ModuleDisabledError`.\n' +
        'Delete it if it was only defensive, move the degrade into the port`s return\n' +
        'type, or keep it and add `rethrowIfModuleDisabled(error)`:\n',
    );
    for (const entry of result.violations) {
      console.error(`  - ${entry.file}:${entry.line}  [${entry.moduleId}] via ${entry.port}`);
    }
  }
  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries (no longer describe a bare catch, or the site is now\n' +
        'OWNER LOCKED and has nothing left to drain — delete them):',
    );
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
