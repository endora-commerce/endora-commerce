import ts from 'typescript';

/**
 * Where a source file declares extension columns, read off the syntax tree
 * (`specs/178-extensible-columns/` FR-008, FR-064).
 *
 * A declaration is a call of `defineColumnExtension(...)` — bare or through a
 * namespace — or an exported binding named `schemaExtensions`, which is the
 * name the platform's package reader looks for. A comment or a string quoting
 * either is trivia or a literal and declares nothing, which is why this asks
 * the parser rather than the text (`entity-declarations.ts` gives the measured
 * reason).
 */
export interface SchemaExtensionDeclarationSite {
  readonly kind: 'call' | 'export';
  readonly line: number;
}

const DEFINE = 'defineColumnExtension';
const EXPORT = 'schemaExtensions';

function calledName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }
  return undefined;
}

function isExported(node: ts.Node): boolean {
  return (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

export function schemaExtensionDeclarationSites(
  source: string,
  fileName: string,
): SchemaExtensionDeclarationSite[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const sites: SchemaExtensionDeclarationSite[] = [];
  const lineOf = (node: ts.Node): number =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calledName(node.expression) === DEFINE) {
      sites.push({ kind: 'call', line: lineOf(node) });
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === EXPORT) {
          sites.push({ kind: 'export', line: lineOf(declaration) });
        }
      }
    }
    if (ts.isExportSpecifier(node) && node.name.text === EXPORT) {
      sites.push({ kind: 'export', line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}
