/**
 * Codemod: `em.persistAndFlush(x)` → `em.persist(x).flush()` and
 * `em.removeAndFlush(x)` → `em.remove(x).flush()` (issue #1863, part of the
 * MikroORM 7 migration in #1073).
 *
 * ## Why it exists, and why it is a committed script rather than a one-off
 *
 * MikroORM 7 removes both methods. MikroORM 6 implements each of them as exactly
 * the chain this writes — `async persistAndFlush(e) { await this.persist(e).flush(); }`
 * in `@mikro-orm/core`'s `EntityManager` — so the rewrite is valid, and behaves
 * identically, on 6; landing it before the version switch keeps that switch
 * small. It is committed because it is run more than once: the pull request that
 * lands it is rebased by running it again over whatever merged in the meantime,
 * and an instance runs it over its own overlay code before it moves to a release
 * built on MikroORM 7.
 *
 * ## What it rewrites
 *
 *   * **Every call site**, on any receiver — `this.em`, `em.fork()`,
 *     `(await h.em())`, an alias, an optional chain — keeping `await`, the
 *     arguments (an array stays an array) and any type arguments as written.
 *     `persist` and `remove` return the manager they were called on, so the
 *     receiver is still evaluated once.
 *   * **Test doubles that stood in for the methods.** A double that answered
 *     `persistAndFlush(x)` must now answer `persist(x).flush()`, so it becomes a
 *     `persist(x)` returning an object whose `flush()` runs the original body
 *     with the same arguments: the same work, at the same moment (the `flush()`
 *     call), with the same result. An object-literal property, a class field, a
 *     method, and a `vi.fn(impl)` / `vi.fn()` are handled; for a `vi.fn` the mock
 *     moves to `persist`, so assertions reading the double (`expect(em.persistAndFlush)`,
 *     `.mock.calls`) are renamed with it — but only in a file where every double
 *     of that name was rewritten.
 *
 * ## What it refuses, and why it lists rather than guesses
 *
 * A double whose object already has `persist` (or `remove`), spreads another
 * object, or whose class extends another; a double assigned onto an object, a
 * shorthand property or a local of the name; a `vi.fn` configured by a chained
 * call; a spy; an element access; an optional call (`em.persistAndFlush?.(x)`
 * would turn into a `.flush()` on `undefined`); and a reference to the method in
 * a file that defines no double for it. Each is printed as `path:line:column`
 * with a reason, the file is left as it was at that site, and the run exits 1:
 * the right rewrite depends on what the double is for, which is a reviewer's
 * judgement and not a syntactic one. Comments and string data are not touched.
 *
 * ## Running it
 *
 *   pnpm --filter backend run codemod:persist-and-flush     # this repository
 *   node persist-and-flush.ts <dir-or-file>... [--dry-run]  # anywhere
 *
 * It imports nothing but `typescript` and Node's own modules and uses only
 * syntax Node's type stripping runs, so an instance can copy this one file into
 * its root and run it with `node` (Node ≥ 22.18). Exit 0: done, nothing left;
 * 1: sites listed for a hand edit; 2: it read no source file — a run that read
 * nothing has said nothing about the tree. Re-running over its own output
 * changes nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const PREFIX = '[persist-and-flush]';

/** The removed method → the method whose result is then flushed. */
const RENAMES: ReadonlyMap<string, string> = new Map([
  ['persistAndFlush', 'persist'],
  ['removeAndFlush', 'remove'],
]);

const MOCK_FACTORIES: ReadonlySet<string> = new Set(['vi.fn', 'jest.fn']);

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Directories that hold no source of the tree's own. Hidden directories are skipped too. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

export interface ManualSite {
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  readonly reason: string;
}

export interface FileRewrite {
  readonly text: string;
  /** Call sites, doubles and references rewritten. */
  readonly rewritten: number;
  /** Sites left as they were, for a hand edit. */
  readonly manual: readonly ManualSite[];
}

type Render = (start: number, end: number) => string;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly build: (render: Render) => string;
}

/** Text for a rewritten double, given how to render a range and the indentation of its line. */
type Builder = (render: Render, indent: string) => string;

type Placement =
  /** The double's object or class has no member of the target name. */
  | { readonly kind: 'add' }
  /** It has one that does nothing: the double replaces it, and the old name goes. */
  | { readonly kind: 'merge'; readonly noOp: ts.Node }
  | { readonly kind: 'refuse'; readonly reason: string };

