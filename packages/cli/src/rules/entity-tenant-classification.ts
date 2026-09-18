/**
 * Systemic Organization tenant scoping — Principle XI's own instrument
 * (feature 050, FR-012 / SC-001).
 *
 * The rule is one sentence: **every MikroORM entity class carries exactly one
 * tenant-scope classification decorator** — `@OrgScoped`, `@CustomerScoped`,
 * `@GlobalEntity`, `@TransitivelyScoped` or `@RuleScoped`. An entity with none
 * escapes the global-filter guard silently; an entity with two has a guard
 * nobody can predict from the class.
 *
 * ## Why this rule is the one Phase 3 lands first
 *
 * It is the highest-value member of the estate and it was, until this
 * relocation, the most completely defeated one. Eleven of the fifteen paid
 * modules ship persisted entities (`specs/134-paid-module-extraction/`), and the
 * moment a module lives in another repository a class shipped with no
 * classification decorator is exactly the silence there was no instrument for:
 * this repository's walk cannot see the package's source, and Principle XI —
 * non-negotiable — held in name only outside the mothership.
 *
 * ## One analysis, two readers, and why that is not two implementations
 *
 * The **analysis** is {@link classifyFindings}: over a list of
 * {@link EntityFinding}, which classes carry none and which carry more than one.
 * It has one implementation and both hosts call it
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6).
 *
 * What differs is the **reader**, because the two hosts' inputs differ and §2's
 * table says so in as many words — *"unchanged code, different input"*:
 *
 *   * {@link analyzeSource} reads decorated TypeScript. That is this
 *     repository's own tree, where a module's source is on disk.
 *   * {@link analyzeEmitted} reads the **artefact** — the file the platform
 *     actually loads (§4). A published package ships compiled output, and
 *     `@Entity(` does not survive into it, so a source-text probe of a `dist`
 *     finds nothing and reports clean. What *does* survive is the class-level
 *     `__decorate([Entity({ … }), OrgScoped()], Class)` call `tsc` writes, and
 *     the decorator identifiers inside it are the same names the source spells.
 *
 * Both readers return the same shape, so the counting, the report and the
 * failure text all run over one array — which is what makes the sentence above
 * true of the code and not only of the prose.
 *
 * **The emit shape is not assumed to hold for ever, and that is handled by the
 * floor rather than by a promise.** If TypeScript's decorator emit changed, this
 * reader would find no class at all — and the package's own `entities` export
 * ({@link declaredEntityClasses}) is the independent second author that turns
 * that into a refusal instead of a clean run.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

/** This rule's log prefix, spelled once so the two hosts cannot disagree. */
export const PREFIX = '[tenant-classification]';

/**
 * The five decorators, in the order a failure message lists them.
 *
 * A list rather than a set, because the remedy sentence has to name them in a
 * stable order and a `Set`'s iteration order is an implementation detail nobody
 * should have to reason about in a CI log.
 */
export const CLASSIFICATION_DECORATOR_NAMES: readonly string[] = [
  'OrgScoped',
  'CustomerScoped',
  'GlobalEntity',
  'TransitivelyScoped',
  'RuleScoped',
];

export const CLASSIFICATION_DECORATORS: ReadonlySet<string> = new Set(
  CLASSIFICATION_DECORATOR_NAMES,
);

