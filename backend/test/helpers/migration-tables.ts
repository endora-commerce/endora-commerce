import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deriveFkGraph, KERNEL_OWNER } from './fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from '../unit/db/table-owner-overrides.js';

/**
 * Which tables each migration writes to, and which of those the kernel owns.
 *
 * Feature 072 T020. `ModuleLifecycleOrchestrator.revertMigrationsFor()` picks
 * the migrations to revert by `MIGRATION_REGISTRY` entry `moduleId`, so a
 * migration filed under a module reverts when that module is hard-uninstalled
 * — whatever table it actually touches. A migration that creates or alters a
 * kernel-owned table must therefore be filed under `core`, or uninstalling an
 * ordinary module drops schema the kernel depends on.
 *
 * node:fs + regex only, in the same style as ./fk-graph.ts, and with the same
 * constraint: this is a test-tree artifact with no runtime path.
 */

/** `create table "x"` / `alter table if exists "x"` — the statement head. */
const TABLE_STATEMENT_RE =
  /\b(?:create|alter)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?"([a-z0-9_]+)"/gi;

/** contracts/naming-convention.md §1 — the only recognizer any tool may use. */
const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

export interface MigrationTables {
  /** Migration class name — the name `mikro_orm_migrations` stores. */
  className: string;
  /** Owning group: a module id, or 'core' for src/db/migrations/. */
  groupId: string;
  /** Path relative to backend/, for readable failure messages. */
  relativePath: string;
  /** Every table named by a `create table` / `alter table` statement head. */
  tables: ReadonlySet<string>;
}

function classNameFromFile(filename: string): string {
  const [, stamp, tail] = MIGRATION_FILE_RE.exec(filename)!;
  const pascal = tail!
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${stamp}${pascal}`;
}

function listMigrationFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((name) => MIGRATION_FILE_RE.test(name));
}

/** Every migration on disk, with the tables its SQL writes to. */
export function collectMigrationTables(sourceRoot: string): MigrationTables[] {
  const groups: { dir: string; groupId: string; prefix: string }[] = [
    { dir: join(sourceRoot, 'db', 'migrations'), groupId: 'core', prefix: 'src/db/migrations' },
  ];
  const modulesRoot = join(sourceRoot, 'modules');
  if (existsSync(modulesRoot)) {
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      groups.push({
        dir: join(modulesRoot, entry.name, 'migrations'),
        groupId: entry.name,
        prefix: `src/modules/${entry.name}/migrations`,
      });
    }
  }

  const collected: MigrationTables[] = [];
  for (const group of groups) {
    for (const filename of listMigrationFiles(group.dir)) {
      const source = readFileSync(join(group.dir, filename), 'utf8');
      const tables = new Set<string>();
      for (const match of source.matchAll(TABLE_STATEMENT_RE)) tables.add(match[1]!);
      collected.push({
        className: classNameFromFile(filename),
        groupId: group.groupId,
        relativePath: `${group.prefix}/${filename}`,
        tables,
      });
    }
  }
  return collected.sort((left, right) => (left.className < right.className ? -1 : 1));
}

/** The tables whose schema the kernel owns — resolved, never hand-listed. */
export function kernelOwnedTables(sourceRoot: string): ReadonlySet<string> {
  const graph = deriveFkGraph(sourceRoot, { overrides: TABLE_OWNER_OVERRIDES });
  const owned = new Set<string>();
  for (const [table, owner] of graph.owners) {
    if (owner === KERNEL_OWNER) owned.add(table);
  }
  return owned;
}
