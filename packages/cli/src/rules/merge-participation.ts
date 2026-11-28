/**
 * `check:merge-participation` — every persisted reference to a mergeable record
 * is declared by its owner (`specs/192-organization-merge/` FR-045, SC-008,
 * research R-9, `contracts/merge-participation-check.md`).
 *
 * The platform merges two Organizations (or two Projects) by asking every
 * module that holds a reference to the loser to move its own rows. A module
 * that adds such a reference and declares nothing would leave rows pointing at
 * an archived record the day it ships — so the population is derived, never
 * listed: every property of a persisted entity named `organizationId`,
 * `organizationIds`, `*OrganizationId(s)`, or `projectId` / `*ProjectId`
 * outside `projects`, plus whatever a declaration names as polymorphic. Each is
 * held to exactly one `merge.participates` reference of its **own** module.
 *
 * One analysis, two hosts — and here it is three: the coverage itself is
 * `analyseMergeCoverage` in `@endora-commerce/contracts`, which the platform's
 * runtime twin also runs over the ORM's metadata to refuse a merge start while
 * a present module is uncovered. This file adds what a source walk needs: the
 * entity classes and their persisted properties, read from TypeScript source
 * as AST nodes.
 *
 * Findings (exit 1): `undeclared-reference`, `declared-missing-property`,
 * `foreign-declaration`, `double-coverage`, `stale-pending`. A walk that read
 * no entity at all is exit 2.
 */
import ts from 'typescript';
import {
  analyseMergeCoverage,
  type MergeCoverageFinding,
  type MergeDeclarationWithModule,
  type MergePendingEntry,
  type MergePopulationEntity,
} from '@endora-commerce/contracts';

export const PREFIX = '[merge-participation]';

/** The decorators that make a class property a persisted column or relation. */
const PERSISTED_DECORATORS = new Set([
  'Property',
  'PrimaryKey',
  'ManyToOne',
  'OneToOne',
  'Enum',
  'Embedded',
  'Formula',
  'SerializedPrimaryKey',
]);

/** A cheap pre-filter: a file that never says `@Entity(` declares no entity. */
export const ENTITY_HINT = /@Entity\s*\(/;

function decoratorName(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  }
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

/** Every `@Entity()` class in one source file, with its persisted property names. */
export function persistedEntitiesFromSource(text: string, file: string): { entity: string; properties: string[] }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: { entity: string; properties: string[] }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      const decorators = ts.getDecorators(node) ?? [];
      if (decorators.some((decorator) => decoratorName(decorator) === 'Entity')) {
        const properties: string[] = [];
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || member.name === undefined) continue;
          const memberDecorators = ts.getDecorators(member) ?? [];
          if (!memberDecorators.some((decorator) => PERSISTED_DECORATORS.has(decoratorName(decorator) ?? ''))) continue;
          if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) properties.push(member.name.text);
        }
        out.push({ entity: node.name.text, properties });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// --- FR-047: a reference set outside an ORM flush ------------------------------

/** One entity's table and the column of each persisted property, read from its decorators. */
export interface EntityTable {
  readonly entity: string;
  readonly table: string;
  readonly columns: Readonly<Record<string, string>>;
}

const snake = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function objectLiteralString(node: ts.Expression | undefined, key: string): string | undefined {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (name === key && ts.isStringLiteralLike(property.initializer)) return property.initializer.text;
  }
  return undefined;
}

/**
 * Every `@Entity()` class with its table (`tableName`, else the class name in
 * snake case) and its persisted properties' columns (`fieldName`, else the
 * property in snake case — the ORM's underscore naming).
 */
export function entityTablesFromSource(text: string, file: string): EntityTable[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: EntityTable[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      const entityDecorator = (ts.getDecorators(node) ?? []).find((decorator) => decoratorName(decorator) === 'Entity');
      if (entityDecorator !== undefined) {
        const call = ts.isCallExpression(entityDecorator.expression) ? entityDecorator.expression : undefined;
        const table = objectLiteralString(call?.arguments[0], 'tableName') ?? snake(node.name.text);
        const columns: Record<string, string> = {};
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || member.name === undefined) continue;
          const decorator = (ts.getDecorators(member) ?? []).find((d) => PERSISTED_DECORATORS.has(decoratorName(d) ?? ''));
          if (decorator === undefined) continue;
          if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) continue;
          const options = ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined;
          columns[member.name.text] = objectLiteralString(options, 'fieldName') ?? snake(member.name.text);
        }
        out.push({ entity: node.name.text, table, columns });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

