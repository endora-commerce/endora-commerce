import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';

/**
 * Every library package declares `sideEffects`, so a bundler can tree-shake
 * the barrels it is consumed through (issue #175).
 *
 * ## The defect this was written from
 *
 * `@endora-commerce/admin-kit` is consumed through four barrels (`./ui`,
 * `./components`, `./lib`, `./i18n`) and declared no `sideEffects`. Rollup
 * then has to assume every re-exported file may do something at import time,
 * and keeps it: on `master` at 183445710 the admin entry chunk was 2454.5 kB
 * and held all of `echarts` and `zrender` (2984 kB rendered), reached only
 * through the `./components` barrel. The module packages, `platform` and
 * `page-builder-core` all declared the field; nothing stopped one from going
 * missing, because the bundle stays correct either way and only gets bigger.
 *
 * ## What this holds
 *
 * 1. Every library-family member declares `sideEffects` as `false` or as a
 *    non-empty array, unless it is in {@link UNDECLARED}. That list can only
 *    shrink: an entry whose package has declared the field fails.
 * 2. Every pattern in an array declaration matches a file the package ships.
 *    A typo there silently means `false` for the file it was meant to protect.
 * 3. For the packages in {@link AUDITED}, the import-time audit #175 did by
 *    hand is done mechanically. A source file must not hold a bare import or a
 *    top-level statement that runs code, apart from shapes known to be pure.
 *    If a new registration is added, this test fails, and whoever added it
 *    has to list the file in `sideEffects` rather than have the bundler drop
 *    it from the build.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

/**
 * Members that do not declare the field, and why. Node-only tooling is never
 * bundled for a browser. The browser-bundled ones are debt tracked by #595.
 */
const UNDECLARED: Readonly<Record<string, string>> = {
  '@endora-commerce/cli': 'node-only CLI, never bundled',
  'create-endora-commerce': 'node-only scaffolder, never bundled',
  '@endora-commerce/test-kit': 'test-only harness, never bundled',
  '@endora-commerce/demo-composition': 'backend install-time wiring, never bundled',
  '@endora-commerce/contracts': 'browser-bundled — #595',
  '@endora-commerce/cms-components': 'browser-bundled — #595',
  '@endora-commerce/email-components': 'browser-bundled — #595',
  '@endora-commerce/page-builder-admin': 'browser-bundled — #595',
};

/** The packages whose sources are held to the import-time audit, and their declared value. */
const AUDITED: Readonly<Record<string, readonly string[] | false>> = {
  '@endora-commerce/admin-kit': ['*.css'],
  '@endora-commerce/admin-shell': ['*.css'],
};

/**
 * Top-level initialiser calls known to run nothing observable at import time
 * (each one builds and returns a value). Matched against the callee's source
 * text.
 */
const PURE_CALLEES: ReadonlySet<string> = new Set([
  'createContext',
  'forwardRef',
  'memo',
  'cva',
  'createApiClient',
  'Node.create',
  // A table lookup; its one other effect is a `console.warn` in dev builds.
  'resolveIcon',
]);
/** Array methods that build a new value from a literal list (their callbacks are not entered). */
const PURE_ARRAY_METHODS: ReadonlySet<string> = new Set(['map', 'filter', 'join', 'flatMap', 'concat', 'slice']);
/** Constructors equally pure at the top level. */
const PURE_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'RegExp',
]);

interface Member {
  readonly dir: string;
  readonly name: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

function family(): readonly Member[] {
  return classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members.filter(
    (member) => member.family,
  );
}

function memberNamed(name: string): Member {
  const found = family().find((member) => member.name === name);
  if (found === undefined) throw new Error(`no workspace member named ${name}`);
  return found;
}

function isDeclared(value: unknown): boolean {
  return (
    value === false ||
    (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string'))
  );
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

function walk(dir: string, accept: (path: string) => boolean): string[] {
  const found: string[] = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, accept));
    else if (accept(path)) found.push(path);
  }
  return found;
}

/**
 * The files a package ships, relative to its root: its `files` entries, with
 * `dist/` stood in for by `src/` (which `dist` is compiled from, file for file)
 * so this test does not depend on a build having run.
 */
