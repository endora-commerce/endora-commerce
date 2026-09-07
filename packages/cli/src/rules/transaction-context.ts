/**
 * CI check — SQL written inside a transaction runs inside that transaction
 * (issue #200).
 *
 * `SqlEntityManager.getKnex()` is `getConnection().getKnex()`, and a connection
 * is not a transaction: the handle it returns takes its own pooled connection
 * and knows nothing about the EntityManager's active transaction. So does
 * `getConnection().execute(sql, params)` when it is not handed a transaction
 * context as its fourth argument. Either one, written inside
 * `em.transactional(...)`, **commits the moment it runs** — the enclosing
 * rollback cannot reach it, and a read cannot see what the transaction has
 * written.
 *
 * That is not a theoretical hazard. `PromotionUsageService.finalize` said in its
 * own doc comment that its counter increments had to be co-transactional with
 * order placement and issued them through `em.getKnex()`, so a usage cap hit
 * rolled the order back and left the counter incremented and a redemption row
 * pointing at an order that never existed (D-94). The sweep that produced this
 * check found the same mechanism in sixty-five more places — fifty-one of them
 * writes — none of them suspected: `BlogCategoryService.create` left a category with no channel scope
 * behind a failed create, `CmsPageService.create` left a page, and
 * `MegamenuItemService.setTree` — a delete-then-insert whose doc comment says
 * "in one transaction" — **wiped an operator's whole menu** when the re-insert
 * was refused.
 *
 * ## What is decidable, and what this check therefore looks at
 *
 * Whether an arbitrary method runs inside a transaction is a question about its
 * callers, and not decidable here: services take an `em` that may or may not
 * have one open. What *is* decidable is the lexical case — SQL written inside a
 * scope that opens the transaction itself — and that is the whole population:
 *
 *   1. **`transactional-callback`** — the body of `<em>.transactional(cb)`.
 *   2. **`command-run`** — the `run` of a Command literal (one that also carries
 *      an `action`). `CommandBus.run` executes it inside `scoped.transactional`
 *      (Principle XIII), so the transaction is as certain there as in (1).
 *
 * A guard reached one hop away — `this.replaceChannelScope(tx, …)` — is outside
 * the population by construction, and deliberately: the check would have to
 * guess at call sites to see it, and guessing is what gets a check switched off.
 * The remedy does not need the check to see it, either, because it is safe
 * everywhere: `em.execute(sql, params)` passes the EntityManager's transaction
 * context when there is one and behaves exactly like the connection-level call
 * when there is not.
 *
 * ## The two shapes refused
 *
 *   - **`knex-instance`** — a `getKnex()` call, whatever the receiver. The
 *     predicate is shared with `check-module-boundary`'s builder path
 *     (`lib/sql-tables.ts`), so the two cannot drift over what a knex handle
 *     looks like.
 *   - **`connection-execute`** — an `execute(...)` whose receiver reaches
 *     `getConnection()`, directly or through a `const conn = …` binding in the
 *     same file, with fewer than four arguments. The fourth argument is the
 *     transaction context, and passing it is the house pattern
 *     (`sales-channel-membership.service.ts`); an `execute` that has it is not a
 *     finding.
 *
 * `em.execute(...)` is not in the population at all: the EntityManager's own
 * `execute` fills the context in for you, which is why it is the recommended
 * repair.
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). `backend/scripts/check-transaction-context.ts` hosts it over this
 * repository's module walk roots and its ledger; `endora check` hosts it over
 * one module package's declared source layer. Neither host re-derives the
 * other's population, and neither holds a second copy of the predicate.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { isGetKnexCall, sqlTableAccesses } from '../lib/sql-tables.js';

/** Which lexical scope guarantees a transaction around the finding. */
export type TransactionScope = 'transactional-callback' | 'command-run';

/** Why the statement cannot see the transaction it is written inside. */
export type EscapeShape = 'knex-instance' | 'connection-execute';

export interface TransactionEscape {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly scope: TransactionScope;
  readonly shape: EscapeShape;
  /** `write` when the statement on that line moves rows, per `lib/sql-tables.ts`. */
  readonly direction: 'read' | 'write' | 'unknown';
  /** The statement head, or the expression, for the message and the ledger key. */
  readonly statement: string;
}

/** `<file>#<shape>#<statement>` — the ledger key, and the identity of a site. */
export function keyOf(found: TransactionEscape): string {
  return `${found.file}#${found.shape}#${found.statement}`;
}

