/**
 * What an **emitted** ES module exports at runtime, read as syntax.
 *
 * This answers what the build actually published, not what the author wrote,
 * and only the first is what a consumer's bundler loads. A type-only module
 * compiles to `export {};` under `verbatimModuleSyntax` (`tsconfig.base.json`),
 * so the sound answer for one is the empty list.
 *
 * ## Why it lives here rather than beside its first caller
 *
 * It has **two** readers and one meaning. T050's guard
 * (`test/helpers/module-package-surface.ts`) asks it whether a module package's
 * `./ports` subpath kept its type-only promise; `check-module-boundary.ts` asks
 * it whether a subpath a module reached is contract surface (D-171). That is one
 * fact — *does this emitted module export a runtime binding* — and two
 * derivations of one fact are two answers waiting to disagree, which is D-100
 * read backwards. So the function is here, in the directory a check and a test
 * helper can both import from, and the helper re-exports it under the name its
 * own callers already use.
 *
 * ## What it can and cannot see
 *
 * It reads literal AST nodes, so a comment or a string quoting an export is out
 * of the population by construction. A **star re-export** names no binding it
 * can enumerate, so it is reported as `* from '<specifier>'` — a name, and
 * therefore a runtime export, because the honest answer to "does this module
 * export something" for a re-export this cannot follow is "yes, unknown" and not
 * "no". It does not follow a specifier, and it does not evaluate anything: a
 * module whose only statement is `export {};` is the empty list and everything
 * else is at least one name.
 */
import { existsSync, readFileSync } from 'node:fs';

import ts from 'typescript';

/** A file reader the caller supplies, so a fixture can enter at the top (issue #130). */
export interface SourceReader {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
}

/** The reader a real run uses: the filesystem. */
export const nodeSourceReader: SourceReader = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf8'),
};

/** One source file, parsed with parent pointers so a caller can walk upwards. */
export function parseModule(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** Whether a statement carries the `export` modifier. */
export function hasExportModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/**
 * Names an emitted ES module exports at runtime.
 *
 * `path` is the emitted file and `reader` is how it is read, both parameters so
 * that a fixture enters at the top of the analysis rather than below the step it
 * is meant to protect (issue #130).
 */
export function runtimeExportsOfEmittedModule(
  path: string,
  reader: SourceReader = nodeSourceReader,
): string[] {
  const source = parseModule(path, reader.read(path));
  const found = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      found.add('default');
      continue;
    }
    if (hasExportModifier(statement)) {
      if (ts.isClassDeclaration(statement) && statement.name) found.add(statement.name.text);
      else if (ts.isFunctionDeclaration(statement) && statement.name) found.add(statement.name.text);
      else if (ts.isEnumDeclaration(statement)) found.add(statement.name.text);
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) found.add(declaration.name.text);
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    if (statement.exportClause === undefined) {
      if (specifier !== null) found.add(`* from '${specifier}'`);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      found.add(element.name.text);
    }
  }
  return [...found].sort();
}
