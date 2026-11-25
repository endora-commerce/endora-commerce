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
