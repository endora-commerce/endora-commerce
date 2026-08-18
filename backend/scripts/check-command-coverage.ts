import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Command-coverage check — feature 054 (FR-009 / FR-010, Constitution Principle XIII).
 *
 * `pnpm --filter backend run check:command-coverage -- [--strict] [--module <name> ...]`
 *
 * Flags, **per method/function/route handler** in every file a module owns:
 *   1. an **unaudited sensitive write** — a method that performs a mutation call
 *      (`persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush`) but
 *      neither runs a Command (`commandBus.run(...)`) nor writes audit
 *      (`.record*(...)`) in the same method;
 *   2. a **double-audit** — a method that BOTH runs a Command AND writes audit by
 *      hand (a converted write must remove its manual audit call, FR-010).
 *
 * Method-level (not file-level) so a partially-migrated file is judged per
 * method: a converted `adjust` no longer masks an unaudited `grant` in the same
 * file, and a Command in one method is not mistaken for a double-audit against a
 * legacy `record()` in another.
 *
 * Escape hatch: a genuinely non-sensitive write (bookkeeping rows — progress
 * counters, cache, queue state) can be exempted by putting a
 * `command-coverage-ignore: <reason>` comment anywhere in the method. This keeps
 * "build-breaking per module" honest without forcing audit onto non-domain writes,
 * mirroring the audited `withSystemScope` escape hatch for tenancy.
 *
 * ## The escape hatch is a two-way ratchet (issue #116)
 *
 * 185 methods carry that comment, and until now nothing ever re-read one. An
 * ignore written for a write that has since moved elsewhere — into a Command, or
 * into another module's audited service — went on reading as a considered
 * decision about a write that is no longer there, and the next person to add a
 * write to that method inherited the exemption silently.
 *
 * So a marker on a method that **no longer writes at all** is reported as
 * `stale-ignore`, in the idiom of `PORT_CATCHES_TO_DRAIN` and
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered violation fails the build, and an
 * entry that no longer describes one fails it too. MR !532's marker in
 * `orders/order-completion-reactor.ts` — added because a refactor made an
 * *existing* write visible to this check — is exactly the entry that has to be
 * re-verified rather than trusted, and now it is, on every run.
 *
 * **The staleness half looks for writes more widely than the flagging half**,
 * and the asymmetry is deliberate: both errors then fall on the safe side. The
 * flagging half only flags an ORM mutation call it is sure about; the staleness
 * half additionally counts a raw SQL write statement (`conn.execute` with an
 * `update`/`insert into`/`delete from`) and any write reached transitively
 * through `this.<name>(…)` in the same file — so a marker guarding a real write
 * this check cannot itself see is left alone, and only a marker guarding nothing
 * is reported.
 *
 * **With one subtraction (D-89c): a downstream write that itself carries a
 * marker does not keep the caller's marker alive.** The transitive rule exists
 * so a marker over a write this check cannot see is not called stale; when the
 * write it reaches is *already exempted where it happens*, the caller's marker
 * is provably guarding nothing and the ratchet has to say so. The worked
 * example carries the failure and its correction in one file:
 * `payments/services/payment-reference-port.ts` marked `stampExternalReference`
 * and `stampExternalReferenceIfAbsent`, neither of which writes, and later
 * marked the private `stamp` that does the `flush` — with a comment explaining
 * that the marker had to be repeated there "because the check reads the
 * function that writes". Both redundant caller markers survived, and nothing
 * could see them.
 *
 * ## What "every service" was allowed to mean (issue #122)
 *
 * The walk matched `**​/services/<file>.ts` — **one level, nothing else**. Over
 * the tree that is **472 of 1152** module files: 680 were never opened, 78 of
 * them containing a write signal. Invisible were `pim_ergonode/services/import/`,
 * `product_feeds/services/delivery/` and `services/queues/` (nested a level too
 * deep), every `workers/`, `queues/` and `jobs/` file, every `commands/` file,
 * every `routes*.ts`, every `backend.ts` boot hook, every `scripts/` entry point
 * and every `seeds/` reconciler. Queue consumers and admin route handlers are
 * exactly where writes live, so the check read clean over the two categories
 * Principle XIII is most about.
 *
 * The boundary is now **every `.ts` file under `src/modules/` and `src/apps/`**.
 * Four exclusions remain, and each is an argument rather than an omission:
 *
 *   - `migrations/` — DDL applied by the migrator with no request, no actor and
 *     no undo; an audit entry for one would have nobody to attribute it to. The
 *     migration registry and `db:fresh` are its gate.
 *   - `*.test.ts` / `*.d.ts` — not shipped code.
 *   - `audit_logs/` — the audit writer itself. Its writes *are* the audit
 *     entries; requiring one for each is circular.
 *
 * Everything else is judged, including `seeds/` and `scripts/`: a CLI entry
 * point creating an administrator and a boot reconciler writing predefined rows
 * are operator-visible writes that happen to run outside a request, and a
 * category-wide exemption for them is the same mistake one folder over.
 *
 * ## Two narrowings the widening forced
 *
 * A wider walk meets shapes a `services/` file rarely has, and a check that
 * answers them with exemptions is lying about the tree rather than reading it:
 *
 *   1. **`remove` is only an ORM mutation off an EntityManager.** 30 of the 36
 *      first-pass findings were `deps.<x>Service.remove(id)` in a route handler
 *      — a call into an audited service. Every other name in the vocabulary
 *      (`persist`, `persistAndFlush`, `nativeUpdate`, `nativeDelete`,
 *      `removeAndFlush`, `flush`) is MikroORM's alone and still counts off any
 *      receiver. The **staleness half keeps counting `remove` everywhere**, so
 *      the asymmetry above survives: the narrowing can only add a report, never
 *      silence one.
 *   2. **A route file is judged per handler.** `registerXAdminRoutes` is not a
 *      unit of work; each handler is. Read as one unit, a single
 *      `commandBus.run` anywhere in the file clears every other handler in it —
 *      the masking the per-method rule exists to prevent, one level up. It also
 *      manufactured two `double-audit` reports across handlers that never met.
 *
 * ## What this check cannot see, and will not pretend to (D-89b)
 *
 * This check reads **call** shapes. A field assignment on a managed entity —
 * `order.status = ref`, `refund.settlementState = outcome.state` — is a write
 * the unit of work will flush and this check cannot see it. The unit is judged
 * by the calls it makes, so an assignment is caught only when the same unit also
 * calls one of the vocabulary. A unit that assigns and lets its caller flush is
 * outside the population, **by construction and not by exemption**.
 *
 * That is refused deliberately rather than deferred. The shapes are not
 * separable by a static name test: `x.y = z` is the most common statement form
 * in the language, `x` is a managed entity only when the type checker says so,
 * and this check does not build a program. Reading every assignment as a
 * candidate write would put a finding on most methods in the tree and teach
 * people to write exemptions; reading none of them keeps the check's green
 * honest — provided the green is read as what it is. So: a green
 * `check:command-coverage --strict` means *"no unaudited sensitive write of a
 * shape this check can see"*, and it does not mean *"every sensitive write is
 * audited"*. It cannot be made to mean the second at anything like this cost.
 *
 * Scope & staging: build-breaks (exit 1) for **migrated modules**
 * (`MIGRATED_MODULES` below, or `--module`); any other module would be
 * report-only. The platform-wide rollout is COMPLETE — every module is migrated
 * (see the list below) and CI runs with `--strict`, so a finding in ANY module,
 * including a brand-new one not yet in the list, fails the build.
 */

