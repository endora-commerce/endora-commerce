import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  coreMigrationDirs,
  coreModuleRoot,
  deriveFkGraph,
  KERNEL_OWNER,
  listTsFilesUnderDirectoriesNamed,
  resolveModuleDirectories,
  type ModuleRoot,
} from './fk-graph.js';
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
  /** Owning group: a module id, or 'core' for the platform's own `migrations/`. */
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

/**
 * Every migration on disk, with the tables its SQL writes to.
 *
 * The module roots are the ones `deriveFkGraph` resolves (feature 080, T013),
 * so this walk and the ownership map it is compared against read the same
 * tree — and a root that is not there is refused by that resolution rather
 * than read as "this repository ships no module migration".
 */
export function collectMigrationTables(
  sourceRoot: string,
  moduleRoots: readonly ModuleRoot[] = [coreModuleRoot(sourceRoot)],
): MigrationTables[] {
  // Both homes of the `core` group, for `coreMigrationDirs`' own reason: the
  // twelve moved into the platform package with T116 and every fixture here
  // still writes them under `<sourceRoot>/db/migrations`.
  const files: { path: string; groupId: string }[] = coreMigrationDirs(sourceRoot).flatMap(
    (directory) =>
      listMigrationFiles(directory).map((name) => ({
        path: join(directory, name),
        groupId: 'core',
      })),
  );

  for (const [id, scanned] of resolveModuleDirectories(moduleRoots)) {
    // Found by **directory name**, at any depth — the same predicate
    // `deriveFkGraph` applies (D-141). An application module keeps its
    // migrations at `<module>/migrations/` and a package at `<pkg>/src/
    // migrations/`; joining the literal `migrations` finds the first and
    // silently none of the second, which took this walk from 158 files to 92
    // over feature 080's first three batches while the ownership rule below
    // went unasked for every packaged module.
    for (const path of listTsFilesUnderDirectoriesNamed(scanned.directory, 'migrations')) {
      if (MIGRATION_FILE_RE.test(basename(path))) files.push({ path, groupId: id });
    }
  }

  const collected: MigrationTables[] = files.map(({ path, groupId }) => {
    const source = readFileSync(path, 'utf8');
    const tables = new Set<string>();
    for (const match of source.matchAll(TABLE_STATEMENT_RE)) tables.add(match[1]!);
    return {
      className: classNameFromFile(basename(path)),
      groupId,
      relativePath: relative(join(sourceRoot, '..'), path).split('\\').join('/'),
      tables,
    };
  });
  return collected.sort((left, right) => (left.className < right.className ? -1 : 1));
}

/** The tables whose schema the kernel owns — resolved, never hand-listed. */
export function kernelOwnedTables(
  sourceRoot: string,
  moduleRoots: readonly ModuleRoot[] = [coreModuleRoot(sourceRoot)],
  /**
   * Where the kernel's entity classes are. The relocation moved them into
   * `@endora-commerce/platform`; `<sourceRoot>/kernel` holds re-export shims
   * with no `@Entity()`, so the default would resolve an empty kernel table set
   * — which `kernel-migration-ownership.test.ts` refuses as a silent empty scan.
   */
  kernelRoot: string = join(sourceRoot, '..', '..', 'packages', 'platform', 'src', 'kernel'),
): ReadonlySet<string> {
  const graph = deriveFkGraph(sourceRoot, {
    overrides: TABLE_OWNER_OVERRIDES,
    moduleRoots,
    kernelRoot,
  });
  const owned = new Set<string>();
  for (const [table, owner] of graph.owners) {
    if (owner === KERNEL_OWNER) owned.add(table);
  }
  return owned;
}