/** Only a file that spells `@Entity(` can declare one; the parse decides the rest. */
export const ENTITY_DECORATOR_HINT = /@Entity\s*\(/;

/**
 * Only an emitted file that spells `__decorate` can hold one.
 *
 * The artefact's counterpart to {@link ENTITY_DECORATOR_HINT}, and the same
 * contract: a cheap text gate in front of a parse, never the predicate.
 */
export const EMITTED_DECORATE_HINT = /__decorate\s*\(/;

export interface EntityFinding {
  file: string;
  className: string;
  classifications: string[];
}

/**
 * Every `.ts` under `dir` except tests and declaration files.
 *
 * The walk used to collect `*.entity.ts` only. Nothing enforces that suffix, so
 * an entity declared anywhere else was not unclassified as far as this check was
 * concerned — it was unread, which a green run cannot be told apart from
 * (issue #113). {@link ENTITY_DECORATOR_HINT} decides what is worth parsing.
 */
export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every emitted module under `dir`.
 *
 * Source maps and declaration files are not what the platform loads, so they are
 * not what this reads. The extension set is the one Node will execute.
 */
export function walkEmitted(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const full = join(dir, name);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (directory) {
      if (name === 'node_modules') continue;
      walkEmitted(full, out);
    } else if (/\.(js|mjs|cjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The name a decorator expression applies, whatever spelling it arrived in. */
function appliedName(expression: ts.Expression): string | undefined {
  const callee = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(callee)) return callee.text;
  // `core_1.Entity` — CommonJS emit routes every import through its namespace
  // object, so the name this rule reasons about is the property, not the object.
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text;
  // `(0, core_1.Entity)()` — the indirect-call form tsc emits to drop `this`.
  if (ts.isParenthesizedExpression(callee)) return appliedName(callee.expression);
  if (ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return appliedName(callee.right);
  }
  return undefined;
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  return appliedName(decorator.expression);
}

/** One `EntityFinding` from a set of applied decorator names, or `null`. */
function findingOf(names: readonly string[], className: string, file: string): EntityFinding | null {
  if (!names.includes('Entity')) return null; // only MikroORM entities
  return {
    file,
    className,
    classifications: names.filter((name) => CLASSIFICATION_DECORATORS.has(name)),
  };
}

/** Analyze a single TypeScript source string for MikroORM entities + their classification. Exported for tests. */
export function analyzeSource(source: string, file: string): EntityFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: EntityFinding[] = [];
  sf.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) return;
    const decorators = ts.getDecorators(node) ?? [];
    const names = decorators.map(decoratorName).filter((n): n is string => Boolean(n));
    const finding = findingOf(names, node.name?.text ?? '<anonymous>', file);
    if (finding !== null) findings.push(finding);
  });
  return findings;
}

/**
 * The same analysis over the **emitted** artefact.
 *
 * `tsc` lowers a decorated class to a class-level call — `Class =
 * __decorate([D1(), D2()], Class)` — and lowers a decorated *member* to a
 * four-argument one. Only the class-level form is this rule's subject, and the
 * two are told apart by the argument list rather than by position in the file:
 * the member form names a `prototype` and a property key, the class form names
 * the class and nothing else.
 *
 * The left-hand side is not consulted for the class name. CommonJS emit writes
 * `exports.Loyalty = Loyalty = __decorate(…)`, ES emit writes `Loyalty =
 * __decorate(…)`, and both name the class in the call's **second argument**,
 * which is the one thing the two spellings agree on.
 */
