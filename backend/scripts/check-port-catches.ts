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
 * Usage: `tsx scripts/check-port-catches.ts [--list]`
 * Exit 0 = every such `catch` handles it (or is ledgered); exit 1 = at least
 * one does not, or a ledger entry is stale.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { moduleOf, providedPortNames } from './check-port-dependencies.js';

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
 * There are two shapes here, and each entry says which it is.
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
 */
export const PORT_CATCHES_TO_DRAIN: Readonly<Record<string, string>> = {
  'modules/orders/services/order-api-intake-service.ts:addressService':
    'AFTER THE FACT. Compensating cleanup of transient addresses. It runs on the ' +
    'success path too, after the order is committed, so re-throwing would fail a ' +
    'placement that succeeded. Retiring it means giving the cleanup somewhere to ' +
    'report to — a reconciliation row, not the caller.',
  'modules/orders/services/order-creation-admin-service.ts:addressService':
    'AFTER THE FACT. The admin-side twin of the intake cleanup above, same shape ' +
    'and same reason. Both retire together or neither does.',
  'modules/organizations/routes.public.ts:templateEmail':
    'AFTER THE FACT. The verification e-mail is sent after the organisation and the ' +
    'customer account are committed, and the response already tells the caller it ' +
    'did not go out (`emailVerificationSent: false`). Re-throwing would 503 a ' +
    'completed registration. Retiring it means an outbox the registration hands the ' +
    'message to, which is a feature rather than a fix.',

  // Found by the widening for issues #133 and #113 — the seven sites the
  // fixpoint made visible whose right answer is not `rethrowIfModuleDisabled`.
  'modules/organizations/routes.public.ts:onLogin':
    'AFTER THE FACT. The cart-merge hook runs once the session cookie is on the ' +
    'response: the customer is logged in, and feature 037 FR-007/FR-008 say in so ' +
    'many words that a merge failure must not break the login. Re-throwing would ' +
    'take down a completed authentication. Retiring it means asking presence before ' +
    'the hook rather than catching it after, which needs the merge to be a decision ' +
    'the route makes rather than a callback it invokes.',
  'modules/organizations/services/org-registration-notifier.ts:template':
    'AFTER THE FACT. The registration e-mail goes out from a subscriber to ' +
    '`organization.registered.v1`, so the organisation exists whatever happens ' +
    'here and there is no caller to answer. Same outbox question as the ' +
    '`templateEmail` entry above, and the same fix retires both.',
  'modules/product_feeds/services/failed-run-notifier.ts:notifications':
    'AFTER THE FACT, three times in one file. Every call reports a failure that has ' +
    'already been recorded on the run; the method is documented as never throwing ' +
    'precisely so a notification cannot turn a recorded failure into an unrecorded ' +
    'crash. Retiring it means the notifier asking `admin_notifications` for its ' +
    'presence before it composes the message, so "not reported" and "reported ' +
    'nowhere" stop sharing one `false`.',
  'modules/pim_ergonode/services/failed-run-notifier.ts:notifications':
    'AFTER THE FACT. The import twin of the feed notifier above — same contract, ' +
    'same already-recorded failure, same retiring question. They drain together.',
  'modules/catalog/services/bulk-operation.service.ts:notificationService':
    'AFTER THE FACT. The bell notification is written when the bulk operation has ' +
    'already finished and its row carries the outcome; re-throwing would fail a ' +
    'job whose work is done and, on retry, redo the products. Retiring it means the ' +
    'notification being a step the operation records rather than a call it makes.',
  'modules/webhooks/services/webhook-delivery-worker.ts:recordDelivery':
    'AFTER THE FACT. Delivery bookkeeping, written once the HTTP attempt has been ' +
    'made. Re-throwing would fail the job after the endpoint was called and the ' +
    'retry would deliver the same event twice — the one outcome a webhook consumer ' +
    'must not see. Retiring it means the attempt and its record being one write.',
  'modules/catalog/services/catalog-org-price-decorator.ts:resolveAvailability':
    'DEGRADE THE OWNER SHOULD ANSWER. Availability is an indication on a catalog ' +
    'read, and the decorator already has an absent-contribution path returning an ' +
    'empty map — so `inventory` being off has a defined behaviour and 503-ing the ' +
    'product list would be the wrong one. What is missing is that the contribution ' +
    'says so: retiring this means `resolveAvailability` answering absence in its ' +
    'return type, or a `nonBindingDependencies` entry on `catalog` declaring the ' +
    'degrade, rather than a `catch` deciding it.',
  'modules/product_feeds/backend.ts:run':
    'BOOT HOOK. The `reconcile` helper logs and continues so an unbootable API ' +
    'never costs more than a drifted schedule the next boot repairs. `runBootHooks` ' +
    'catches too, which is the kernel making that decision once — and narrowing ' +
    'this `catch` to re-throw was tried and reverted: it changed what the harness ' +
    'boots with, and three `product_feeds` taxonomy contract tests went red. Boot ' +
    'is where a presence answer has no caller to give itself to, so the rule ' +
    '`check:timer-presence` follows applies here — decide presence before the ' +
    'work. Retiring it means the hook asking `effectiveState.isPresent` for each ' +
    'reconcile target instead of running it and catching.',
  'modules/pim_ergonode/backend.ts:handle':
    'BOOT HOOK. The import twin of the `product_feeds` reconcile above — same ' +
    'log-and-continue, same kernel-level catch behind it, same retiring question. ' +
    'They drain together, and re-throwing was measured to be the wrong fix for ' +
    'both.',
  'modules/catalog/routes.public.ts:searchQueryService':
    'DEGRADE THE OWNER SHOULD ANSWER. The Meilisearch path already falls back to ' +
    'Postgres when the backend is unavailable, and the same fallback is the right ' +
    'answer when `search` is off — the catalogue keeps serving its own listing, ' +
    'which is what "behaves as if never installed" means here. Retiring it means ' +
    'the fallback being chosen on presence before the query rather than on an ' +
    'exception after it, next to the `useMeili` test that already asks whether the ' +
    'service is wired at all.',
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
}