/**
 * Modules whose service writes are converted to Commands / audited / escape-hatched
 * (build-breaking). The rollout is complete: this is the full module set. New
 * modules should be added here as they land, but CI's `--strict` flag already
 * fails on findings in unlisted modules too, so coverage cannot silently regress.
 */
export const MIGRATED_MODULES: readonly string[] = [
  'credit_limits',
  'price_lists',
  'catalog',
  'orders',
  'inventory',
  'returns',
  'quote_requests',
  'organizations',
  'promotions',
  'carts',
  'customer_accounts',
  'assets_library',
  'shopping_lists',
  'dictionaries',
  'currencies',
  'languages',
  'mfa',
  'stripe',
  'tpay',
  'payu',
  'transactional_emails',
  'invoices',
  'newsletter',
  'admin_users',
  'payments',
  'shipments',
  'payment_methods',
  'delivery_methods',
  'addresses',
  'auth',
  'customers',
  'taxes',
  'api_keys',
  'admin_roles',
  'seo',
  'webhooks',
  'settings',
  'comparisons',
  'pwa',
  'prompt_actions',
  'analytics',
  'search',
  'cms',
  'admin_notifications',
  'admin_actions',
  '_i18n',
  'credentials',
  'ksef',
  'product_feeds',
  'pim_ergonode',
];