export interface TransactionContextInput {
  /** Every source under `src/`, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
}

/**
 * Every TypeScript source under `dir`, with the rule's own prunes applied.
 *
 * Exported because the population is part of the rule, not part of a host: two
 * hosts computing "which files this check reads" two ways is the shape that
 * lets one of them go half-blind.
 */
export function collectTransactionSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectTransactionSources(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The identifiers a file binds to a `getConnection()` result. */
function connectionBindings(sf: ts.SourceFile): Set<string> {
  const bound = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isGetConnectionCall(node.initializer)
    ) {
      bound.add(node.name.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bound;
}

function isGetConnectionCall(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'getConnection'
  );
}

/**
 * Whether the receiver of an `execute` is a connection.
 *
 * Two ways to be one, and both have to be read: the call chain names
 * `getConnection()` itself (`tx.getConnection().execute(…)`), or it is an
 * identifier the file bound to one (`const conn = tx.getConnection()`), which is
 * how thirty-nine of the sites in the D-94 sweep were written.
 */
function receiverIsConnection(expression: ts.Expression, bindings: ReadonlySet<string>): boolean {
  let current: ts.Node = expression;
  for (;;) {
    if (ts.isCallExpression(current)) {
      if (isGetConnectionCall(current as ts.Expression)) return true;
      current = current.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return ts.isIdentifier(current) && bindings.has(current.text);
  }
}

/** The SQL a call's first argument spells out, as far as it is literal. */
function statementText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ? ');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${statementText(node.left) ?? ''}${statementText(node.right) ?? ''}`;
  }
  return null;
}

/** One line of SQL, collapsed, for a message and a stable ledger key. */
function head(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 70);
}

/**
 * A Command literal's `run`.
 *
 * `action` has to be there too: `run` on its own is a common enough property
 * name (a worker's `run`, a script's `run`) and only the Command shape carries
 * the Command Bus' transaction with it.
 */
function commandRunBody(node: ts.Node): ts.Node | null {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const named = (name: string): ts.PropertyAssignment | undefined =>
    node.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === name,
    );
  if (named('action') === undefined) return null;
  const run = named('run');
  if (run === undefined) return null;
  if (!ts.isArrowFunction(run.initializer) && !ts.isFunctionExpression(run.initializer)) return null;
  return run.initializer.body;
}

/** The body of an `<em>.transactional(cb)` call. */
function transactionalCallbackBody(node: ts.Node): ts.Node | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.expression.name.text !== 'transactional') return null;
  const [callback] = node.arguments;
  if (callback === undefined) return null;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
  return callback.body;
}

/** Every statement written inside a transaction that does not run inside it. */
export function findTransactionEscapes(input: TransactionContextInput): TransactionEscape[] {
  const found: TransactionEscape[] = [];

  for (const [file, text] of input.sources) {
    if (!text.includes('transactional(') && !text.includes('run:')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = connectionBindings(sf);
    // The direction of the statement on a line, from the predicate
    // `check-module-boundary` reads tables with — so "write" means here what it
    // means there, rather than a second opinion maintained next to it.
    const writeLines = new Set(
      sqlTableAccesses(text, file)
        .filter((access) => access.direction === 'write')
        .map((access) => access.line),
    );
    const readLines = new Set(
      sqlTableAccesses(text, file)
        .filter((access) => access.direction === 'read')
        .map((access) => access.line),
    );

    const inspect = (body: ts.Node, scope: TransactionScope): void => {
      const visit = (node: ts.Node): void => {
        // A nested transactional callback or Command literal is the same scope
        // for this purpose, so recursion into it needs no special case.
        if (ts.isCallExpression(node) && isGetKnexCall(node)) {
          found.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            scope,
            shape: 'knex-instance',
            direction: 'unknown',
            statement: head(node.getText(sf)),
          });
        } else if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'execute' &&
          node.arguments.length < 4 &&
          receiverIsConnection(node.expression.expression, bindings)
        ) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const argument = node.arguments[0];
          const sql = statementText(argument);
          // The direction is looked up by the **literal's** line, not the
          // call's: `await em\n  .getConnection()\n  .execute(\n    'select …'`
          // puts four lines between them, and keying on the call's line reported
          // every one of those as `unknown`.
          const sqlLine =
            argument === undefined
              ? line
              : sf.getLineAndCharacterOfPosition(argument.getStart(sf)).line + 1;
          found.push({
            file,
            line,
            scope,
            shape: 'connection-execute',
            direction: writeLines.has(sqlLine)
              ? 'write'
              : readLines.has(sqlLine)
                ? 'read'
                : 'unknown',
            statement: sql === null ? head(node.getText(sf)) : head(sql),
          });
        }
        node.forEachChild(visit);
      };
      body.forEachChild(visit);
    };

    const visitTop = (node: ts.Node): void => {
      const transactional = transactionalCallbackBody(node);
      if (transactional !== null) inspect(transactional, 'transactional-callback');
      const commandRun = commandRunBody(node);
      if (commandRun !== null) inspect(commandRun, 'command-run');
      node.forEachChild(visitTop);
    };
    sf.forEachChild(visitTop);
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

export interface CheckResult {
  readonly total: number;
  readonly violations: readonly TransactionEscape[];
  readonly ledgered: readonly TransactionEscape[];
  /** Ledger keys that no longer describe an escape — the staleness half. */
  readonly stale: readonly string[];
}

export function checkTransactionContext(
  input: TransactionContextInput,
  ledger: Readonly<Record<string, string>>,
): CheckResult {
  const all = findTransactionEscapes(input);
  const keys = new Set(all.map(keyOf));
  return {
    total: all.length,
    violations: all.filter((entry) => ledger[keyOf(entry)] === undefined),
    ledgered: all.filter((entry) => ledger[keyOf(entry)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}
