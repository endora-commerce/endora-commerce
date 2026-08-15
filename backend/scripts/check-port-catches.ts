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
 *
 * Aliases are **scoped to the module that bound them**, because they are
 * ordinary local names: `credentials` binds `service`, and a file-global table
 * would then read every `x.service.y()` in the tree as a port call. A gated
 * port's own name is global *except inside the module that owns it*, where the
 * same identifier normally denotes the module's own instance — `invoices`
 * holds a real `invoiceService` and never resolves its own port.
 *
 * ## What counts as handling it
 *
 * A `catch` passes when it does one of three things:
 *
 *   - re-throws unconditionally (its last statement is a `throw`);
 *   - calls `rethrowIfModuleDisabled(error)` — the kernel's one-line narrowing;
 *   - names `ModuleDisabledError` itself.
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
 * Every entry here shares one shape — the guarded call runs **after** the
 * operation it belongs to has already committed, so re-throwing would report a
 * failure for work that succeeded. That is a design question about compensating
 * actions, not a `catch` somebody forgot to narrow, which is why they are
 * ledgered rather than fixed in the sweep that produced this file.
 */
export const PORT_CATCHES_TO_DRAIN: Readonly<Record<string, string>> = {
  'modules/orders/services/order-api-intake-service.ts:addressService':
    'Compensating cleanup of transient addresses. It runs on the success path too, ' +
    'after the order is committed, so re-throwing would fail a placement that ' +
    'succeeded. Retiring it means giving the cleanup somewhere to report to — a ' +
    'reconciliation row, not the caller.',
  'modules/orders/services/order-creation-admin-service.ts:addressService':
    'The admin-side twin of the intake cleanup above, same shape and same reason. ' +
    'Both retire together or neither does.',
  'modules/organizations/routes.public.ts:templateEmail':
    'The verification e-mail is sent after the organisation and the customer ' +
    'account are committed, and the response already tells the caller it did not ' +
    'go out (`emailVerificationSent: false`). Re-throwing would 503 a completed ' +
    'registration. Retiring it means an outbox the registration hands the message ' +
    'to, which is a feature rather than a fix.',
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
}

/**
 * Which names stand for a gated port, and where each one may be read.
 *
 * Three passes over the same trees, because the shapes chain: a `lazyPort` may
 * be bound to a local, the local passed to a constructor, and the constructor's
 * parameter reached as `this.x` in another file entirely.
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
  const addAlias = (name: string, scope: string): void => {
    const scopes = aliases.get(name) ?? new Set<string>();
    aliases.set(name, scopes);
    scopes.add(scope);
  };
  // A gated port's own name reads as one everywhere except inside its owner,
  // where the identical identifier is normally the module's own instance.
  for (const name of portOwners.keys()) addAlias(name, EVERYWHERE);

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

  for (const [file, sf] of parsed) {
    const scope = moduleOf(`/src/${file}`) ?? ROOT;

    // `const x = lazyPort(…)` — the local itself, first, so the pass below can
    // recognise it being handed on.
    const locals = new Set<string>();
    const collectLocals = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isProxyCall(node.initializer)
      ) {
        locals.add(node.name.text);
        addAlias(node.name.text, scope);
      }
      node.forEachChild(collectLocals);
    };
    sf.forEachChild(collectLocals);

    const carriesProxy = (node: ts.Node): boolean =>
      isProxyCall(node) || (ts.isIdentifier(node) && locals.has(node.text));

    const visit = (node: ts.Node): void => {
      // `{ promotion: lazyPort(ctx, 'promotionService') }` — a deps-object key.
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        if (carriesProxy(node.initializer)) addAlias(node.name.text, scope);
      }
      if (ts.isShorthandPropertyAssignment(node) && locals.has(node.name.text)) {
        addAlias(node.name.text, scope);
      }
      // `new CartService(emFactory, lazyPort(…))` — the parameter it lands on.
      if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.arguments) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
        if (callee !== null) {
          node.arguments.forEach((argument, index) => {
            if (!carriesProxy(argument)) return;
            const declaration = ts.isNewExpression(node)
              ? classes.get(callee)?.members.find(ts.isConstructorDeclaration)
              : functions.get(callee);
            const parameter = declaration?.parameters[index];
            if (parameter && ts.isIdentifier(parameter.name)) addAlias(parameter.name.text, scope);
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  return { portOwners, aliases };
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

/** Does this `catch` let `ModuleDisabledError` through? */
function handles(clause: ts.CatchClause, sf: ts.SourceFile): boolean {
  const last = clause.block.statements.at(-1);
  if (last && ts.isThrowStatement(last)) return true;
  let named = false;
  const scan = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'rethrowIfModuleDisabled') named = true;
    if (ts.isIdentifier(node) && node.text === 'ModuleDisabledError') named = true;
    node.forEachChild(scan);
  };
  clause.block.forEachChild(scan);
  void sf;
  return named;
}

/** Every `try` in `src/**` whose body calls through a gated port. */
export function findPortCatches(input: PortCatchInput): PortCatch[] {
  const { portOwners, aliases } = analyze(input.sources);
  const found: PortCatch[] = [];

  for (const [file, text] of input.sources) {
    const moduleId = moduleOf(`/src/${file}`) ?? ROOT;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const readsAsPort = (name: string): boolean => {
      const scopes = aliases.get(name);
      if (scopes === undefined) return false;
      if (scopes.has(moduleId)) return true;
      // A port's own name, read anywhere but inside the module that owns it.
      return scopes.has(EVERYWHERE) && portOwners.get(name) !== moduleId;
    };

    const visit = (node: ts.Node): void => {
      if (ts.isTryStatement(node) && node.catchClause) {
        const ports = new Set<string>();
        const scan = (inner: ts.Node): void => {
          if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
            const receiver = tailName(inner.expression.expression);
            if (receiver !== null && readsAsPort(receiver)) ports.add(receiver);
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
          const handled = handles(node.catchClause, sf);
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
