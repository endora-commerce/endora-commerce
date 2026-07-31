import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Static derivation of the cross-module foreign-key graph from migration SQL.
 *
 * Specified by
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §2.
 *
 * This is a **test-tree artifact with no runtime path** (FR-043): nothing under
 * backend/src/ may import it, and it does not influence orderMigrations(), the
 * ORM config, or the shipped bundle.
 *
 * It reads migration SQL rather than entity metadata because this codebase
 * models foreign keys as scalar uuid columns: a handful of relation decorators
 * exist across 185 entities, so entity metadata would see almost nothing. See
 * research §R12.
 *
 * node:fs + regex only — no new dependency, no ORM import, no database.
 */

/** One cross-module foreign-key edge, aggregated over every table pair. */
export interface FkEdge {
  /** Module owning the referencing table. */
  from: string;
  /** Module owning the referenced table. */
  to: string;
  /** How many individual foreign keys this edge aggregates. */
  count: number;
  /** `"<referencing_table> → <referenced_table>"` pairs, for diagnostics. */
  via: readonly string[];
}

export interface FkGraph {
  /** table → owning module id: entity declarations first, then overrides. */
  owners: ReadonlyMap<string, string>;
  /** table → owning module id, from `@Entity({ tableName })` declarations only. */
  entityOwners: ReadonlyMap<string, string>;
  /** Every table named by a `create table` statement in any migration. */
  createdTables: ReadonlySet<string>;
  /** Cross-module edges, sorted by `from` then `to`. */
  edges: readonly FkEdge[];
  /** Created tables that neither an entity nor an override claims. */
  unownedTables: readonly string[];
  /** `"<referencing_table> → <referenced_table>"` where the target has no owner. */
  unresolvedReferences: readonly string[];
}

export interface DeriveFkGraphOptions {
  /** Explicit owners for tables no entity claims (bridge/junction tables). */
  overrides?: Readonly<Record<string, string>>;
}

/** `tableName: 'products'` in an @Entity decorator. */
const ENTITY_TABLE_RE = /tableName:\s*'([a-z0-9_]+)'/g;

/**
 * Start of a table-scoped SQL statement. Statement scoping is mandatory: an
 * un-scoped `references` regex over whole files produced phantom edges from
 * prose and from unrelated SQL (contract §2.2, case D5).
 */
const STATEMENT_START_RE = /\b(create|alter)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?"([a-z0-9_]+)"/gi;

/** `references "organizations"`, inline or inside an add-constraint clause. */
const REFERENCE_RE = /\breferences\s+"([a-z0-9_]+)"/gi;

function listDirectories(path: string): string[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function listTsFilesRecursive(path: string): string[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...listTsFilesRecursive(child));
    else if (entry.name.endsWith('.ts')) found.push(child);
  }
  return found;
}

/** Rule 1 of contract §2.1 — the module whose entities/ declares the tableName. */
function collectEntityOwners(sourceRoot: string): Map<string, string> {
  const owners = new Map<string, string>();
  for (const moduleId of listDirectories(join(sourceRoot, 'modules'))) {
    for (const file of listTsFilesRecursive(join(sourceRoot, 'modules', moduleId, 'entities'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ENTITY_TABLE_RE)) {
        owners.set(match[1]!, moduleId);
      }
    }
  }
  return owners;
}

/** Every migration source file: module-scoped directories plus src/db/migrations/. */
function collectMigrationFiles(sourceRoot: string): string[] {
  const files = listTsFilesRecursive(join(sourceRoot, 'db', 'migrations'));
  for (const moduleId of listDirectories(join(sourceRoot, 'modules'))) {
    files.push(...listTsFilesRecursive(join(sourceRoot, 'modules', moduleId, 'migrations')));
  }
  return files.sort();
}

interface TableStatement {
  table: string;
  body: string;
}

/**
 * Several migrations assemble one SQL statement from concatenated template
 * literals (`` `alter table … ` + `foreign key … references "x" …;` ``). The
 * backtick pair is TypeScript glue, not a statement boundary, so it is removed
 * before scoping — otherwise 20 real foreign keys are silently invisible.
 */
const TEMPLATE_CONCATENATION_RE = /`\s*\+\s*`/g;

/**
 * Splits a migration source into table-scoped statement bodies.
 *
 * A body runs from the statement head to the first statement terminator: a
 * semicolon, a backtick (each addSql call is its own template literal), or the
 * head of the next create/alter table statement.
 */
export function tableStatements(rawSource: string): TableStatement[] {
  const source = rawSource.replace(TEMPLATE_CONCATENATION_RE, '');
  const heads: { table: string; end: number }[] = [];
  for (const match of source.matchAll(STATEMENT_START_RE)) {
    heads.push({ table: match[2]!, end: match.index + match[0].length });
  }

  return heads.map((head, index) => {
    const nextHeadStart = index + 1 < heads.length ? heads[index + 1]!.end : source.length;
    const slice = source.slice(head.end, nextHeadStart);
    const terminator = slice.search(/[;`]/);
    return {
      table: head.table,
      body: terminator === -1 ? slice : slice.slice(0, terminator),
    };
  });
}

export function deriveFkGraph(sourceRoot: string, options: DeriveFkGraphOptions = {}): FkGraph {
  const root = resolve(sourceRoot);
  const overrides = options.overrides ?? {};

  const entityOwners = collectEntityOwners(root);
  const owners = new Map(entityOwners);
  for (const [table, moduleId] of Object.entries(overrides)) {
    if (!owners.has(table)) owners.set(table, moduleId);
  }

  const createdTables = new Set<string>();
  const references: { fromTable: string; toTable: string }[] = [];

  for (const file of collectMigrationFiles(root)) {
    const source = readFileSync(file, 'utf8');
    for (const statement of tableStatements(source)) {
      for (const match of statement.body.matchAll(REFERENCE_RE)) {
        references.push({ fromTable: statement.table, toTable: match[1]! });
      }
    }
    for (const match of source.matchAll(STATEMENT_START_RE)) {
      if (match[1]!.toLowerCase() === 'create') createdTables.add(match[2]!);
    }
  }

  const unownedTables = [...createdTables].filter((table) => !owners.has(table)).sort();

  const unresolvedReferences: string[] = [];
  const aggregated = new Map<string, { from: string; to: string; count: number; via: string[] }>();

  for (const { fromTable, toTable } of references) {
    const from = owners.get(fromTable);
    const to = owners.get(toTable);
    if (to === undefined) {
      const label = `${fromTable} → ${toTable}`;
      if (!unresolvedReferences.includes(label)) unresolvedReferences.push(label);
      continue;
    }
    // A referencing table with no resolved owner is already reported as unowned;
    // guessing its module would fabricate an edge.
    if (from === undefined || from === to) continue;

    const key = `${from}|${to}`;
    const existing = aggregated.get(key);
    const label = `${fromTable} → ${toTable}`;
    if (existing) {
      existing.count += 1;
      if (!existing.via.includes(label)) existing.via.push(label);
    } else {
      aggregated.set(key, { from, to, count: 1, via: [label] });
    }
  }

  const edges = [...aggregated.values()]
    .map((edge) => ({ ...edge, via: [...edge.via].sort() }))
    .sort((left, right) =>
      left.from === right.from
        ? left.to.localeCompare(right.to)
        : left.from.localeCompare(right.from),
    );

  return {
    owners,
    entityOwners,
    createdTables,
    edges,
    unownedTables,
    unresolvedReferences: unresolvedReferences.sort(),
  };
}
