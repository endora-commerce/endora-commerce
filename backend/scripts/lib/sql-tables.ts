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
 *   - {@link sqlTableAccesses} — the table identifiers a source *uses*, through
 *     two recognition paths: a **statement** literal, and a knex query
 *     **builder** (issue #187).
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
 *
 * ## What a builder has to look like (issue #187)
 *
 * A knex builder names its table as an **argument to a call**, so no statement
 * literal exists to anchor on:
 *
 * ```ts
 * await knexForStock('warehouse_channel_assignments as a')
 *   .join('warehouses as w', 'w.id', 'a.warehouse_id')
 * ```
 *
 * Both tables are `inventory`'s, read from inside `orders`' placement
 * transaction, and both predicates were blind to them — the import predicate
 * because a builder names no specifier, the statement path because there is no
 * statement. **Ten** such accesses, in six files, stood outside a `sql=111` that
 * read as the whole coupling, which is exactly the "`violations=0` licenses a
 * package split the tree has not earned" failure D-87 exists to end. The grep
 * that raised the issue found seven; the three it missed are the aliasing object
 * form (`knex({ p: 'products' })`) and two reaches into **kernel** tables, which
 * is the argument for reading nodes rather than grepping a spelling.
 *
 * Two shapes are recognised, and the population is bounded twice over — by the
 * argument position and by the check's table→owner map, which only knows real
 * tables:
 *
 *   - **{@link TABLE_ARGUMENT_METHODS}** — a string literal in the *first*
 *     argument of `from`, `into`, `table` or a member of the join family. The
 *     list is enumerated rather than "any string on any builder method" because
 *     `where('status', …)`, `select('id')` and `orderBy(…)` take **columns**: a
 *     column spelled like another module's table would flood the ledger and the
 *     check would be switched off. Only the first argument is read, because
 *     `join(table, first, second)`'s remaining arguments are column references.
 *   - **the knex callable itself** — `knex('products')`, which starts 36 of the
 *     tree's 43 builder queries over a known table and which is not a method
 *     call at all.
 *     Its callee carries no name to key on, so the identifier must be **bound to
 *     a `getKnex()` result in the same file**; nothing else opens that door.
 *
 * The method list is receiver-agnostic on purpose. `Array.prototype.join` and
 * `path.join` share the `join` spelling, and the tree calls the first 238 times;
 * what keeps them out is that their arguments (`', '`, a path segment) are not
 * table names in the owner map. The alternative — requiring every builder chain
 * to root syntactically in a knex binding — would refuse them by construction
 * but go **silently** blind on the builder held in a variable or taken as a
 * parameter, which `catalog-admin.service.ts` and `promotion-stats-service.ts`
 * both do. A spelling collision is a visible finding a reader resolves; a
 * receiver rule is a miss nobody sees, and this file's whole reason for existing
 * is that the second kind of failure is the expensive one.
 */
import ts from 'typescript';

import { pluralize, toSnakeCase } from '../../src/db/pluralizing-naming-strategy.js';

/** Which way the statement moves rows through the table it names. */
export type SqlAccessDirection = 'read' | 'write';

/**
 * Which recognition path named the table — a SQL statement literal, or a knex
 * query builder (issue #187).
 *
 * Carried on the finding so a red proof can assert the path it is testing: a
 * builder proof that only checked the table would go green off the statement
 * path, which is how a new signal goes blind behind an existing one's red
 * (issue #130).
 */
export type SqlAccessSyntax = 'statement' | 'builder';

/** One table identifier a SQL literal or a query builder names. */
export interface SqlTableAccess {
  /** The identifier, lower-cased, alias and schema qualifier stripped. */
  readonly table: string;
  readonly direction: SqlAccessDirection;
  readonly syntax: SqlAccessSyntax;
  /** 1-based line of the literal that names it. */
  readonly line: number;
  /** The head of the statement, or of the builder chain, for the message. */
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

/**
 * The source, parsed with parent pointers.
 *
 * The parents are what let the builder path walk a call chain outwards to decide
 * whether it writes; the statement path needs only the positions.
 */
function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** Every string / template literal in `sf`, with its line. */
function literals(sf: ts.SourceFile): Array<{ text: string; line: number }> {
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
 * Every table identifier `source` names, through either recognition path.
 *
 * `file` is used for the source-file name the compiler API wants and for line
 * numbers only; nothing here touches disk, so a caller may pass a path that does
 * not exist. That is what lets the check's red proofs enter here, with source
 * text, rather than below with a resolved table list.
 */
export function sqlTableAccesses(source: string, file: string): SqlTableAccess[] {
  const sf = parse(source, file);
  const found = [...statementAccesses(sf), ...builderAccesses(sf)];
  found.sort((a, b) => a.line - b.line);
  return found;
}

/** The tables named inside a SQL statement literal — D-87's original path. */
function statementAccesses(sf: ts.SourceFile): SqlTableAccess[] {
  const found: SqlTableAccess[] = [];
  for (const literal of literals(sf)) {
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
        syntax: 'statement',
        line: literal.line,
        statement,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The knex query builder (issue #187)
// ---------------------------------------------------------------------------

/**
 * Builder methods whose **first** argument names a table.
 *
 * Enumerated, and this is the list the header argues for: `where`, `select`,
 * `orderBy`, `count` and the rest take **columns**, so matching any string
 * literal on any builder method would report a column spelled like another
 * module's table and the ledger would fill with noise. The tree calls four of
 * these today (`from`, `join`, `leftJoin`, `innerJoin`); the other join variants
 * are the same knex surface, and leaving one out would make the day somebody
 * writes `rightJoin` the day the check goes quietly blind.
 */
const TABLE_ARGUMENT_METHODS = new Set([
  'from',
  'into',
  'table',
  'join',
  'innerJoin',
  'leftJoin',
  'leftOuterJoin',
  'rightJoin',
  'rightOuterJoin',
  'fullOuterJoin',
  'crossJoin',
]);

/**
 * Builder methods that move rows, anywhere in the chain the table is named in.
 *
 * `into` is here as well as in {@link TABLE_ARGUMENT_METHODS} because
 * `knex.insert(rows).into('x')` names the table on the write method itself.
 */
const WRITE_METHODS = new Set([
  'insert',
  'update',
  'delete',
  'del',
  'upsert',
  'truncate',
  'increment',
  'decrement',
  'into',
]);

/**
 * `em.getKnex()`, `em.getConnection().getKnex()`, `this.emFactory().getKnex()`.
 *
 * Exported because `check-transaction-context` refuses the same handle for a
 * different reason (issue #200: it carries no transaction context), and two
 * copies of "what a knex handle looks like" would drift — the receiver is
 * spelled at least three ways in this tree already.
 */
export function isGetKnexCall(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'getKnex'
  );
}

/**
 * The identifiers this file binds to a knex instance.
 *
 * The knex callable is `knex('products')` — a call whose callee carries no
 * method name to key on — so the only structural evidence available is the
 * binding, and the tree writes exactly one shape for it — a `const` initialised
 * from a `getKnex()` call, 32 times: `knex` in 30 of them, `knexForStock` and
 * `knexEmpty` in the other two. Keying on the binding rather than on the
 * identifier's spelling keeps the rule a property of the code and not of what
 * somebody named a variable.
 */
function knexBindings(sf: ts.SourceFile): Set<string> {
  const bound = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isGetKnexCall(node.initializer)
    ) {
      bound.add(node.name.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bound;
}

/** The table a builder argument names, or `null` when it names no table. */
function builderTableName(text: string): string | null {
  // `'warehouses as w'` — knex's alias form, and the one `order-service.ts`
  // writes. Everything after the alias keyword belongs to the alias.
  const withoutAlias = text.split(/\s+as\s+/i)[0] ?? '';
  const bare = withoutAlias.trim().replace(/^"(.*)"$/, '$1');
  // `"public".products` / `w.id` — the qualifier is dropped for the same reason
  // the statement path drops it: this repository has one schema, and what is
  // left of a column reference (`id`) is not a table name in the owner map.
  const unqualified = bare.includes('.') ? (bare.split('.').pop() ?? '') : bare;
  const table = unqualified.toLowerCase();
  return /^[a-z_][a-z0-9_]*$/.test(table) ? table : null;
}

/** Every table a call argument names: a string literal, or an alias object's values. */
function tableArguments(argument: ts.Expression | undefined): string[] {
  if (argument === undefined) return [];
  const text = ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : null;
  if (text !== null) {
    const table = builderTableName(text);
    return table === null ? [] : [table];
  }
  // `knex({ p: 'products' })` — the alias is the key and the table is the value.
  if (!ts.isObjectLiteralExpression(argument)) return [];
  const tables: string[] = [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isStringLiteral(property.initializer)) continue;
    const table = builderTableName(property.initializer.text);
    if (table !== null) tables.push(table);
  }
  return tables;
}

/**
 * The outermost call chain `node` sits in.
 *
 * `knex('x').where(…).update(…)` is one expression, and the write method can sit
 * on either side of the table: `update` follows it and `insert` precedes it in
 * `knex.insert(rows).into('x')`. Walking out to the whole chain and then reading
 * every method name in it answers both without a rule per shape.
 */
function outermostChain(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return current;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) current = parent;
    else if (ts.isCallExpression(parent) && parent.expression === current) current = parent;
    else return current;
  }
}

/** Whether any method in the chain moves rows. */
function chainWrites(chain: ts.Node): boolean {
  let writes = false;
  const visit = (node: ts.Node): void => {
    if (writes) return;
    if (ts.isPropertyAccessExpression(node) && WRITE_METHODS.has(node.name.text)) writes = true;
    node.forEachChild(visit);
  };
  visit(chain);
  return writes;
}

/** Every table a knex query builder in `sf` names. */
function builderAccesses(sf: ts.SourceFile): SqlTableAccess[] {
  const bound = knexBindings(sf);
  const found: SqlTableAccess[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // A table-taking builder method, or the knex callable itself. Either way
      // only the **first** argument is read: `join(table, first, second)`'s
      // remaining arguments are column references.
      const namesATable =
        (ts.isPropertyAccessExpression(callee) && TABLE_ARGUMENT_METHODS.has(callee.name.text)) ||
        (ts.isIdentifier(callee) && bound.has(callee.text)) ||
        isGetKnexCall(callee);
      const named = namesATable ? tableArguments(node.arguments[0]) : [];
      if (named.length > 0) {
        const chain = outermostChain(node);
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const statement = chain.getText(sf).replace(/\s+/g, ' ').trim().slice(0, 80);
        const direction: SqlAccessDirection = chainWrites(chain) ? 'write' : 'read';
        for (const table of named) {
          found.push({ table, direction, syntax: 'builder', line, statement });
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
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

  const sf = parse(source, file);
  if (source.includes('@Entity')) {
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

  for (const literal of literals(sf)) {
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