/**
 * Mutation names that belong to MikroORM and to nothing else in this tree, so
 * they count off any receiver.
 */
const ORM_MUTATIONS = new Set([
  'persist',
  'persistAndFlush',
  'nativeUpdate',
  'nativeDelete',
  'removeAndFlush',
  'flush',
]);

/**
 * Mutation names that are also ordinary vocabulary. `remove` is MikroORM's and
 * also every service's, every queue backend's and every transport client's —
 * `deps.countryService.remove(code)`, `scheduler.remove(id)`,
 * `ftpClient.remove(path)`. `create` is worse on the same axis: it is the name
 * of nearly every service method in this tree. Both count for the flagging half
 * only off an EntityManager; the staleness half counts them everywhere (see the
 * header).
 *
 * `create` joined in D-89. `em.create(Entity, …)` puts a managed entity into the
 * unit of work — the insert is queued from that moment and the next `flush`
 * writes it, whoever calls it — so a unit whose only mutation call is an
 * `em.create` was invisible to this check while being every bit as much a write
 * as the `persist` next door. That is the hole that let a CSV import rewrite
 * catalogue and stock unaudited for a year.
 */
const AMBIGUOUS_MUTATIONS = new Set(['remove', 'create']);

const MUTATION_METHODS = new Set([...ORM_MUTATIONS, ...AMBIGUOUS_MUTATIONS]);

/**
 * An identifier that names a MikroORM EntityManager, as this tree spells it:
 * `em`, the transactional `tx` / `trx`, the short forked forms `tem` / `cem`,
 * any `<word>Em` (`txEm`, `targetEm`), and the factories `em()` / `emFactory()`.
 *
 * Deliberately *not* "anything ending in em" — that matches `item` and `system`,
 * and a check that flags `item.remove(x)` teaches people to write exemptions.
 */
const ENTITY_MANAGER_NAME = /^(?:em|tem|cem|tx|trx|entityManager|emFactory|[A-Za-z]+Em)$/;

/**
 * Whether an expression is (or yields) an EntityManager, by name.
 *
 * Unwraps calls and the usual wrappers, so `this.em()`, `this.deps.em()` and
 * `em.fork()` all resolve; recurses through a chained mutation so
 * `em.remove(a).remove(b)` stays an EntityManager at every link.
 */