export interface ReferenceWriteFinding {
  readonly kind: 'unguarded-reference-write';
  readonly moduleId: string;
  readonly entity: string;
  readonly property: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface ReferenceWriteInput {
  /** Every entity's table, attributed to its module. */
  readonly tables: readonly (EntityTable & { readonly moduleId: string })[];
  readonly declarations: readonly MergeDeclarationWithModule[];
  /** Every non-test source file, attributed to its module. */
  readonly files: readonly { readonly file: string; readonly moduleId: string; readonly text: string }[];
}

/** The merge's own writes: its commands and participants, which run inside the merge's scope. */
const MERGE_CODE = /(^|\/)merge\/|merge[^/]*\.ts$|\/migrations\//;
const GUARD_CALL = /\b(?:assertMergeWritable|mergeWriteRefusal)\s*\(/;
const NATIVE_DATA_ARGUMENT: Readonly<Record<string, number>> = {
  nativeUpdate: 2,
  nativeInsert: 1,
  insert: 1,
  insertMany: 1,
  upsert: 1,
  upsertMany: 1,
};

/** Does `node` (a write's data argument) set `property`? Anything but a literal might, so it counts. */
function dataSets(node: ts.Expression | undefined, property: string): boolean {
  if (node === undefined) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.some((element) => dataSets(element as ts.Expression, property));
  if (!ts.isObjectLiteralExpression(node)) return true;
  return node.properties.some((member) => {
    if (ts.isSpreadAssignment(member)) return true;
    const name = member.name;
    return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === property;
  });
}

/**
 * FR-047 — every site that sets a declared (not `kept`) reference outside an
 * ORM flush: a SQL `insert into "<table>" (…)` naming its column, an
 * `update "<table>" set …` naming it before `where`, and a `native*`,
 * `insert*` or `upsert*` call on the entity whose data sets it. Each is a
 * finding unless the participation declares `freeze: 'guarded'` **and** the
 * file asks the freeze — `assertMergeWritable`, or `mergeWriteRefusal` where a
 * site skips the write rather than refuse it. The merge's own code is exempt: it runs
 * inside the merge's scope and moves rows to the survivor.
 */
export function referenceWriteFindings(input: ReferenceWriteInput): ReferenceWriteFinding[] {
  const findings: ReferenceWriteFinding[] = [];
  const tableOf = new Map(input.tables.map((table) => [`${table.moduleId}:${table.entity}`, table]));
  for (const declaration of input.declarations) {
    const guarded = declaration.freeze === 'guarded';
    for (const reference of declaration.references) {
      if (reference.disposition === 'kept') continue;
      const table = tableOf.get(`${declaration.moduleId}:${reference.entity}`);
      const column = table?.columns[reference.property];
      if (table === undefined || column === undefined) continue;
      for (const { file, moduleId, text } of input.files) {
        if (moduleId !== declaration.moduleId || MERGE_CODE.test(file)) continue;
        if (guarded && GUARD_CALL.test(text)) continue;
        const lines = new Set<number>();
        const lineAt = (offset: number): number => text.slice(0, offset).split('\n').length;
        const quoted = `"${column}"`;
        for (const match of text.matchAll(new RegExp(`insert\\s+into\\s+"${table.table}"\\s*\\(([^)]*)\\)`, 'gi'))) {
          if (match[1]!.includes(quoted)) lines.add(lineAt(match.index!));
        }
        for (const match of text.matchAll(new RegExp(`update\\s+"${table.table}"(?:\\s+(?:as\\s+)?"?\\w+"?)?\\s+set\\b([\\s\\S]*?)(?:\\bwhere\\b|\\bfrom\\b|\\breturning\\b|\`|$)`, 'gi'))) {
          if (match[1]!.includes(quoted)) lines.add(lineAt(match.index!));
        }
        if (text.includes(reference.entity)) {
          const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
          const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
              const index = NATIVE_DATA_ARGUMENT[node.expression.name.text];
              const target = node.arguments[0];
              if (
                index !== undefined &&
                target !== undefined &&
                ts.isIdentifier(target) &&
                target.text === reference.entity &&
                dataSets(node.arguments[index], reference.property)
              ) {
                lines.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
              }
            }
            ts.forEachChild(node, visit);
          };
          visit(source);
        }
        for (const line of [...lines].sort((a, b) => a - b)) {
          findings.push({
            kind: 'unguarded-reference-write',
            moduleId: declaration.moduleId,
            entity: reference.entity,
            property: reference.property,
            file,
            line,
            message:
              `${file}:${line} sets ${reference.entity}.${reference.property} outside an ORM flush, which the platform's merge ` +
              `freeze cannot see (FR-047). Declare the participation "${declaration.key}" with freeze: 'guarded' and call ` +
              `assertMergeWritable('${declaration.host}', …) before the write, in this file.`,
          });
        }
      }
    }
  }
  return findings;
}

export interface MergeParticipationInput {
  /** Every persisted entity read, attributed to its module (`core` for the platform). */
  readonly population: readonly MergePopulationEntity[];
  readonly declarations: readonly MergeDeclarationWithModule[];
  /** The repository's pending ledger; a package host passes none. */
  readonly pending?: readonly MergePendingEntry[];
}

export interface MergeParticipationResult {
  readonly findings: readonly MergeCoverageFinding[];
  /** Entity classes read. */
  readonly entities: number;
  /** Host references read (the population this rule judges). */
  readonly sites: number;
}

export function checkMergeParticipation(input: MergeParticipationInput): MergeParticipationResult {
  const result = analyseMergeCoverage({
    population: input.population,
    declarations: input.declarations,
    ...(input.pending !== undefined ? { pending: input.pending } : {}),
  });
  return { findings: result.findings, entities: input.population.length, sites: result.sites };
}

/** One finding, as both hosts print it. */
export function describeFinding(finding: MergeCoverageFinding): string {
  return `[${finding.kind}] ${finding.moduleId} ${finding.entity}.${finding.property}: ${finding.message}`;
}