/** `<file>:<port>` — the ledger key, and the identity of a site. */
export function keyOf(found: PortCatch): string {
  return `${found.file}:${found.port}`;
}

export interface PortCatchInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
}

interface Analysis {
  /** Names registered through `di.providePort`, and the module that owns each. */
  readonly portOwners: ReadonlyMap<string, string>;
  /** Alias → the modules whose files may read it as a gated port. */
  readonly aliases: ReadonlyMap<string, ReadonlySet<string>>;
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
 * `ctx.di.register(…)`, `ctx.di.providePort(…)`.
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
  /** True when the alias is new — which is what keeps the fixpoint running. */
  let grew = false;
  const addAlias = (name: string, scope: string, where?: string): void => {
    const scopes = aliases.get(name) ?? new Set<string>();
    aliases.set(name, scopes);
    if (!scopes.has(scope)) {
      scopes.add(scope);
      grew = true;
      if (process.env.PORT_CATCH_WHY) console.error(`ALIAS ${name} @${scope} <- ${where ?? '-'}`);
    }
  };
  // A gated port's own name reads as one everywhere except inside its owner,
  // where the identical identifier is normally the module's own instance.
  for (const name of portOwners.keys()) addAlias(name, EVERYWHERE);

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
          addAlias(node.name.text, file, at(node));
        }
        // `{ promotion: lazyPort(ctx, 'promotionService') }` — a deps-object key.
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
          if (carries(node.initializer)) addAlias(node.name.text, scope, at(node));
        }
        if (ts.isShorthandPropertyAssignment(node) && reads(node.name.text)) {
          addAlias(node.name.text, scope, at(node));
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
                addAlias(parameter.name.text, scope, at(node));
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
                  addAlias(property.name.text, EVERYWHERE, at(property));
                }
                if (ts.isShorthandPropertyAssignment(property) && reads(property.name.text)) {
                  addAlias(property.name.text, EVERYWHERE, at(property));
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

  return { portOwners, aliases, readsAsPort };
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

/** Every `try` in `src/**` whose body calls through a gated port. */
export function findPortCatches(input: PortCatchInput): PortCatch[] {
  const analysis = analyze(input.sources);
  const found: PortCatch[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  for (const [file, text] of input.sources) {
    parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  const delegates = collectRethrowDelegates(parsed.values());

  for (const [file] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`) ?? ROOT;
    const sf = parsed.get(file) as ts.SourceFile;

    const readsAsPort = (name: string): boolean => analysis.readsAsPort(name, moduleId, file);

    const visit = (node: ts.Node): void => {
      if (ts.isTryStatement(node) && node.catchClause) {
        const ports = new Set<string>();
        const scan = (inner: ts.Node): void => {
          if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
            const receiver = tailName(inner.expression.expression);
            if (receiver !== null && readsAsPort(receiver)) {
              ports.add(receiver);
            } else if (readsAsPort(inner.expression.name.text)) {
              // `this.deps.getTransactionalEmailSender()` — the alias is the
              // thing being called, not the object it hangs off.
              ports.add(inner.expression.name.text);
            }
          }
          if (
            ts.isCallExpression(inner) &&
            ts.isIdentifier(inner.expression) &&
            inner.expression.text !== 'lazyPort' &&
            readsAsPort(inner.expression.text)
          ) {
            ports.add(inner.expression.text);
          }
          // `requireModuleEnabled('x')` throws the same error, on purpose.
          if (
            ts.isCallExpression(inner) &&
            ts.isIdentifier(inner.expression) &&
            inner.expression.text === 'requireModuleEnabled'
          ) {
            ports.add('requireModuleEnabled');
          }
          inner.forEachChild(scan);
        };
        node.tryBlock.forEachChild(scan);

        if (ports.size > 0) {
          const handled = handles(node.catchClause, delegates);
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          for (const port of ports) found.push({ file, line, moduleId, port, handled });
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
  /** Ledger keys that no longer describe a violation — the staleness half. */
  readonly stale: readonly string[];
}

export function checkPortCatches(
  input: PortCatchInput,
  ledger: Readonly<Record<string, string>> = PORT_CATCHES_TO_DRAIN,
): CheckResult {
  const all = findPortCatches(input);
  const unhandled = all.filter((entry) => !entry.handled);
  const keys = new Set(unhandled.map(keyOf));
  return {
    total: all.length,
    violations: unhandled.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: unhandled.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

function main(): void {
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

  const result = checkPortCatches({ sources });

  if (listMode) {
    for (const entry of findPortCatches({ sources })) {
      const tag = entry.handled
        ? 'HANDLED '
        : PORT_CATCHES_TO_DRAIN[keyOf(entry)] !== undefined
          ? 'LEDGERED'
          : 'BARE    ';
      console.log(`${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.port}`);
    }
    console.log('');
  }

  console.log(
    `[port-catches] guarded-port catches=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
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
    console.error('\nStale ledger entries (no longer describe a bare catch — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