function scriptKindOf(fileName: string): ts.ScriptKind {
  switch (extname(fileName)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function memberName(member: ts.Node): string | undefined {
  const name = (member as { name?: ts.Node }).name;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function containsNode(root: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (predicate(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Whether re-indenting the lines of `node` would change a string's content. */
function holdsMultiLineLiteral(node: ts.Node): boolean {
  return containsNode(
    node,
    (n) =>
      (ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n) ||
        ts.isStringLiteral(n)) &&
      n.getText().includes('\n'),
  );
}

/** Rewrite one source text. Pure: the caller decides whether to write the result. */
export function rewriteSource(text: string, fileName = 'input.ts'): FileRewrite {
  if (!/(?:persist|remove)AndFlush/.test(text)) return { text, rewritten: 0, manual: [] };

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const edits: Edit[] = [];
  const manual: Array<ManualSite & { readonly pos: number }> = [];
  let rewritten = 0;

  /** Per removed name: doubles rewritten, doubles refused. */
  const doubles = new Map<string, { rewritten: number; refused: number }>();
  const tally = (name: string) => {
    let entry = doubles.get(name);
    if (entry === undefined) {
      entry = { rewritten: 0, refused: 0 };
      doubles.set(name, entry);
    }
    return entry;
  };
  /** Renamed only once every double of that name in the file has been rewritten. */
  const references: Array<{ readonly node: ts.Identifier; readonly name: string }> = [];

  const refuse = (node: ts.Node, reason: string): void => {
    const pos = node.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    manual.push({ pos, line: line + 1, column: character + 1, reason });
  };

  const indentOf = (node: ts.Node): string => {
    const pos = node.getStart(sourceFile);
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
    return match === null ? '' : match[0];
  };

  /** Add `extra` to the indentation of every line after the first. */
  const reindent = (block: string, extra: string, verbatim: boolean): string =>
    verbatim ? block : block.replace(/\n(?=[^\n])/g, `\n${extra}`);

  const replace = (node: ts.Node, replacement: string): void => {
    edits.push({ start: node.getStart(sourceFile), end: node.end, build: () => replacement });
  };

  const parameterList = (fn: ts.SignatureDeclaration, render: Render): string => {
    const children = fn.getChildren(sourceFile);
    const open = children.find((c) => c.kind === ts.SyntaxKind.OpenParenToken);
    const close = children.find((c) => c.kind === ts.SyntaxKind.CloseParenToken);
    if (open !== undefined && close !== undefined) {
      return render(open.getStart(sourceFile), close.end);
    }
    // `async row => …`: one parameter and no parentheses.
    const only = fn.parameters[0];
    return only === undefined ? '()' : `(${render(only.getStart(sourceFile), only.end)})`;
  };

  /**
   * `async (row: R): T => body` → `(row: R) => ({ flush: async (): T => body })`.
   * `indent` is the indentation of the line the double is written on.
   */
  const wrapFunction = (fn: ts.Expression): Builder | undefined => {
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
    if (fn.typeParameters !== undefined && fn.typeParameters.length > 0) return undefined;
    if (ts.isFunctionExpression(fn)) {
      // An arrow would rebind `this` and `arguments`, and a named function
      // expression may call itself by its name.
      if (fn.asteriskToken !== undefined || fn.name !== undefined) return undefined;
      const rebinds = containsNode(
        fn.body,
        (n) =>
          n.kind === ts.SyntaxKind.ThisKeyword ||
          (ts.isIdentifier(n) && n.text === 'arguments'),
      );
      if (rebinds) return undefined;
    }
    const isAsync = hasModifier(fn, ts.SyntaxKind.AsyncKeyword);
    const verbatim = holdsMultiLineLiteral(fn.body);
    return (render, indent) => {
      const params = parameterList(fn, render);
      const returnType =
        fn.type === undefined ? '' : `: ${render(fn.type.getStart(sourceFile), fn.type.end)}`;
      const body = render(fn.body.getStart(sourceFile), fn.body.end);
      const flush = `${isAsync ? 'async ' : ''}()${returnType} => ${body}`;
      if (!flush.includes('\n')) return `${params} => ({ flush: ${flush} })`;
      return (
        `${params} => ({\n` +
        `${indent}  flush: ${reindent(flush, '  ', verbatim)},\n` +
        `${indent}})`
      );
    };
  };

  /** The replacement for a double's value, or `undefined` when it is not one this can wrap. */
  const wrapValue = (value: ts.Expression): Builder | undefined => {
    const direct = wrapFunction(value);
    if (direct !== undefined) return direct;
    if (!ts.isCallExpression(value) || value.typeArguments !== undefined) return undefined;
    const factory = value.expression.getText(sourceFile);
    if (!MOCK_FACTORIES.has(factory)) return undefined;
    if (value.arguments.length === 0) {
      return () => `${factory}(() => ({ flush: async () => undefined }))`;
    }
    const impl = value.arguments[0];
    if (value.arguments.length !== 1 || impl === undefined) return undefined;
    const inner = wrapFunction(impl);
    return inner === undefined
      ? undefined
      : (render, indent) => `${factory}(${inner(render, indent)})`;
  };

  /**
   * A member that does nothing: `persist: () => undefined`, `persist(): void {}`.
   * Replacing it with the rewritten double changes nothing a bare `persist(x)`
   * call observes, because nothing reads what it returned.
   */
  const isNoOp = (member: ts.Node): boolean => {
    const emptyBody = (body: ts.Node | undefined): boolean =>
      body !== undefined &&
      ((ts.isBlock(body) && body.statements.length === 0) ||
        (ts.isIdentifier(body) && body.text === 'undefined') ||
        (ts.isVoidExpression(body) && ts.isLiteralExpression(body.expression)));
    if (ts.isMethodDeclaration(member)) return emptyBody(member.body);
    if (ts.isPropertyAssignment(member)) {
      const value = member.initializer;
      return (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && emptyBody(value.body);
    }
    return false;
  };

  /** Where the rewritten double goes, given the object or class that holds it. */
  const placementOf = (
    member: ts.PropertyAssignment | ts.MethodDeclaration,
    target: string,
  ): Placement => {
    const container = member.parent;
    let siblings: readonly ts.Node[];
    if (ts.isObjectLiteralExpression(container)) {
      siblings = container.properties;
      if (container.properties.some((p) => ts.isSpreadAssignment(p))) {
        return {
          kind: 'refuse',
          reason: `the double's object spreads another object, which may already have \`${target}\``,
        };
      }
    } else if (ts.isClassLike(container)) {
      siblings = container.members;
      const extendsAnother = (container.heritageClauses ?? []).some(
        (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (extendsAnother) {
        return {
          kind: 'refuse',
          reason: `the double's class extends another, which may have \`${target}\``,
        };
      }
    } else {
      return { kind: 'refuse', reason: 'the double is not a member of an object literal or a class' };
    }
    const existing = siblings.filter((s) => s !== member && memberName(s) === target);
    if (existing.length === 0) return { kind: 'add' };
    const only = existing[0];
    if (existing.length === 1 && only !== undefined && isNoOp(only)) {
      return { kind: 'merge', noOp: only };
    }
    const holder = ts.isClassLike(container) ? 'class' : 'object';
    return {
      kind: 'refuse',
      reason:
        `the double's ${holder} already has a \`${target}\` that does something; ` +
        `make that one return ${holder === 'class' ? '`this`' : 'the object'} or an object with \`flush\``,
    };
  };

  /** Delete `member` and its separator from the object or class holding it. */
  const deletion = (member: ts.PropertyAssignment | ts.MethodDeclaration): Edit => {
    const container = member.parent;
    if (ts.isObjectLiteralExpression(container)) {
      const comma = /^[ \t]*,/.exec(text.slice(member.end));
      if (comma !== null) {
        return { start: member.getFullStart(), end: member.end + comma[0].length, build: () => '' };
      }
      const at = container.properties.indexOf(member as ts.ObjectLiteralElementLike);
      const previous = container.properties[at - 1];
      if (previous !== undefined) return { start: previous.end, end: member.end, build: () => '' };
    }
    return { start: member.getFullStart(), end: member.end, build: () => '' };
  };

  /** Put a rewritten double where `placement` says, or refuse it. */
  const place = (
    member: ts.PropertyAssignment | ts.MethodDeclaration,
    name: ts.Identifier | ts.StringLiteral,
    legacy: string,
    builder: Builder | undefined,
    placement: Placement,
    unwrappable: string,
  ): void => {
    const entry = tally(legacy);
    if (placement.kind === 'refuse' || builder === undefined) {
      entry.refused += 1;
      refuse(name, placement.kind === 'refuse' ? placement.reason : unwrappable);
      return;
    }
    entry.rewritten += 1;
    rewritten += 1;
    const at = placement.kind === 'merge' ? placement.noOp : member;
    edits.push({
      start: at.getStart(sourceFile),
      end: at.end,
      build: (render) => builder(render, indentOf(at)),
    });
    if (placement.kind === 'merge') edits.push(deletion(member));
  };

  const quoted = (name: ts.Identifier | ts.StringLiteral, target: string): string => {
    const quote = ts.isStringLiteral(name) ? name.getText(sourceFile).charAt(0) : '';
    return `${quote}${target}${quote}`;
  };

  /** `persistAndFlush: value` in an object literal. */
  const rewriteProperty = (
    member: ts.PropertyAssignment,
    name: ts.Identifier | ts.StringLiteral,
    legacy: string,
    target: string,
  ): void => {
    const wrapped = wrapValue(member.initializer);
    const builder: Builder | undefined =
      wrapped === undefined
        ? undefined
        : (render, indent) => `${quoted(name, target)}: ${wrapped(render, indent)}`;
    place(
      member,
      name,
      legacy,
      builder,
      placementOf(member, target),
      `the double's value is not a function or a \`vi.fn(…)\` this can wrap; give it a \`${target}\` returning an object with \`flush\``,
    );
  };

  /** `persistAndFlush = value` as a class field: renamed in place, never merged. */
  const rewriteField = (
    member: ts.PropertyDeclaration,
    name: ts.Identifier | ts.StringLiteral,
    legacy: string,
    target: string,
  ): void => {
    const entry = tally(legacy);
    const container = member.parent;
    const clash =
      !ts.isClassLike(container) ||
      (container.heritageClauses ?? []).some((h) => h.token === ts.SyntaxKind.ExtendsKeyword) ||
      container.members.some((m) => m !== member && memberName(m) === target);
    const value = member.initializer;
    const wrapped = value === undefined ? undefined : wrapValue(value);
    if (clash || value === undefined || wrapped === undefined) {
      entry.refused += 1;
      refuse(
        name,
        `the double is a class field this does not rewrite; give the class a \`${target}\` returning an object with \`flush\``,
      );
      return;
    }
    entry.rewritten += 1;
    rewritten += 1;
    replace(name, quoted(name, target));
    edits.push({
      start: value.getStart(sourceFile),
      end: value.end,
      build: (render) => wrapped(render, indentOf(member)),
    });
  };

  /** `async persistAndFlush(row) { … }` in an object literal or a class. */
  const rewriteMethod = (
    member: ts.MethodDeclaration,
    name: ts.Identifier | ts.StringLiteral,
    legacy: string,
    target: string,
  ): void => {
    const body = member.body;
    const decorated = ts.canHaveDecorators(member) && (ts.getDecorators(member) ?? []).length > 0;
    const plain =
      body !== undefined &&
      member.asteriskToken === undefined &&
      member.questionToken === undefined &&
      !decorated &&
      (member.typeParameters === undefined || member.typeParameters.length === 0) &&
      !containsNode(body, (n) => ts.isIdentifier(n) && n.text === 'arguments');
    let builder: Builder | undefined;
    if (plain) {
      const isAsync = hasModifier(member, ts.SyntaxKind.AsyncKeyword);
      const modifiers = (ts.getModifiers(member) ?? [])
        .filter((m) => m.kind !== ts.SyntaxKind.AsyncKeyword)
        .map((m) => m.getText(sourceFile));
      const verbatim = holdsMultiLineLiteral(body);
      builder = (render, indent) => {
        const head = [...modifiers, quoted(name, target)].join(' ');
        const params = parameterList(member, render);
        const returnType =
          member.type === undefined
            ? ''
            : `: ${render(member.type.getStart(sourceFile), member.type.end)}`;
        const flush = `${isAsync ? 'async ' : ''}()${returnType} => ${render(body.getStart(sourceFile), body.end)}`;
        if (!flush.includes('\n')) return `${head}${params} { return { flush: ${flush} }; }`;
        return (
          `${head}${params} {\n` +
          `${indent}  return {\n` +
          `${indent}    flush: ${reindent(flush, '    ', verbatim)},\n` +
          `${indent}  };\n` +
          `${indent}}`
        );
      };
    }
    place(
      member,
      name,
      legacy,
      builder,
      placementOf(member, target),
      `the double's method has a shape this does not rewrite; give it a \`${target}\` returning an object with \`flush\``,
    );
  };

  const visitName = (node: ts.Identifier | ts.StringLiteral, legacy: string, target: string) => {
    const parent = node.parent;

    if (ts.isStringLiteral(node)) {
      if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) {
        refuse(node, `an element access to \`${legacy}\`; write \`.${target}(…).flush()\``);
      } else if (
        ts.isCallExpression(parent) &&
        /(?:^|\.)spyOn$/.test(parent.expression.getText(sourceFile))
      ) {
        refuse(node, `a spy on \`${legacy}\`; spy on \`${target}\` or \`flush\` instead`);
      } else if (ts.isPropertyAssignment(parent) && parent.name === node) {
        rewriteProperty(parent, node, legacy, target);
      } else if (ts.isMethodDeclaration(parent) && parent.name === node) {
        rewriteMethod(parent, node, legacy, target);
      }
      // Any other string is data — an operation label, a rule's vocabulary.
      return;
    }

    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      const grand = parent.parent;
      if (ts.isCallExpression(grand) && grand.expression === parent) {
        if (grand.questionDotToken !== undefined) {
          refuse(node, `an optional call of \`${legacy}\`; \`.flush()\` would run on \`undefined\``);
          return;
        }
        rewritten += 1;
        replace(node, target);
        edits.push({ start: grand.end, end: grand.end, build: () => '.flush()' });
        return;
      }
      if (
        ts.isBinaryExpression(grand) &&
        grand.left === parent &&
        grand.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        tally(legacy).refused += 1;
        refuse(node, `a double assigned onto an object; give it a \`${target}\` returning an object with \`flush\``);
        return;
      }
      references.push({ node, name: legacy });
      return;
    }
    if (ts.isPropertyAssignment(parent) && parent.name === node) {
      rewriteProperty(parent, node, legacy, target);
      return;
    }
    if (ts.isPropertyDeclaration(parent) && parent.name === node) {
      rewriteField(parent, node, legacy, target);
      return;
    }
    if (ts.isMethodDeclaration(parent) && parent.name === node) {
      rewriteMethod(parent, node, legacy, target);
      return;
    }
    if (ts.isPropertySignature(parent) && parent.name === node) {
      if (parent.type !== undefined && ts.isFunctionTypeNode(parent.type)) {
        refuse(node, `a type member declaring \`${legacy}\` as a function; retype it as \`${target}\``);
        return;
      }
      references.push({ node, name: legacy });
      return;
    }
    if (ts.isShorthandPropertyAssignment(parent)) {
      tally(legacy).refused += 1;
      refuse(node, `a shorthand property \`{ ${legacy} }\`; give the object a \`${target}\` returning an object with \`flush\``);
      return;
    }
    if (ts.isMethodSignature(parent)) {
      refuse(node, `a method signature \`${legacy}(…)\`; retype it as \`${target}\``);
      return;
    }
    refuse(node, `a declaration or binding named \`${legacy}\`; rewrite it by hand`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
      const target = RENAMES.get(node.text);
      if (target !== undefined) visitName(node, node.text, target);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const { node, name } of references) {
    const entry = doubles.get(name);
    const target = RENAMES.get(name);
    if (target !== undefined && entry !== undefined && entry.rewritten > 0 && entry.refused === 0) {
      rewritten += 1;
      replace(node, target);
    } else {
      refuse(
        node,
        `a reference to \`${name}\` that is not a call, in a file with no double of it this rewrote; rewrite it by hand`,
      );
    }
  }

  manual.sort((a, b) => a.pos - b.pos);
  const out = applyEdits(text, edits);

  // A rewrite that introduced a syntax error is a defect of this codemod and
  // must not reach a file. Compare against the input, which may carry its own.
  const syntaxErrors = (source: string): number =>
    ts.transpileModule(source, { fileName, reportDiagnostics: true }).diagnostics?.length ?? 0;
  if (out !== text && syntaxErrors(out) > syntaxErrors(text)) {
    throw new Error(`${PREFIX} the rewrite of ${fileName} does not parse; refusing to write it`);
  }

  return {
    text: out,
    rewritten,
    manual: manual.map(({ line, column, reason }) => ({ line, column, reason })),
  };
}

/**
 * Apply `edits` to `text`. An edit inside another (a call site inside a double's
 * body) is applied by the outer one's `render`, never on its own.
 */
function applyEdits(text: string, edits: readonly Edit[]): string {
  const within = (start: number, end: number, outer?: Edit): Edit[] => {
    const inside = edits.filter((e) => e !== outer && start <= e.start && e.end <= end);
    const contains = (a: Edit, b: Edit): boolean =>
      a !== b && a.start <= b.start && b.end <= a.end && a.end - a.start > b.end - b.start;
    return inside
      .filter((e) => !inside.some((o) => contains(o, e)))
      .sort((a, b) => a.start - b.start);
  };
  const render = (start: number, end: number, outer?: Edit): string => {
    let out = '';
    let cursor = start;
    for (const edit of within(start, end, outer)) {
      if (edit.start < cursor) {
        throw new Error(`${PREFIX} overlapping edits at ${edit.start}; this is a codemod defect`);
      }
      out += text.slice(cursor, edit.start);
      out += edit.build((s, e) => render(s, e, edit));
      cursor = edit.end;
    }
    return out + text.slice(cursor, end);
  };
  return render(0, text.length);
}

/** Every source file under `paths`, skipping dependencies, build output, hidden directories and nested checkouts. */
export function collectFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  const isSource = (path: string): boolean =>
    SOURCE_EXTENSIONS.has(extname(path)) && !/\.d\.[cm]?ts$/.test(path);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = statSync(full, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory()) {
        if (name.startsWith('.') || SKIPPED_DIRECTORIES.has(name)) continue;
        // Another checkout's tree is another branch's source, not this one's.
        if (existsSync(join(full, '.git'))) continue;
        walk(full);
      } else if (stat.isFile() && isSource(name)) {
        out.push(full);
      }
    }
  };
  for (const path of paths) {
    const full = resolve(path);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isDirectory()) walk(full);
    else if (stat.isFile() && isSource(full)) out.push(full);
  }
  return out;
}

export interface RunOptions {
  readonly paths: readonly string[];
  /** `false` is `--dry-run`: report what would change, write nothing. */
  readonly write: boolean;
  readonly log: (line: string) => void;
}

/** The whole run. Returns the exit code. */
export function runCodemod(options: RunOptions): number {
  const { paths, write, log } = options;
  const missing = paths.filter((p) => !existsSync(resolve(p)));
  for (const path of missing) log(`${PREFIX} no such file or directory: ${path}`);

  const files = collectFiles(paths);
  let sites = 0;
  let rewrittenSites = 0;
  let changedFiles = 0;
  const left: string[] = [];
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const result = rewriteSource(before, file);
    sites += result.rewritten + result.manual.length;
    rewrittenSites += result.rewritten;
    for (const site of result.manual) left.push(`  ${file}:${site.line}:${site.column}  ${site.reason}`);
    if (result.text !== before) {
      changedFiles += 1;
      if (write) writeFileSync(file, result.text);
    }
  }

  log(`${PREFIX} read: files=${files.length} sites=${sites}`);
  if (files.length === 0 || missing.length > 0) {
    log(`${PREFIX} read no source file under the given paths — refusing to report a clean tree`);
    return 2;
  }
  log(
    `${PREFIX} ${write ? 'rewrote' : 'would rewrite'} ${rewrittenSites} site(s) in ${changedFiles} file(s)`,
  );
  if (left.length > 0) {
    log(`${PREFIX} left for a hand edit: ${left.length}`);
    for (const line of left) log(line);
    return 1;
  }
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: persist-and-flush <dir-or-file>... [--dry-run]');
    return 0;
  }
  const unknown = argv.filter((a) => a.startsWith('-') && a !== '--dry-run');
  if (unknown.length > 0) {
    console.error(`${PREFIX} unknown option(s): ${unknown.join(' ')}`);
    return 2;
  }
  const paths = argv.filter((a) => !a.startsWith('-'));
  if (paths.length === 0) {
    console.error(`${PREFIX} name at least one directory or file to rewrite`);
    return 2;
  }
  return runCodemod({ paths, write: !argv.includes('--dry-run'), log: (l) => console.log(l) });
}

// CLI only — importing this module (the unit test does) must not rewrite anything.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
