/**
 * SQL table identifiers, read out of TypeScript sources through the compiler
 * API (feature 077, D-87).
 *
 * `check-module-boundary.ts` polices one rule — a module does not reach into
 * another module's internals — through two predicates, and this file is the
 * syntax half of the second one. The first predicate reads import specifiers
 * (`lib/specifiers.ts`); a raw `select … from another_module_table` names no
 * specifier at all, compiles, runs, and returns rows.
 *
 * Two extractions live here, and both are deliberately **syntactic only**:
 * ownership is decided by the check, which is the file that knows what a module
 * is.
 *
 *   - {@link sqlTableAccesses} — the table identifiers a source *uses*.
 *   - {@link declaredTableNames} — the table names a source *declares*, from an
 *     `@Entity()` class or from `create table` DDL. Both sources are needed: an
 *     owner map built from entity classes alone maps 220 tables and misses every
 *     join table and every channel bridge, which is 39 of the 157 findings the
 *     D-87 sweep measured — including the one carrying a live defect.
 *
 * ## Why this reads literal **nodes** and never source text
 *
 * The first spike for D-87 was a regex over source text. It hallucinated a dozen
 * tables — `every`, `bumps`, `used`, `path` — because an apostrophe in an
 * English comment opens a string literal that runs to the next apostrophe, and
 * the prose in between parses as SQL often enough to matter. Reading
 * `ts.StringLiteral` / template-literal nodes removes comments from the
 * population by construction rather than by an exclusion someone has to
 * maintain, which is why `sql-in-a-comment` is one of the check's red proofs.
 *
 * ## What a statement has to look like
 *
 * A literal joins the population when it *starts* with `select`, `insert into`,
 * `update`, `delete from` or `with`, **and** carries the rest of that statement's
 * skeleton: a `select` needs a `from`, an `update` needs a `set`, a `with` needs
 * a `select`. The second half is not decoration — `'Update products in the
 * catalog'` is English prose that a start-anchored test alone reads as an
 * `UPDATE` against `products`, and a check that reports it teaches its readers
 * to ignore it.
 */
import ts from 'typescript';

import { pluralize, toSnakeCase } from '../../src/db/pluralizing-naming-strategy.js';

/** Which way the statement moves rows through the table it names. */
export type SqlAccessDirection = 'read' | 'write';

/** One table identifier a SQL literal names, and how it is used. */
export interface SqlTableAccess {
  /** The identifier, lower-cased, schema qualifier stripped. */
  readonly table: string;
  readonly direction: SqlAccessDirection;
  /** 1-based line of the literal that names it. */
  readonly line: number;
  /** The head of the statement, for the failure message. */
  readonly statement: string;
}

/** Where a table name was declared — the two owner-map sources. */
export type TableDeclarationSource = 'entity' | 'migration';

/** One table name a source declares. */
export interface TableDeclaration {
  readonly table: string;
  readonly source: TableDeclarationSource;
}

/**
 * A literal's text, with `${…}` substitutions replaced by a placeholder.
 *
 * A template expression is the common shape for a query with an `in (…)` list
 * built by `ids.map(() => '?').join(',')`; splicing the spans back together
 * keeps every table identifier around the substitution visible, which a
 * `getText()` read would too but with the interpolation source mixed in.
 */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += ` ? ${span.literal.text}`;
    return text;
  }
  return null;
}