function shippedFiles(member: Member): readonly string[] {
  const entries = (member.manifest['files'] as readonly string[] | undefined) ?? [];
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(member.dir, entry === 'dist' ? 'src' : entry);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const file of walk(path, () => true)) {
        const rel = posix(relative(member.dir, file));
        out.push(entry === 'dist' ? rel.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '.js') : rel);
      }
    } else {
      out.push(posix(entry));
    }
  }
  return out;
}

/**
 * The bundler's reading of a `sideEffects` pattern: one without a `/` matches a
 * basename at any depth (webpack's rule, which Vite follows by prefixing `**\/`).
 */
function patternMatches(pattern: string, file: string): boolean {
  const glob = pattern.includes('/') ? pattern.replace(/^\.\//, '') : `**/${pattern}`;
  const source = glob
    .split('**/')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('(?:.*/)?');
  return new RegExp(`^${source}$`).test(file);
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Calls inside `node` that run at evaluation time (function bodies are skipped). */
function eagerCalls(node: ts.Node, found: ts.Node[]): void {
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
    found.push(node);
  }
  ts.forEachChild(node, (child) => eagerCalls(child, found));
}

function isPureCall(node: ts.Node, source: ts.SourceFile): boolean {
  if (ts.isNewExpression(node)) {
    return PURE_CONSTRUCTORS.has(node.expression.getText(source));
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    if (PURE_CALLEES.has(callee.getText(source))) return true;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    // `/re/.test(value)` — reads, writes nothing.
    if (callee.name.text === 'test' && ts.isRegularExpressionLiteral(callee.expression)) return true;
    return PURE_ARRAY_METHODS.has(callee.name.text);
  }
  return false;
}

/** Every import-time effect in one source file, as `file:line kind text`. */
function importTimeEffects(file: string, label: string, text: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const effects: string[] = [];
  const report = (node: ts.Node, kind: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    effects.push(`${label}:${line + 1} ${kind}: ${node.getText(source).slice(0, 80).replace(/\s+/g, ' ')}`);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause === undefined) report(statement, 'bare import');
      continue;
    }
    if (
      ts.isExportDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    ) {
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isClassStaticBlockDeclaration(member)) report(member, 'static block');
        if (
          ts.isPropertyDeclaration(member) &&
          member.initializer !== undefined &&
          (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
        ) {
          const calls: ts.Node[] = [];
          eagerCalls(member.initializer, calls);
          for (const call of calls) if (!isPureCall(call, source)) report(call, 'static initialiser call');
        }
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer === undefined) continue;
        const calls: ts.Node[] = [];
        eagerCalls(declaration.initializer, calls);
        for (const call of calls) if (!isPureCall(call, source)) report(call, 'initialiser call');
      }
      continue;
    }
    if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      // `Component.displayName = '…'` names a value this file owns; it is
      // dropped together with that value and touches nothing global.
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expression.left) &&
        expression.left.name.text === 'displayName' &&
        ts.isIdentifier(expression.left.expression)
      ) {
        continue;
      }
    }
    if (ts.isExportAssignment(statement)) {
      const calls: ts.Node[] = [];
      eagerCalls(statement.expression, calls);
      for (const call of calls) if (!isPureCall(call, source)) report(call, 'export default call');
      continue;
    }
    report(statement, 'top-level statement');
  }
  return effects;
}

