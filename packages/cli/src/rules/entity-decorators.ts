/**
 * CI check — MikroORM's decorators come only from `@mikro-orm/decorators/legacy`
 * (issue #1866, the MikroORM 7 switch).
 *
 * MikroORM 7 moved its decorators out of `@mikro-orm/core` into
 * `@mikro-orm/decorators`, in two incompatible forms: `./legacy`, for
 * TypeScript's `experimentalDecorators`, and `./es`, for TC39 decorators. The
 * estate's idiom is the first (the #1073 plan, 2026-11-23) — every tsconfig here
 * and in a scaffolded instance sets `experimentalDecorators` — and the two cannot
 * be mixed: an ES decorator applied under `experimentalDecorators` receives a
 * legacy call signature and records nothing, so an entity decorated that way
 * compiles and is then missing from discovery. A decorator name imported from
 * anywhere else under `@mikro-orm/*` is either that mistake or a MikroORM 6
 * spelling that no longer resolves.
 *
 * What is a finding:
 *
 *   * `decorator-from-elsewhere` — a decorator name ({@link DECORATOR_NAMES})
 *     imported or re-exported, as a value, from a `@mikro-orm/*` specifier other
 *     than {@link SANCTIONED_SPECIFIER} (`@mikro-orm/core`, `@mikro-orm/postgresql`,
 *     `@mikro-orm/decorators/es`, …). Matched on the imported name, so an alias
 *     (`import { Entity as E }`) is caught too.
 *   * `namespace-decorator` — a decorator applied through a namespace import of
 *     such a specifier (`import * as orm from '@mikro-orm/decorators/es'` …
 *     `@orm.Entity()`).
 *
 * A type-only import is not a finding: it names `EntityOptions` and the like,
 * never a decorator. Static analysis through the TypeScript compiler API, so a
 * mention in a comment or a string is not a finding.
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis. `backend/scripts/check-entity-decorators.ts` hosts
 * it over this repository's source roots; `endora check` hosts it over one
 * module package (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). The roots are a parameter in both.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

/** The one specifier MikroORM's decorators may come from. */
export const SANCTIONED_SPECIFIER = '@mikro-orm/decorators/legacy';

/**
 * Every decorator `@mikro-orm/decorators/legacy` exports (7.2.11). A name is a
 * finding only when it arrives from another `@mikro-orm/*` specifier, so a
 * future decorator missing from this list is a gap in coverage, never a false
 * finding.
 */
export const DECORATOR_NAMES: ReadonlySet<string> = new Set([
  'AfterCreate',
  'AfterDelete',
  'AfterUpdate',
  'AfterUpsert',
  'BeforeCreate',
  'BeforeDelete',
  'BeforeUpdate',
  'BeforeUpsert',
  'Check',
  'CreateRequestContext',
  'Embeddable',
  'Embedded',
  'EnsureRequestContext',
  'Entity',
  'Enum',
  'Filter',
  'Formula',
  'Index',
  'ManyToMany',
  'ManyToOne',
  'OneToMany',
  'OneToOne',
  'OnInit',
  'OnLoad',
  'PrimaryKey',
  'Property',
  'SerializedPrimaryKey',
  'Transactional',
  'Trigger',
  'Unique',
]);

export type EntityDecoratorFindingKind = 'decorator-from-elsewhere' | 'namespace-decorator';

export interface EntityDecoratorFinding {
  readonly kind: EntityDecoratorFindingKind;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly specifier: string;
}

/** A `@mikro-orm/*` specifier that is not the sanctioned one. */
function isOtherMikroOrmSpecifier(specifier: string): boolean {
  return specifier.startsWith('@mikro-orm/') && specifier !== SANCTIONED_SPECIFIER;
}

/** Every `.ts` / `.tsx` file under `roots`, skipping installs, build output and declarations. */
export function collectSourceFiles(roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}

/** Every finding in one source file. */
export function analyzeSource(source: string, file: string): EntityDecoratorFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: EntityDecoratorFinding[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  /** namespace binding → the `@mikro-orm/*` specifier it imports. */
  const namespaces = new Map<string, string>();

  const named = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>, specifier: string): void => {
    for (const element of elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (!DECORATOR_NAMES.has(imported)) continue;
      findings.push({ kind: 'decorator-from-elsewhere', file, line: lineOf(element), name: imported, specifier });
    }
  };

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!isOtherMikroOrmSpecifier(specifier) || clause === undefined || clause.isTypeOnly) continue;
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, specifier);
      else named(bindings.elements, specifier);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const specifier = statement.moduleSpecifier.text;
      if (isOtherMikroOrmSpecifier(specifier)) named(statement.exportClause.elements, specifier);
    }
  }

  if (namespaces.size > 0) {
    const visit = (node: ts.Node): void => {
      if (ts.isDecorator(node)) {
        const target = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
        if (
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          namespaces.has(target.expression.text) &&
          DECORATOR_NAMES.has(target.name.text)
        ) {
          findings.push({
            kind: 'namespace-decorator',
            file,
            line: lineOf(node),
            name: target.name.text,
            specifier: namespaces.get(target.expression.text)!,
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return findings;
}

/** The sentence a finding is reported with, shared by both hosts. */
export function findingMessage(finding: EntityDecoratorFinding): string {
  return finding.kind === 'namespace-decorator'
    ? `applies @${finding.name} through a namespace import of '${finding.specifier}'. ` +
        `Import it by name from '${SANCTIONED_SPECIFIER}'.`
    : `imports the decorator ${finding.name} from '${finding.specifier}'. MikroORM 7's ` +
        `decorators come from '${SANCTIONED_SPECIFIER}' only — the estate compiles with ` +
        `experimentalDecorators, where an ES decorator records nothing.`;
}