function isEntityManagerReceiver(node: ts.Expression): boolean {
  let current: ts.Node = node;
  while (
    ts.isCallExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  const name = ts.isPropertyAccessExpression(current)
    ? current.name.text
    : ts.isIdentifier(current)
      ? current.text
      : null;
  if (name === null) return false;
  if (ENTITY_MANAGER_NAME.test(name)) return true;
  if (
    ts.isPropertyAccessExpression(current) &&
    (MUTATION_METHODS.has(name) || name === 'fork' || name === 'transactional')
  ) {
    return isEntityManagerReceiver(current.expression);
  }
  return false;
}

/**
 * Fastify route registrations. Each function argument is its own unit of work.
 *
 * A call only counts when its first argument is a string literal path, which is
 * what tells `app.get('/api/…', handler)` apart from `cache.get(key)` and
 * `set.delete(key)`. `.route({ … })` is not in the list because the tree does
 * not use it; a first use would be invisible here, so it is named in the
 * companion test rather than left to be discovered.
 */
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

/** Option-object properties whose value is a handler in its own right. */
const HANDLER_PROPERTIES = new Set(['handler', 'preHandler', 'onRequest', 'preValidation']);

/**
 * A SQL statement that writes, as it appears in a string or template literal
 * handed to `conn.execute` / `em.execute`.
 *
 * Only the staleness half reads this. Matching prose in a literal
 * (`'update the row'`) marks the unit as writing, which suppresses a staleness
 * report — the safe direction, since the cost is a marker left standing rather
 * than a marker deleted off a live write.
 */
const SQL_WRITE = /\b(insert\s+into|update\s+["`']?[a-z_]|delete\s+from|truncate\s+table)/i;

/**
 * Writes that leave the database entirely — BullMQ schedulers and Redis keys.
 *
 * Only the staleness half reads this, for the same reason it reads `SQL_WRITE`.
 * `product_feeds/workers/taxonomy-refresh-worker.ts` documents its
 * `queue.removeJobScheduler(…)` with a marker that says, correctly, "Redis-only";
 * a sweep that knew only ORM and SQL called that marker dead the moment
 * `workers/` came into scope. The flagging half deliberately does not read it —
 * a queue write is not a Command Bus write.
 */
const NON_SQL_WRITE_METHODS = new Set([
  'removeJobScheduler',
  'upsertJobScheduler',
  'removeRepeatable',
  'removeRepeatableByKey',
  'obliterate',
  'drain',
  'clean',
  'del',
  'unlink',
  'hset',
  'hdel',
  'expire',
  'setex',
]);

const AUDIT_RECEIVER =
  /(auditLog|auditLogService|auditService|AuditLogService|cartAuditService|\.audit)$/;
const SUPPRESS_TOKEN = 'command-coverage-ignore';

export type FindingKind = 'unaudited-sensitive-write' | 'double-audit' | 'stale-ignore';

export interface CoverageFinding {
  filePath: string;
  line: number | null;
  method: string;
  kind: FindingKind;
  message: string;
}

interface UnitScan {
  hasMutation: boolean;
  mutationLine: number | null;
  hasAuditWrite: boolean;
  runsCommand: boolean;
  /** Contains a `Command` object literal (has `action` + `run` properties). */
  definesCommand: boolean;
  /**
   * Names this unit calls — `this.<name>(…)` and a bare `<name>(…)` alike.
   *
   * The bare form matters as soon as `commands/`, `workers/` and `routes*.ts`
   * are in scope: their helpers are module-level functions, never methods, so
   * delegation expressed as `replaceFields(em, id)` inside a Command's `run`
   * was unreachable while only `this.` counted.
   */
  calls: Set<string>;
  /**
   * Writes anything at all, by the widest reading: an ORM mutation call OR a raw
   * SQL write statement. Only the staleness sweep uses it — see the header.
   */
  writesAnything: boolean;
}

/** Whether an object literal is a Command definition (`action` + `run` props). */
function isCommandLiteral(node: ts.ObjectLiteralExpression): boolean {
  const names = new Set(
    node.properties
      .map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : null))
      .filter((n): n is string => n !== null),
  );
  return names.has('action') && names.has('run');
}

/**
 * Scan a single method/function subtree for mutation / audit / command calls.
 *
 * `nested` holds the route handlers that are units of their own; their subtrees
 * belong to them, not to the registration function that contains them.
 */
function scanUnit(node: ts.Node, sf: ts.SourceFile, nested: ReadonlySet<ts.Node>): UnitScan {
  const scan: UnitScan = {
    hasMutation: false,
    mutationLine: null,
    hasAuditWrite: false,
    runsCommand: false,
    definesCommand: false,
    calls: new Set(),
    writesAnything: false,
  };
  const visit = (n: ts.Node): void => {
    if (nested.has(n)) return;
    if (ts.isObjectLiteralExpression(n) && isCommandLiteral(n)) {
      scan.definesCommand = true;
    }
    if (ts.isStringLiteralLike(n) && SQL_WRITE.test(n.text)) {
      scan.writesAnything = true;
    }
    // The sanctioned free-function audit primitive (commands/audit-from-context):
    // `recordAuditFromContext(auditLog, em, …)` writes a co-transactional entry.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'recordAuditFromContext'
    ) {
      scan.hasAuditWrite = true;
    }
    // A bare `helper(...)` — delegation to a module-level function.
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      scan.calls.add(n.expression.text);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const receiver = n.expression.expression;
      const receiverText = receiver.getText(sf);
      if (NON_SQL_WRITE_METHODS.has(method)) {
        scan.writesAnything = true;
      }
      if (MUTATION_METHODS.has(method)) {
        // The staleness half reads the widest possible answer; the flagging half
        // asks an ambiguous name to prove its receiver is an EntityManager.
        scan.writesAnything = true;
        if (!AMBIGUOUS_MUTATIONS.has(method) || isEntityManagerReceiver(receiver)) {
          scan.hasMutation = true;
          if (scan.mutationLine === null) {
            scan.mutationLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          }
        }
      }
      if ((method === 'record' || method === 'recordWithin') && AUDIT_RECEIVER.test(receiverText)) {
        scan.hasAuditWrite = true;
      }
      if (method === 'run' && /commandBus$/.test(receiverText)) {
        scan.runsCommand = true;
      }
      // `this.<name>(...)` — a candidate delegation to an audited runner.
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        scan.calls.add(method);
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return scan;
}

/** A named method/function unit and whether it opted out via the escape-hatch comment. */
interface Unit {
  name: string;
  node: ts.Node;
  suppressed: boolean;
  /** Where the `command-coverage-ignore` comment sits, so a stale one is findable. */
  suppressedLine: number | null;
}

function unitName(node: ts.Node): string {
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isPropertyDeclaration(node) && node.name) return node.name.getText();
  if (ts.isVariableDeclaration(node) && node.name) return node.name.getText();
  return '<anonymous>';
}

