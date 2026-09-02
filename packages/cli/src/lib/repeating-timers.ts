/**
 * The one recognizer for "this file starts a repeating execution of its own"
 * (issue #128).
 *
 * Two checks ask that question and used to answer it separately.
 * `check-entry-presence.ts` reads the callback and knows a repeating timer is
 * not only a `setInterval`: a `setTimeout` whose callback re-arms a timer is the
 * same entry point wearing a different constructor. `check-entry-scope.ts`
 * grepped for `setInterval(` — so `search`'s reindex loop, which is exactly that
 * `setTimeout`, was never in its population, and the `interval=4` it printed
 * every run read as a settled count rather than as one spelling's worth of
 * coverage.
 *
 * The fix is a shared recognizer rather than a second one. Lending only the last
 * predicate (`isSelfRescheduling`) would have left the caller to re-implement the
 * parse, the callback binding and the enclosing-function name — most of the
 * recognizer — and those are precisely the parts that drift. So the whole shape
 * lives here and both checks consume it; neither owns it.
 *
 * What this deliberately does **not** decide: what to do about a site it finds.
 * `check-entry-presence` asks whether the callback decides presence,
 * `check-entry-scope` whether the file opens a scope. The shapes are shared, the
 * rules are not.
 *
 * ## Limits, and why they are the same for both callers
 *
 *   - A one-shot `setTimeout` — an `AbortController` deadline, a sleep between
 *     retries — is not a repeating entry point and is not reported.
 *   - A callback that is an identifier bound in another file cannot be read, so
 *     a `setTimeout` reached that way is invisible. A `setInterval` is reported
 *     anyway, with a null callback: it repeats whatever its callback turns out to
 *     be, and what a check cannot see it must not vouch for.
 *   - A scheduler hidden behind an imported helper is invisible. The analysis is
 *     single-file and syntactic; if that shape arrives, this module has to grow.
 */
import ts from 'typescript';

/** The scheduling call a site was built from. */
export type RepeatingTimerConstruct = 'setInterval' | 'setTimeout';

export interface RepeatingTimerSite {
  readonly construct: RepeatingTimerConstruct;
  /** The scheduling call itself, for reporting a position. */
  readonly call: ts.CallExpression;
  /**
   * The callback body, or `null` when the argument could not be bound to a
   * function in this file. Only a `setInterval` site can carry `null`.
   */
  readonly callback: ts.Node | null;
  /** 1-based line of the scheduling call. */
  readonly line: number;
  /** The nearest enclosing named function, or `<module scope>`. */
  readonly scheduler: string;
}

export const MODULE_SCOPE = '<module scope>';

/** Parse with parent pointers — every predicate below walks upwards. */
export function parseScript(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** The trailing identifier of a callee: `globalThis.setInterval` → `setInterval`. */
export function calleeName(node: ts.CallExpression): string | null {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** The receiver of a call, as its trailing identifier: `process.on` → `process`. */
export function receiverName(node: ts.CallExpression): string | null {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const receiver = expression.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (ts.isPropertyAccessExpression(receiver)) return receiver.name.text;
  return null;
}

export function stringLiteralOf(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return stringLiteralOf(node.expression);
  }
  return null;
}

export type FunctionLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

/** File-local `function f(){}` / `const f = () => {}` bindings, by name. */
export function localFunctions(sf: ts.SourceFile): Map<string, FunctionLike> {
  const bindings = new Map<string, FunctionLike>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      bindings.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bindings;
}

/** The nearest named function around `node`, for the ledger key. */
export function enclosingName(node: ts.Node): string | null {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (ts.isMethodDeclaration(cursor) && ts.isIdentifier(cursor.name)) return cursor.name.text;
    // `{ plugin: async (app) => { … } }` — the shape every module's plugin body
    // has, and the name a reader would use for it.
    if (
      ts.isPropertyAssignment(cursor) &&
      ts.isIdentifier(cursor.name) &&
      isFunctionLike(cursor.initializer)
    ) {
      return cursor.name.text;
    }
    if (
      ts.isVariableDeclaration(cursor) &&
      ts.isIdentifier(cursor.name) &&
      cursor.initializer &&
      isFunctionLike(cursor.initializer)
    ) {
      return cursor.name.text;
    }
  }
  return null;
}

/** True when the subtree contains a call to one of `names` (as identifier or tail). */
export function callsAnyOf(root: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && names.has(name)) {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  root.forEachChild(visit);
  return found;
}

const TIMER_CALLS = new Set(['setInterval', 'setTimeout']);

/**
 * A `setTimeout` repeats only when its callback re-arms a timer itself, or calls
 * back into the function that armed this one. That is the single shape a one-shot
 * deadline cannot accidentally match.
 */
export function isSelfRescheduling(callback: ts.Node, armedBy: string | null): boolean {
  if (callsAnyOf(callback, TIMER_CALLS)) return true;
  if (armedBy === null) return false;
  return callsAnyOf(callback, new Set([armedBy]));
}

/** Resolve a callback argument to a function body in this file, if we can read one. */
export function callbackOf(
  argument: ts.Node | undefined,
  bindings: ReadonlyMap<string, FunctionLike>,
): ts.Node | null {
  if (argument === undefined) return null;
  if (isFunctionLike(argument)) return argument;
  if (ts.isIdentifier(argument)) return bindings.get(argument.text) ?? null;
  return null;
}

/** Every repeating-timer entry point in one parsed file, in source order. */
export function findRepeatingTimerSites(sf: ts.SourceFile): RepeatingTimerSite[] {
  const bindings = localFunctions(sf);
  const sites: RepeatingTimerSite[] = [];

  const record = (
    call: ts.CallExpression,
    construct: RepeatingTimerConstruct,
    callback: ts.Node | null,
  ): void => {
    sites.push({
      construct,
      call,
      callback,
      line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1,
      scheduler: enclosingName(call) ?? MODULE_SCOPE,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'setInterval' || name === 'setTimeout') {
        const callback = callbackOf(node.arguments[0], bindings);
        if (name === 'setInterval') {
          record(node, 'setInterval', callback);
        } else if (callback !== null && isSelfRescheduling(callback, enclosingName(node))) {
          record(node, 'setTimeout', callback);
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return sites;
}