/** Every string / template literal in `source`, with its line. */
function literals(source: string, file: string): Array<{ text: string; line: number }> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ text: string; line: number }> = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null) {
      found.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/** `select` / `insert into` / `update` / `delete from` / `with`, at the head. */
const STATEMENT_HEAD = /^\s*(?:--[^\n]*\n|\s)*(select|insert\s+into|update|delete\s+from|with)\b/i;

/**
 * The rest of the skeleton each head needs before the literal is read as SQL.
 *
 * Without this, prose scores: `'Update products in the catalog'` is an `UPDATE`
 * against `catalog`'s `products` table to a start-anchored test.
 */
const STATEMENT_BODY: Readonly<Record<string, RegExp>> = {
  select: /\bfrom\b/i,
  insert: /\binto\b/i,
  update: /\bset\b/i,
  delete: /\bfrom\b/i,
  with: /\bselect\b/i,
};

/**
 * `from` / `join` / `into` / `update` and the identifier after it.
 *
 * The optional `"schema".` prefix is dropped: what decides ownership is the
 * table, and this repository has exactly one schema.
 */
const TABLE_REFERENCE =
  /\b(from|join|into|update)\s+(?:only\s+)?(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** `with x as (…)` — a CTE name is not a table, and may shadow one. */
const CTE_NAME = /\bwith\s+(?:recursive\s+)?([a-z_][a-z0-9_]*)|,\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi;

/** SQL keywords that follow `update` / `into` in shapes that name no table. */
const NOT_A_TABLE = new Set(['set', 'select', 'values', 'only', 'lateral', 'table']);

/**
 * Every table identifier the SQL literals in `source` name.
 *
 * `file` is used for the source-file name the compiler API wants and for line
 * numbers only; nothing here touches disk, so a caller may pass a path that does
 * not exist. That is what lets the check's red proofs enter here, with source
 * text, rather than below with a resolved table list.
 */
export function sqlTableAccesses(source: string, file: string): SqlTableAccess[] {
  const found: SqlTableAccess[] = [];
  for (const literal of literals(source, file)) {
    const head = STATEMENT_HEAD.exec(literal.text);
    if (head === null) continue;
    const verb = (head[1] ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const body = STATEMENT_BODY[verb];
    if (body === undefined || !body.test(literal.text)) continue;

    const bound = new Set<string>();
    for (const match of literal.text.matchAll(CTE_NAME)) {
      const name = match[1] ?? match[2];
      if (name !== undefined) bound.add(name.toLowerCase());
    }

    const statement = literal.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const seen = new Set<string>();
    for (const match of literal.text.matchAll(TABLE_REFERENCE)) {
      const keyword = (match[1] ?? '').toLowerCase();
      const table = (match[2] ?? '').toLowerCase();
      if (table === '' || NOT_A_TABLE.has(table) || bound.has(table)) continue;
      if (seen.has(table)) continue;
      seen.add(table);
      const write =
        keyword === 'into' || keyword === 'update' || (verb === 'delete' && keyword === 'from');
      found.push({
        table,
        direction: write ? 'write' : 'read',
        line: literal.line,
        statement,
      });
    }
  }
  return found;
}

/** `create table "x"` / `create table if not exists x`, inside a SQL literal. */
const CREATE_TABLE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

/**
 * The table names `source` declares, from either owner-map source.
 *
 * An `@Entity()` class declares its `tableName` option, or — for the classes
 * that do not set one — the name `PluralizingNamingStrategy` derives from the
 * class name, imported rather than reimplemented so the two cannot drift.
 * `create table` DDL is read out of the same literal nodes as everything else,
 * so a migration that mentions a table in a comment declares nothing.
 */
export function declaredTableNames(source: string, file: string): TableDeclaration[] {
  const found: TableDeclaration[] = [];
  const seen = new Set<string>();
  const add = (table: string, from: TableDeclarationSource): void => {
    if (seen.has(table)) return;
    seen.add(table);
    found.push({ table, source: from });
  };

  if (source.includes('@Entity')) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && ts.canHaveDecorators(node)) {
        for (const decorator of ts.getDecorators(node) ?? []) {
          const call = decorator.expression;
          if (!ts.isCallExpression(call)) continue;
          if (!ts.isIdentifier(call.expression) || call.expression.text !== 'Entity') continue;
          const declared = entityTableName(call);
          if (declared !== null) add(declared, 'entity');
          else if (node.name) add(pluralize(toSnakeCase(node.name.text)), 'entity');
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  for (const literal of literals(source, file)) {
    for (const match of literal.text.matchAll(CREATE_TABLE)) {
      const table = match[1];
      if (table !== undefined) add(table.toLowerCase(), 'migration');
    }
  }
  return found;
}

/** The `tableName` option of an `@Entity({ … })` call, when it sets one. */
function entityTableName(call: ts.CallExpression): string | null {
  const [argument] = call.arguments;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return null;
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) ? property.name.text : null;
    if (name !== 'tableName') continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
  }
  return null;
}