function isArrowOrFn(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/**
 * Route handlers, as units of their own.
 *
 * Fastify registers them as function arguments to `app.<method>('/path', …)`,
 * so a registration function contains every handler in the file. Judged as one
 * unit it hides them from each other; each handler gets its own unit here, named
 * `POST /api/v1/admin/…` so a finding points at the route an operator calls.
 */
function collectRouteHandlers(sf: ts.SourceFile): Unit[] {
  const handlers: Unit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROUTE_METHODS.has(node.expression.name.text) &&
      node.arguments.length > 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const name = `${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`;
      for (const arg of node.arguments.slice(1)) {
        if (isArrowOrFn(arg)) {
          handlers.push({ name, node: arg, suppressed: false, suppressedLine: null });
        } else if (ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              HANDLER_PROPERTIES.has(prop.name.text) &&
              isArrowOrFn(prop.initializer)
            ) {
              handlers.push({
                name: `${name} (${prop.name.text})`,
                node: prop.initializer,
                suppressed: false,
                suppressedLine: null,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return handlers;
}

/**
 * Function-valued locals — `const audit = async (…) => …` declared *inside* a
 * registration function or a method.
 *
 * They are **not** judged: a closure's write belongs to the unit that runs it,
 * which is why `collectUnits` only takes a top-level `const fn = () => …`. But
 * they are legitimate delegation targets, and `organizations/routes.admin.ts`
 * is built entirely on one — every audited handler in it calls the file's local
 * `audit(…)`. Without them, six handlers that audit correctly were reported as
 * unaudited, which is the wrong direction for a check nobody may exempt away.
 */
function collectHelperClosures(sf: ts.SourceFile): { name: string; node: ts.Node }[] {
  const helpers: { name: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      isArrowOrFn(node.initializer) &&
      ts.isIdentifier(node.name) &&
      // top-level ones are already units in their own right
      !(node.parent?.parent?.parent !== undefined && ts.isSourceFile(node.parent.parent.parent))
    ) {
      helpers.push({ name: node.name.text, node });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return helpers;
}

/**
 * Collect top-level method/function units plus every route handler, and the set
 * of handler nodes their enclosing registration function must not absorb.
 */
function collectUnits(sf: ts.SourceFile): { units: Unit[]; nested: ReadonlySet<ts.Node> } {
  const handlers = collectRouteHandlers(sf);
  const nested = new Set(handlers.map((h) => h.node));
  const units: Unit[] = [];
  const walk = (node: ts.Node): void => {
    let root: ts.Node | null = null;
    if (
      ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      root = node;
    } else if (ts.isPropertyDeclaration(node) && isArrowOrFn(node.initializer)) {
      root = node; // class field arrow method
    } else if (
      ts.isVariableDeclaration(node) &&
      isArrowOrFn(node.initializer) &&
      // only top-level `const x = () => …`, not locals inside a method
      node.parent?.parent?.parent !== undefined &&
      ts.isSourceFile(node.parent.parent.parent)
    ) {
      root = node;
    }

    if (root) {
      const suppressedLine = suppressionLine(root, sf, nested);
      units.push({
        name: unitName(root),
        node: root,
        suppressed: suppressedLine !== null,
        suppressedLine,
      });
      return; // do NOT recurse — inline callbacks belong to this unit
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  for (const handler of handlers) {
    const suppressedLine = suppressionLine(handler.node, sf, nested);
    units.push({ ...handler, suppressed: suppressedLine !== null, suppressedLine });
  }
  return { units, nested };
}

/**
 * The 1-based line of this unit's `command-coverage-ignore`, or `null`.
 *
 * Two things it deliberately does not count (issue #122):
 *
 *   - a token inside a **nested** unit — a marker on one route handler is not an
 *     exemption for the registration function that holds it, nor for the handler
 *     next to it;
 *   - a token in trivia that is not the unit's **own** doc comment. Four command
 *     files describe their policy in a file header that quotes the token; read
 *     from `getFullStart()`, that header exempted whichever declaration happened
 *     to come first — and once the staleness sweep landed, reported it as a dead
 *     marker nobody had written. Only the **last leading comment block, adjacent
 *     to the declaration**, counts: a blank line between the two makes it a file
 *     header rather than a doc comment. That is what still lets
 *     `_lifecycle/services/presence-load.ts` spell its rationale out in JSDoc
 *     above the function it exempts.
 */
function suppressionLine(
  node: ts.Node,
  sf: ts.SourceFile,
  nested: ReadonlySet<ts.Node>,
): number | null {
  const full = sf.getFullText();
  const inNested = (offset: number): boolean =>
    [...nested].some((n) => n !== node && offset >= n.getStart(sf) && offset < n.getEnd());

  for (
    let at = full.indexOf(SUPPRESS_TOKEN, node.getStart(sf));
    at !== -1 && at < node.getEnd();
    at = full.indexOf(SUPPRESS_TOKEN, at + SUPPRESS_TOKEN.length)
  ) {
    if (!inNested(at)) return sf.getLineAndCharacterOfPosition(at).line + 1;
  }

  const leading = ts.getLeadingCommentRanges(full, node.getFullStart()) ?? [];
  const own = leading.at(-1);
  // Adjacent means "nothing but one line break between the comment and the
  // declaration" — a blank line makes it a file header, not this unit's doc.
  if (own && !/\n\s*\n/.test(full.slice(own.end, node.getStart(sf)))) {
    const at = full.indexOf(SUPPRESS_TOKEN, own.pos);
    if (at !== -1 && at < own.end) return sf.getLineAndCharacterOfPosition(at).line + 1;
  }
  return null;
}

/** Static, dependency-free per-method analysis of a single source file. */
export function analyzeSource(filePath: string, source: string): CoverageFinding[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const collected = collectUnits(sf);
  const units = collected.units.map((u) => ({ ...u, scan: scanUnit(u.node, sf, collected.nested) }));
  // Delegation targets that are not themselves judged (see collectHelperClosures).
  const helpers = collectHelperClosures(sf).map((h) => ({
    ...h,
    scan: scanUnit(h.node, sf, collected.nested),
  }));
  const delegates = [...units, ...helpers];

  // Pass 1 — a "runner" method executes writes through the Command Bus (calls
  // commandBus.run, or defines a Command literal the bus will run). A method that
  // delegates to a runner (`this.<runner>(...)`) is therefore audited too.
  const runnerNames = new Set(
    delegates.filter((u) => u.scan.runsCommand || u.scan.definesCommand).map((u) => u.name),
  );
  // …and a "recorder" method writes audit by hand (`auditLog.record(...)` /
  // `.recordWithin(...)`). A very common shape is a public write that mutates and
  // then calls a private `this.writeAudit()` helper which records — the mutation
  // and the audit call live in different methods. Recognizing delegation to a
  // recorder (symmetric with runner delegation) clears that legitimate pattern
  // instead of flagging an already-audited write as unaudited.
  const recorderNames = new Set(delegates.filter((u) => u.scan.hasAuditWrite).map((u) => u.name));

  // A unit is directly covered if it runs a Command, defines one, records audit,
  // or forward-delegates to a runner/recorder.
  const isDirectlyCovered = (u: { name: string; scan: UnitScan }): boolean =>
    u.scan.runsCommand ||
    u.scan.definesCommand ||
    u.scan.hasAuditWrite ||
    [...u.scan.calls].some((n) => runnerNames.has(n) || recorderNames.has(n));

  // Reverse delegation — a mutating PRIVATE helper (`applyGlobal`, `applyProduct`)
  // that is invoked by a covered public method is part of that method's audited
  // unit of work: its `em.persist` only flushes when the covered caller flushes,
  // co-transactionally with the caller's audit/Command. Collect every method name
  // called via `this.<name>()` from a covered unit and treat those as covered too.
  const coveredCallees = new Set<string>();
  for (const u of delegates) {
    if (isDirectlyCovered(u)) for (const n of u.scan.calls) coveredCallees.add(n);
  }

  // The staleness half. A unit still writes if it writes itself, or if anything
  // it calls as `this.<name>(…)` in this file does — `reserve()` delegating to
  // `#reserveFlat()`, a reaper delegating to `release()`. Memoised over the
  // recursion so a cycle terminates.
  const byName = new Map(delegates.map((u) => [u.name, u]));
  /** Does this delegate carry a marker of its own? Helpers never do. */
  const carriesMarker = (unit: (typeof delegates)[number]): boolean =>
    'suppressed' in unit && unit.suppressed === true;
  const reachesWrite = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const unit = byName.get(name);
    if (!unit) return false;
    if (unit.scan.writesAnything) return true;
    return [...unit.scan.calls].some((callee) => {
      // D-89(c) — a downstream that carries its own marker is already exempted
      // where it writes, so it does not keep this caller's marker alive. Without
      // this the ratchet cannot see the shape it was written for: a marker on
      // two public callers of a private body that carries a third.
      const target = byName.get(callee);
      if (target !== undefined && carriesMarker(target)) return false;
      return reachesWrite(callee, seen);
    });
  };

  // A route handler is named `POST /api/…`, a method `rename` — only the latter
  // reads as a call site.
  const label = (name: string): string => (name.includes(' ') ? name : `${name}()`);

  const findings: CoverageFinding[] = [];
  for (const u of units) {
    if (u.suppressed) {
      if (!reachesWrite(u.name)) {
        findings.push({
          filePath,
          line: u.suppressedLine,
          method: u.name,
          kind: 'stale-ignore',
          message:
            `${label(u.name)} carries a command-coverage-ignore but writes nothing — ` +
            'the write it exempted has moved or gone. Delete the marker; keep the ' +
            'sentence as an ordinary comment if it still explains something',
        });
      }
      continue;
    }
    const s = u.scan;
    const covered = isDirectlyCovered(u) || coveredCallees.has(u.name);
    if (s.hasMutation && !covered) {
      findings.push({
        filePath,
        line: s.mutationLine,
        method: u.name,
        kind: 'unaudited-sensitive-write',
        message: `${label(u.name)} mutates without a Command or an audit entry`,
      });
    }
    if (s.runsCommand && s.hasAuditWrite) {
      findings.push({
        filePath,
        line: s.mutationLine,
        method: u.name,
        kind: 'double-audit',
        message: `${label(u.name)} runs a Command AND records audit by hand (remove the manual record() — FR-010)`,
      });
    }
  }
  return findings;
}

/** Whether a repo-relative module path belongs to a build-breaking (migrated) module. */
export function isMigratedModulePath(
  relPath: string,
  migrated: readonly string[] = MIGRATED_MODULES,
): boolean {
  // Not anchored on `/services/` any more: the walk reaches `routes.admin.ts`,
  // `workers/` and `commands/` too, and anchoring there would have made every
  // newly visible file report-only in a module that is fully migrated.
  const m = /modules\/([^/]+)\//.exec(relPath.replaceAll('\\', '/'));
  return m !== null && migrated.includes(m[1]!);
}

// ---- CLI (disk-backed) ----------------------------------------------------

/** The roots the CLI walks, relative to `backend/`. */
export const SCAN_ROOTS: readonly string[] = ['src/modules', 'src/apps'];

/**
 * Every file the check judges, under `root` (`src/modules` or `src/apps`).
 *
 * Exported so the check's own test can assert the **real** tree is clean rather
 * than only that the analyzer can go red on a fixture — the scan scope then has
 * one definition, shared by the CLI and the test.
 *
 * The exclusions are argued in the header; each is a claim that the category
 * cannot hold an operator-visible write, not a convenience.
 */
export function collectScannedFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === 'migrations') continue;
        walk(full);
      } else if (
        full.endsWith('.ts') &&
        !full.endsWith('.d.ts') &&
        !full.endsWith('.test.ts') &&
        !full.replaceAll('\\', '/').includes('/audit_logs/')
      ) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function main(): void {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const moduleArgs = argv.reduce<string[]>((acc, arg, i) => {
    if (arg === '--module' && argv[i + 1]) acc.push(argv[i + 1]!);
    return acc;
  }, []);
  const migrated = moduleArgs.length > 0 ? moduleArgs : MIGRATED_MODULES;

  const roots = SCAN_ROOTS.map((r) => join(process.cwd(), r)).filter((r) => existsSync(r));
  const files = roots.flatMap((root) => collectScannedFiles(root));
  if (files.length === 0) {
    // Run from the wrong directory, or after a layout change, the walk finds
    // nothing and every write in the platform passes unexamined. Exit 2: a
    // green line here would say "no unaudited write", which is not what it
    // would mean.
    process.stderr.write(
      `[command-coverage] no files under ${SCAN_ROOTS.join(', ')} — refusing to report a vacuous pass\n`,
    );
    process.exit(2);
  }

  let blocking = 0;
  let reportOnly = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const findings = analyzeSource(rel, readFileSync(file, 'utf8'));
    if (findings.length === 0) continue;
    const isBlocking = strict || isMigratedModulePath(rel, migrated);
    for (const f of findings) {
      const tag = isBlocking ? 'ERROR' : 'report';
      process.stdout.write(`[${tag}] ${f.filePath}:${f.line ?? '?'} → ${f.kind}: ${f.message}\n`);
      if (isBlocking) blocking += 1;
      else reportOnly += 1;
    }
  }

  process.stdout.write(
    `\ncommand-coverage: ${blocking} blocking, ${reportOnly} report-only ` +
      `(migrated modules: ${migrated.length > 0 ? migrated.join(', ') : 'none'})\n`,
  );
  if (blocking > 0) process.exit(1);
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
