/**
 * Every module specifier a TypeScript source names, in every shape a specifier
 * can take.
 *
 * Extracted from `check-kernel-boundary.ts` (feature 075, MR-0) rather than
 * written fresh: two independently written walkers drift, and the shape one
 * forgets is the shape the next violation uses. `check-kernel-boundary.ts` and
 * `check-module-boundary.ts` police opposite directions across the same
 * boundary, so a specifier that is invisible to one of them is a hole in both.
 *
 * The eight shapes, and why each is here rather than assumed away:
 *
 *   - `value-import`        `import { X } from '…'`
 *   - `type-only-import`    `import type { X } from '…'` — erased at runtime and
 *                           still a real edge: types resolve at build time, and
 *                           ESLint's `prefer: 'type-imports'` rewrites value
 *                           imports into this shape automatically.
 *   - `mixed-type-specifier` `import { type A, B } from '…'` — a *value* import
 *                           whose first specifier is typed. A classifier that
 *                           reads the first token calls it type-only; one that
 *                           requires every specifier to be typed calls it a
 *                           value import. Both are edges, so the kind records
 *                           which reading was taken instead of hiding it.
 *   - `re-export`           `export { X } from '…'` / `export * from '…'`
 *   - `side-effect-import`  `import '…'`
 *   - `dynamic-import`      `await import('…')` — invisible to a reviewer
 *                           scanning the import block, and to a bundler.
 *   - `require-call`        `require('…')`
 *   - `import-type-node`    `let x: import('…').T` — erased by tsc, permitted by
 *                           this repository's ESLint config
 *                           (`disallowTypeAnnotations: false`), and invisible to
 *                           a check that only walks import declarations.
 *
 * Static analysis through the TypeScript compiler API, so a specifier mentioned
 * in a comment or in a string literal is not a finding.
 */
import ts from 'typescript';

/** The shape a specifier was written in. See the header for why each is listed. */
export type SpecifierKind =
  | 'value-import'
  | 'type-only-import'
  | 'mixed-type-specifier'
  | 're-export'
  | 'side-effect-import'
  | 'dynamic-import'
  | 'require-call'
  | 'import-type-node';

/** One specifier as it was written, with everything a boundary rule needs of it. */
export interface NamedSpecifier {
  /** The specifier exactly as written, extension and all. */
  readonly text: string;
  readonly kind: SpecifierKind;
  /** What the import takes: a reviewer's first question is shape or behaviour. */
  readonly bindings: readonly string[];
  readonly line: number;
}

function importBindings(node: ts.Node): string[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return [];
    const names: string[] = [];
    if (clause.name) names.push(clause.name.text);
    const bound = clause.namedBindings;
    if (bound) {
      if (ts.isNamespaceImport(bound)) names.push(`* as ${bound.name.text}`);
      else for (const element of bound.elements) names.push(element.name.text);
    }
    return names;
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    if (!clause) return ['*'];
    if (ts.isNamespaceExport(clause)) return [`* as ${clause.name.text}`];
    return clause.elements.map((element) => element.name.text);
  }
  return [];
}

/**
 * Which of the four import-declaration shapes this is.
 *
 * A declaration with no import clause takes nothing and is therefore a
 * side-effect import; `import type` marks the clause; `import { type A, B }`
 * marks individual elements, which is the shape a first-token classifier gets
 * wrong.
 */
function importDeclarationKind(node: ts.ImportDeclaration): SpecifierKind {
  const clause = node.importClause;
  if (!clause) return 'side-effect-import';
  if (clause.isTypeOnly) return 'type-only-import';
  const bound = clause.namedBindings;
  if (bound && ts.isNamedImports(bound) && bound.elements.some((element) => element.isTypeOnly)) {
    return 'mixed-type-specifier';
  }
  return 'value-import';
}

/**
 * Every module specifier `source` names, in source order.
 *
 * `file` is used only for the source-file name the compiler API wants and for
 * line numbers; nothing here touches disk, so a caller may pass a path that does
 * not exist — which is what lets both checks' fixtures enter at the top.
 */
export function namedSpecifiers(source: string, file: string): NamedSpecifier[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: NamedSpecifier[] = [];

  const record = (
    specifier: ts.StringLiteralLike,
    kind: SpecifierKind,
    bindings: readonly string[],
  ): void => {
    found.push({
      text: specifier.text,
      kind,
      bindings,
      line: sf.getLineAndCharacterOfPosition(specifier.getStart(sf)).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(
        node.moduleSpecifier,
        ts.isImportDeclaration(node) ? importDeclarationKind(node) : 're-export',
        importBindings(node),
      );
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const [first] = node.arguments;
      if ((isDynamicImport || isRequire) && first && ts.isStringLiteral(first)) {
        record(first, isDynamicImport ? 'dynamic-import' : 'require-call', []);
      }
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        record(
          argument.literal,
          'import-type-node',
          node.qualifier ? [node.qualifier.getText(sf)] : [],
        );
      }
    }
    node.forEachChild(visit);
  };

  sf.forEachChild(visit);
  return found;
}
