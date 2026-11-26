/**
 * A module manifest's `commandMiddleware` declarations, read without running
 * the manifest (`specs/189-command-middleware/` FR-004, FR-034, research R-12).
 *
 * The declaration is data in `manifest.ts` — or in the `dist` JavaScript an
 * installed package ships — so the divergence report and `endora generate`
 * read it the way they read every other seam: as literals in the source. A
 * declaration the analysis cannot read is returned as `unresolved`, never
 * skipped: "no middleware" is the direction that agrees with the defect.
 *
 * The manifest's own `dependencies` are read beside it, because the order of
 * two `admit` middlewares follows the dependency graph and a tie the graph
 * leaves open is what `commandMiddlewareOrder` exists for.
 */
import ts from 'typescript';

export interface StaticCommandMiddlewareDeclaration {
  readonly id: string;
  readonly phase: 'admit' | 'observe';
  readonly actions: '*' | readonly string[];
  readonly timeoutMs?: number;
  readonly line: number;
}

export interface StaticCommandMiddlewareReading {
  readonly declarations: readonly StaticCommandMiddlewareDeclaration[];
  /** The manifest's direct `dependencies`, or `null` when they are not written as literals. */
  readonly dependencies: readonly string[] | null;
  /** Each declaration, or the field itself, that is not written as a literal. */
  readonly unresolved: readonly { readonly line: number; readonly text: string }[];
}

const TEXT_LIMIT = 120;

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function nameOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function stringOf(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : null;
}

function stringsOf(node: ts.Expression | undefined): string[] | null {
  if (node === undefined) return null;
  const value = unwrap(node);
  if (!ts.isArrayLiteralExpression(value)) return null;
  const out: string[] = [];
  for (const element of value.elements) {
    const text = stringOf(element);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

function fieldsOf(object: ts.ObjectLiteralExpression): Map<string, ts.Expression> | null {
  const fields = new Map<string, ts.Expression>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = nameOf(property.name);
    if (name === null) return null;
    fields.set(name, property.initializer);
  }
  return fields;
}

/** The `commandMiddleware` declarations of the manifest written in `source`. */
export function commandMiddlewareDeclarationsIn(source: string, file: string): StaticCommandMiddlewareReading {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const textOf = (node: ts.Node): string => {
    const text = node.getText(sf).replace(/\s+/g, ' ');
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
  };
  const declarations: StaticCommandMiddlewareDeclaration[] = [];
  const unresolved: { line: number; text: string }[] = [];
  let dependencies: string[] | null = null;

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'commandMiddleware') {
      const list = unwrap(node.initializer);
      const parent = node.parent;
      if (ts.isObjectLiteralExpression(parent)) {
        for (const sibling of parent.properties) {
          if (ts.isPropertyAssignment(sibling) && nameOf(sibling.name) === 'dependencies') {
            dependencies = stringsOf(sibling.initializer);
          }
        }
      }
      if (!ts.isArrayLiteralExpression(list)) {
        unresolved.push({ line: lineOf(node), text: textOf(node) });
        return;
      }
      for (const element of list.elements) {
        const value = unwrap(element as ts.Expression);
        const fields = ts.isObjectLiteralExpression(value) ? fieldsOf(value) : null;
        const id = stringOf(fields?.get('id'));
        const phase = stringOf(fields?.get('phase'));
        const actionsNode = fields?.get('actions');
        const actions = stringOf(actionsNode) === '*' ? ('*' as const) : stringsOf(actionsNode);
        const timeoutNode = fields?.get('timeoutMs');
        const timeout = timeoutNode === undefined ? undefined : unwrap(timeoutNode);
        if (
          id === null ||
          (phase !== 'admit' && phase !== 'observe') ||
          actions === null ||
          (timeout !== undefined && !ts.isNumericLiteral(timeout))
        ) {
          unresolved.push({ line: lineOf(element), text: textOf(element) });
          continue;
        }
        declarations.push({
          id,
          phase,
          actions,
          ...(timeout === undefined ? {} : { timeoutMs: Number((timeout as ts.NumericLiteral).text) }),
          line: lineOf(element),
        });
      }
      return;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return { declarations, dependencies, unresolved };
}

/** Whether `file` is a module manifest the analysis reads declarations from. */
export function isManifestFile(file: string): boolean {
  return /(^|\/)manifest\.(?:[cm]?js|ts)$/.test(file);
}