export function analyzeEmitted(source: string, file: string): EntityFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: EntityFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && appliedName(node.expression) === '__decorate') {
      const [decorators, target] = node.arguments;
      if (
        node.arguments.length === 2 &&
        decorators !== undefined &&
        ts.isArrayLiteralExpression(decorators) &&
        target !== undefined &&
        ts.isIdentifier(target)
      ) {
        const names = decorators.elements
          .map((element) => appliedName(element))
          .filter((name): name is string => name !== undefined);
        const finding = findingOf(names, target.text, file);
        if (finding !== null) findings.push(finding);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return findings;
}

/**
 * The entity classes a composition **hands the ORM**, as its own artefact
 * declares them.
 *
 * This is the rule's independent second author, and it is the package's own
 * statement rather than this file's guess: `export const entities = [A, B]` is
 * the array the host's merged ORM configuration consumes, so a walk that read
 * fewer classes than the composition declares read a residue of its population
 * and must refuse (`contracts/package-scope-layout.md` §3). Both emit shapes are
 * accepted for the same reason {@link analyzeEmitted} accepts both.
 *
 * A class listed under a computed or spread element is not named here. That is
 * deliberate and it fails **closed**: an unnamed member lowers the covered count
 * and never the expected one, so it turns into a refusal rather than into a
 * class nobody looked for.
 */
export function declaredEntityClasses(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];

  const collect = (array: ts.ArrayLiteralExpression): void => {
    for (const element of array.elements) {
      if (ts.isIdentifier(element)) names.push(element.text);
    }
  };

  const visit = (node: ts.Node): void => {
    // `export const entities = [ … ]`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'entities' &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      collect(node.initializer);
    }
    // `exports.entities = [ … ]`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'entities' &&
      ts.isArrayLiteralExpression(node.right)
    ) {
      collect(node.right);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/**
 * One persisted class as an owner map describes it, in this rule's shape.
 *
 * Structural on purpose: `package-declarations.ts`'s `PackageEntity` satisfies
 * it, so the repository host passes its own record through unchanged and the CLI
 * package takes no dependency on the platform to state the type.
 */
export interface DescribedEntity {
  readonly packageName: string;
  readonly className: string;
  readonly classifications: readonly string[];
  readonly file: string;
}

/**
 * An installed package's entity classes, in the same shape a walk produces
 * (feature 080, T034).
 *
 * The rule is one rule: exactly one classification, whatever the entity arrived
 * in. Keeping the two populations in one shape is what makes that true of the
 * code as well as of the sentence — the counting, the `--list` output and the
 * failure report all run over one array.
 *
 * `file` is the resolved artefact the class was imported from, so the message
 * points at something the reader can open. Exported so a red proof can enter
 * here with a package entity rather than with a finished report.
 */
export function packageEntityFindings(entities: readonly DescribedEntity[]): EntityFinding[] {
  return entities.map((entity) => ({
    file: entity.file,
    className: `${entity.className} (${entity.packageName})`,
    classifications: [...entity.classifications],
  }));
}

/** Every entity class in `files`, parsing only the ones a hint admits. */
export function analyzeEmittedFiles(files: readonly string[]): EntityFinding[] {
  const findings: EntityFinding[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!EMITTED_DECORATE_HINT.test(source)) continue;
    findings.push(...analyzeEmitted(source, file));
  }
  return findings;
}

export interface Classification {
  readonly classified: readonly EntityFinding[];
  readonly unclassified: readonly EntityFinding[];
  readonly multiple: readonly EntityFinding[];
}

/**
 * The analysis, and the only place the predicate is written.
 *
 * `exactly one` is two failures rather than one, and they have different
 * remedies: none means the guard never applies, more than one means nobody can
 * say which guard applies. Reporting them as one kind would hand an author a
 * sentence that is wrong for half the cases.
 */
export function classifyFindings(findings: readonly EntityFinding[]): Classification {
  return {
    classified: findings.filter((finding) => finding.classifications.length === 1),
    unclassified: findings.filter((finding) => finding.classifications.length === 0),
    multiple: findings.filter((finding) => finding.classifications.length > 1),
  };
}

/** The sentence an author reads, per failure kind. One spelling, two hosts. */
export function remedyFor(finding: EntityFinding): string {
  if (finding.classifications.length === 0) {
    return (
      `${finding.className} is a persisted entity carrying no tenant-scope classification, so ` +
      `the global-filter guard never applies to it (Constitution XI). Add exactly one of ` +
      `@${CLASSIFICATION_DECORATOR_NAMES.join(' / @')}.`
    );
  }
  return (
    `${finding.className} carries ${finding.classifications.length} tenant-scope ` +
    `classifications (${finding.classifications.map((name) => `@${name}`).join(', ')}), so which ` +
    `guard applies to it cannot be read off the class. Keep exactly one.`
  );
}