describe('library packages declare `sideEffects` (#175)', () => {
  it('derives a non-empty population that includes every listed package', () => {
    expect(repoRoot).not.toBeNull();
    const names = family().map((member) => member.name);
    expect(names.length).toBeGreaterThan(0);
    const missing = [...Object.keys(UNDECLARED), ...Object.keys(AUDITED)].filter(
      (name) => !names.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('every member outside the known-undeclared list declares `false` or a non-empty array', () => {
    const offending = family()
      .filter((member) => !(member.name in UNDECLARED))
      .filter((member) => !isDeclared(member.manifest['sideEffects']))
      .map((member) => `${member.name}: ${JSON.stringify(member.manifest['sideEffects'])}`);
    expect(offending).toEqual([]);
  });

  it('the known-undeclared list holds no package that has since declared the field', () => {
    const stale = Object.keys(UNDECLARED).filter(
      (name) => memberNamed(name).manifest['sideEffects'] !== undefined,
    );
    expect(stale).toEqual([]);
  });

  it('every `sideEffects` pattern matches a file the package ships', () => {
    const dangling: string[] = [];
    for (const member of family()) {
      const value = member.manifest['sideEffects'];
      if (!Array.isArray(value)) continue;
      const files = shippedFiles(member);
      for (const pattern of value as string[]) {
        if (!files.some((file) => patternMatches(pattern, file))) {
          dangling.push(`${member.name}: ${pattern}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  describe.each(Object.entries(AUDITED))('%s', (name, declared) => {
    it('declares the value the audit settled on', () => {
      expect(memberNamed(name).manifest['sideEffects']).toEqual(declared);
    });

    it('ships every CSS file it publishes under a `sideEffects` pattern', () => {
      const member = memberNamed(name);
      const patterns = Array.isArray(declared) ? declared : [];
      const unlisted = shippedFiles(member)
        .filter((file) => file.endsWith('.css'))
        .filter((file) => !patterns.some((pattern) => patternMatches(pattern, file)));
      expect(unlisted).toEqual([]);
    });

    it('has no import-time side effect in any source file the declaration does not list', () => {
      const member = memberNamed(name);
      const patterns = Array.isArray(declared) ? declared : [];
      const effects = walk(
        join(member.dir, 'src'),
        (path) => /\.tsx?$/.test(path) && !/\.d\.ts$/.test(path) && !/\.test\.tsx?$/.test(path),
      )
        .filter((file) => {
          const emitted = posix(relative(member.dir, file))
            .replace(/^src\//, 'dist/')
            .replace(/\.tsx?$/, '.js');
          return !patterns.some((pattern) => patternMatches(pattern, emitted));
        })
        .flatMap((file) =>
          importTimeEffects(file, posix(relative(repoRoot!, file)), readFileSync(file, 'utf8')),
        );
      expect(effects).toEqual([]);
    });
  });

  it('the audit itself recognises the shapes it is meant to refuse, and passes the pure ones', () => {
    const text = [
      "import './register.js';",
      "import 'x/styles.css';",
      "import { a } from './a.js';",
      'echarts.use([BarChart]);',
      'window.flag = true;',
      'const registered = registerBundle(messages);',
      'const ctx = createContext(null);',
      'const lazyRead = () => registerBundle(messages);',
      'const isMac = /Mac/.test(navigator.platform);',
      'const cache = new Map();',
      'Label.displayName = "Label";',
      'if (typeof window !== "undefined") boot();',
      'class A { static x = register(); }',
      'const node = Node.create({ parseHTML() { return register(); } });',
      'const selector = ["a", "b"].join(",");',
    ].join('\n');
    const effects = importTimeEffects('probe.ts', 'probe.ts', text).map((line) =>
      line.replace(/: .*$/, ''),
    );
    expect(effects).toEqual([
      'probe.ts:1 bare import',
      'probe.ts:2 bare import',
      'probe.ts:4 top-level statement',
      'probe.ts:5 top-level statement',
      'probe.ts:6 initialiser call',
      'probe.ts:12 top-level statement',
      'probe.ts:13 static initialiser call',
    ]);
  });

  it('reads a `sideEffects` pattern the way the bundler does', () => {
    expect(patternMatches('*.css', 'theme.css')).toBe(true);
    expect(patternMatches('*.css', 'dist/ui/x.css')).toBe(true);
    expect(patternMatches('*.css', 'dist/ui/x.js')).toBe(false);
    expect(patternMatches('./dist/register.js', 'dist/register.js')).toBe(true);
    expect(patternMatches('dist/**/*.js', 'dist/a/b.js')).toBe(true);
    expect(patternMatches('dist/**/*.js', 'src/a/b.js')).toBe(false);
  });
});
