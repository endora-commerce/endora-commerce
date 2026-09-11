import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { platformSourceRootAt } from '../../scripts/lib/platform-root.js';
import type { MigrationOrigin } from '@endora-commerce/platform/db';

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
 *
 * ## What it does **not** read, and who does (feature 097)
 *
 * Its whole recogniser vocabulary is `ENTITY_TABLE_RE`, `STATEMENT_START_RE`
 * (`create` / `alter table`) and `REFERENCE_RE` (`references "…"`). There is no
 * `insert`, no `update`, no `delete` and no `select` in this file: its subject
 * is **DDL**, which is what a foreign key is.
 *
 * `check-module-boundary.ts`' own header used to tell its next reader that this
 * file "already owns" a migration naming another module's table, and that
 * sentence is the reason 76 cross-module **DML** accesses in 28 migration files
 * were judged by nothing in the repository until feature 097. The correction is
 * two-way deliberately: a one-way fix leaves the reader of *this* file with the
 * same wrong impression from the other side.
 *
 * So: **DML in a migration is `check:module-boundary`'s**, under R1 (a
 * cross-module table reference requires the owner in the declaring module's
 * transitive `dependencies` closure — the rule this file states for foreign
 * keys, with its predicate widened) and R2 (a migration may not write another
 * module's table at all). The regex-only commitment above is why the rule lives
 * there rather than here: reading DML needs `sql-tables.ts`' AST reader, and a
 * regex over source text hallucinated a dozen table names off apostrophes in
 * English prose when it was tried. The transitive closure the two share is
 * `scripts/lib/manifest-dependencies.ts`', extracted from this file's own
 * `closureOf` so the DDL and DML halves of one rule cannot answer differently
 * for one edge.
 *
 * ## Where it looks (feature 080, T013)
 *
 * The scan used to spell `join(sourceRoot, 'modules')` in four places and to
 * treat a directory that was not there as an empty listing. Both are the same
 * defect from opposite ends, and issue #215 is the measurement: a module tree
 * that moves does not empty the walk, it leaves the residue — so every derived
 * map comes back small, every cross-module edge comes back unattributed, and
 * the consumer reports a clean tree.
 *
 * So the roots are a **parameter**, they must resolve, and each one says where
 * the modules under it come from. The origin is not decoration: the baseline
 * block this graph's readers skip is *what the committed sources contribute at
 * or below the watermark*, and the origin is the half of that sentence a stamp
 * cannot express. Until this scan could express one it tested the stamp alone —
 * which D-105 justified and D-106 overruled. A migration stamped inside the
 * baseline window that came from outside the committed registry is placed in
 * the *open* block, and was skipped outright by the position check reading this
 * graph: a false negative on precisely the input that check exists for (D-154).
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

/**
 * A directory whose immediate subdirectories are module directories.
 *
 * `origin` is the same vocabulary `MigrationRegistryEntry.origin` uses, and the
 * type is imported from it rather than restated, so the scan and the ordering
 * algorithm cannot come to disagree about what "core" means.
 */
export interface ModuleRoot {
  /**
   * Absolute or `sourceRoot`-relative directory. It holds one subdirectory per
   * module, unless {@link ModuleRoot.moduleId} says it *is* one module's.
   */
  readonly directory: string;
  /** Where every module under this root comes from. */
  readonly origin: MigrationOrigin;
  /**
   * The one module this directory belongs to, for a root that is a workspace
   * **package** rather than a tree of modules (feature 080, T040b).
   *
   * A package's id is its own `endora.id` declaration and never a path segment
   * (D-142), and its parent directory is not a module root — nothing says a
   * second package has to be its sibling. So the caller names the module, and
   * this file makes no assumption about the layout above it.
   */
  readonly moduleId?: string;
}

/** The one root a bare core checkout has: `<src>/modules`, origin `core`. */
export function coreModuleRoot(sourceRoot: string): ModuleRoot {
  return { directory: join(sourceRoot, 'modules'), origin: 'core' };
}

/** A module directory the walk resolved, and how much of it it read. */
export interface ScannedModule {
  readonly id: string;
  /** Absolute path to the module directory. */
  readonly directory: string;
  readonly origin: MigrationOrigin;
  /** Entity and migration files opened under it — 0 for a module with neither. */
  readonly files: number;
}

/**
 * Raised when the scan cannot read the population it was pointed at.
 *
 * A throw rather than an empty result, for the reason the `check-*` scripts
 * exit 2 rather than 0: "there is nothing here" and "I could not look" produce
 * the same clean report, and only one of them is good news.
 */
export class FkGraphRootError extends Error {
  override readonly name = 'FkGraphRootError';
}

/**
 * A migration file, identified the way the ordering algorithm identifies one.
 *
 * `timestamp` is read from the **filename**, not from the class name. The two
 * cannot diverge: `test/unit/db/migrations-registry.test.ts` derives every
 * registered class name from its filename and fails on a mismatch, so the
 * filename stamp is the class-name stamp
 * (specs/065-manifest-aware-migrations/contracts/naming-convention.md §2).
 * `undefined` means the filename does not parse as a migration — a helper file
 * sharing the directory, which the consumer must report rather than skip.
 */
export interface MigrationSource {
  /** Path relative to the scanned source root, for readable messages. */
  file: string;
  /** `YYYYMMDDTHHmmss` from the filename, or `undefined` if it does not parse. */
  timestamp: string | undefined;
  /** Owning module id — `'core'` for the platform's own `migrations/`. */
  moduleId: string;
  /**
   * The origin of the root this file was found under. `db/migrations/` is
   * `'core'` by definition — it is the committed registry's own group.
   *
   * Carried because baseline membership needs it, and the rule it serves is the
   * **generation** one rather than the runtime one. `migration-order.ts` has no
   * `isBaseline` since 2026-09-06: it enters the frozen prefix by identity,
   * against `BASELINE_MIGRATIONS`
   * (`specs/110-instance-repository/contracts/instance-migration-order.md` R1.1).
   * That list cannot be the predicate here, because this scan's subject is a
   * **file** and the list names registered **classes**. What it can be held to
   * is the rule the list is generated from (R1.3) — the committed sources at or
   * below `BASELINE_THROUGH` — and that is `origin === 'core' && stamp <=
   * BASELINE_THROUGH` exactly. A reader of this graph that tested the stamp
   * alone would agree on every committed file and disagree on precisely the one
   * it is guarding against.
   */
  origin: MigrationOrigin;
}

/**
 * One individual cross-module foreign key, before aggregation into an `FkEdge`,
 * carrying the migration that declares it.
 *
 * The aggregate is what the *declaration* half of the drift check reads; this
 * is what the **position** half reads (feature 081, FR-013), because the answer
 * there depends on where in the emitted order the constraint is created, and
 * aggregating over table pairs throws that away.
 */
export interface FkReference {
  /** Module owning the referencing table. */
  from: string;
  /** Module owning the referenced table. */
  to: string;
  fromTable: string;
  toTable: string;
  /** The migration whose SQL declares this constraint. */
  declaredIn: MigrationSource;
}

export interface FkGraph {
  /** table → owning module id: entity declarations first, then overrides. */
  owners: ReadonlyMap<string, string>;
  /** table → owning module id, from `@Entity({ tableName })` declarations only. */
  entityOwners: ReadonlyMap<string, string>;
  /** Every table named by a `create table` statement in any migration. */
  createdTables: ReadonlySet<string>;
  /**
   * table → the migration that creates it. Where several `create table`
   * statements name one table (`if not exists`, a re-create), the **earliest**
   * by filename stamp wins: that is when the table comes into existence, which
   * is the question the position check asks.
   */
  tableCreators: ReadonlyMap<string, MigrationSource>;
  /** Cross-module edges, sorted by `from` then `to`. */
  edges: readonly FkEdge[];
  /** Every individual cross-module foreign key, with its declaring migration. */
  references: readonly FkReference[];
  /** Created tables that neither an entity nor an override claims. */
  unownedTables: readonly string[];
  /** `"<referencing_table> → <referenced_table>"` where the target has no owner. */
  unresolvedReferences: readonly string[];
  /**
   * Every module directory the walk resolved, by id, with the file count it
   * produced. This is what lets a consumer hold the scan to the population its
   * registry claims — "no **module** files" rather than "no files at all" —
   * instead of asserting that a directory exists and calling that a floor.
   */
  modules: ReadonlyMap<string, ScannedModule>;
}

export interface DeriveFkGraphOptions {
  /** Explicit owners for tables no entity claims (bridge/junction tables). */
  overrides?: Readonly<Record<string, string>>;
  /**
   * Where module directories live. Defaults to the single core root.
   *
   * Every root must resolve: one that is not there is a `FkGraphRootError`,
   * never an empty listing. A root that resolves and holds no module is *not*
   * refused here — that is a population, and whether it is the expected one is
   * a question only the caller's registry can answer.
   */
  moduleRoots?: readonly ModuleRoot[];
  /**
   * The kernel's own source directory, holding the entity classes whose tables
   * core migrations create.
   *
   * Defaults to `<sourceRoot>/kernel`, which is where it was and where every
   * fixture tree still puts it. The real tree passes the platform package's,
   * because the relocation moved those six classes out of `backend/src` and left
   * re-export shims carrying no `@Entity()` — a walk of the shims finds no
   * `tableName` and reports `audit_log_entries`, `module_registrations`,
   * `sales_channels`, `setting_groups`, `setting_values` and `settings` as
   * owned by nobody, and with them every foreign key that points at one.
   */
  kernelRoot?: string;
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

/**
 * Every `.ts` under a directory of the given name, at any depth below `root`.
 *
 * `<module>/entities` and `<module>/migrations` are where an application module
 * keeps them, and they are found at depth 1 here exactly as before. A module
 * **package** keeps its own layout — `src/backend/entities/`,
 * `src/migrations/` — and nothing in the estate spells that (D-141 makes only
 * the *directory name* the id), so the search is by name rather than by
 * position. It is the same predicate `generate-composer.ts` applies to a
 * packaged migration. `dist` is skipped: a built package holds the same files
 * compiled, and reading both would count every entity twice.
 */
export function listTsFilesUnderDirectoriesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      const child = join(dir, entry.name);
      if (entry.name === name) found.push(...listTsFilesRecursive(child));
      else visit(child);
    }
  };
  visit(root);
  return found;
}

/** Rule 1 of contract §2.1 — the module whose entities/ declares the tableName. */
/**
 * The owner id for a table declared by a kernel entity (feature 072). The
 * kernel is not a module: it has no manifest and cannot appear in a
 * `dependencies` array, which is exactly why a foreign key into it needs no
 * declaration — every deployment has the kernel by definition.
 */
export const KERNEL_OWNER = 'kernel';

/**
 * The module directories under every configured root, keyed by id.
 *
 * Two roots claiming one id is refused rather than resolved last-wins: the id
 * is what the manifest graph, the migration group and this scan's ownership map
 * are all keyed by, so a silent winner would move a module's origin — and with
 * it its baseline membership — with nothing saying so.
 */
export function resolveModuleDirectories(
  roots: readonly ModuleRoot[],
): Map<string, ScannedModule> {
  const missing = roots.filter(
    (root) => !existsSync(root.directory) || !statSync(root.directory).isDirectory(),
  );
  if (missing.length > 0) {
    throw new FkGraphRootError(
      `these module roots do not resolve: ${missing.map((root) => root.directory).join(', ')} — ` +
        'the scan would read a residue of the module tree and report a clean graph, which is ' +
        'issue #215; refusing to derive one',
    );
  }

  const resolved = new Map<string, ScannedModule>();
  for (const root of roots) {
    if (root.moduleId !== undefined) {
      const already = resolved.get(root.moduleId);
      if (already !== undefined) {
        throw new FkGraphRootError(
          `module "${root.moduleId}" is claimed by two roots (${already.directory} and ` +
            `${root.directory}) — one of them would silently win, taking its origin with it`,
        );
      }
      resolved.set(root.moduleId, {
        id: root.moduleId,
        directory: root.directory,
        origin: root.origin,
        files: 0,
      });
      continue;
    }
    for (const id of listDirectories(root.directory)) {
      const already = resolved.get(id);
      if (already !== undefined) {
        throw new FkGraphRootError(
          `module "${id}" is claimed by two roots (${already.directory} and ` +
            `${join(root.directory, id)}) — one of them would silently win, taking its ` +
            'origin with it',
        );
      }
      resolved.set(id, {
        id,
        directory: join(root.directory, id),
        origin: root.origin,
        files: 0,
      });
    }
  }
  return resolved;
}

/** One more file read under a module — the count its floor is asserted on. */
function countFile(modules: Map<string, ScannedModule>, id: string): void {
  const scanned = modules.get(id);
  if (scanned !== undefined) modules.set(id, { ...scanned, files: scanned.files + 1 });
}

function collectEntityOwners(
  modules: Map<string, ScannedModule>,
  kernelRoot: string,
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const scanned of [...modules.values()]) {
    for (const file of listTsFilesUnderDirectoriesNamed(scanned.directory, 'entities')) {
      countFile(modules, scanned.id);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ENTITY_TABLE_RE)) {
        owners.set(match[1]!, scanned.id);
      }
    }
  }
  // Feature 072 — entities the kernel absorbed under D-32. Their tables are
  // still created by core migrations; what changed is who owns the class, and
  // the ownership map must follow or the table reads as unclaimed.
  for (const file of listTsFilesRecursive(kernelRoot)) {
    if (!file.endsWith('.entity.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ENTITY_TABLE_RE)) {
      owners.set(match[1]!, KERNEL_OWNER);
    }
  }
  return owners;
}

/**
 * Where the `core` group's migrations are, for a walk rooted at `sourceRoot`.
 *
 * Exported because `migration-tables.ts` walks the same group and two answers
 * to "where are the twelve" is two answers waiting to disagree.
 */
export function coreMigrationDirs(sourceRoot: string): string[] {
  const platformRoot = platformSourceRootAt(resolve(sourceRoot, '..', '..'));
  return [
    join(sourceRoot, 'db', 'migrations'),
    ...(platformRoot === null ? [] : [join(platformRoot, 'migrations')]),
  ];
}

/** contracts/naming-convention.md §1 — the only recognizer any tool may use. */
const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_[a-z0-9_]+\.ts$/;

/**
 * Every migration source file: the `core` group's directories plus each
 * module's.
 *
 * The `core` group has **two** possible homes and both are read, because this
 * walk is driven with a fixture root as often as with the real one. The
 * platform's own `migrations/` is where the twelve live since
 * `specs/110-instance-repository/` T116; `<sourceRoot>/db/migrations` is where
 * they lived before it and is what every fixture in `fk-graph.test.ts` still
 * writes. A directory that is not there contributes nothing, and the real
 * floor is `fk-dependency-drift.test.ts`', which refuses a scan that lost a
 * module — reading both is what keeps that refusal about the tree rather than
 * about which of two layouts the caller is on.
 */
function collectMigrationFiles(
  sourceRoot: string,
  modules: Map<string, ScannedModule>,
): MigrationSource[] {
  const found: { path: string; moduleId: string; origin: MigrationOrigin }[] = coreMigrationDirs(
    sourceRoot,
  ).flatMap((directory) =>
    listTsFilesRecursive(directory).map((path) => ({
      path,
      moduleId: 'core',
      origin: 'core' as const,
    })),
  );
  for (const scanned of [...modules.values()]) {
    for (const path of listTsFilesUnderDirectoriesNamed(scanned.directory, 'migrations')) {
      countFile(modules, scanned.id);
      found.push({ path, moduleId: scanned.id, origin: scanned.origin });
    }
  }
  return found
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, moduleId, origin }) => ({
      file: relative(sourceRoot, path).split('\\').join('/'),
      timestamp: MIGRATION_FILE_RE.exec(basename(path))?.[1],
      moduleId,
      origin,
    }));
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

/**
 * Which of two migrations comes first. A file whose name does not parse has no
 * stamp and never wins: it would put an unclassifiable source in the creators
 * map in place of one the position check can read.
 */
function isEarlier(candidate: MigrationSource, incumbent: MigrationSource): boolean {
  if (candidate.timestamp === undefined) return false;
  if (incumbent.timestamp === undefined) return true;
  return candidate.timestamp < incumbent.timestamp;
}

export function deriveFkGraph(sourceRoot: string, options: DeriveFkGraphOptions = {}): FkGraph {
  const root = resolve(sourceRoot);
  const overrides = options.overrides ?? {};
  const modules = resolveModuleDirectories(
    (options.moduleRoots ?? [coreModuleRoot(root)]).map((moduleRoot) => ({
      ...moduleRoot,
      directory: resolve(root, moduleRoot.directory),
    })),
  );

  const entityOwners = collectEntityOwners(
    modules,
    resolve(root, options.kernelRoot ?? KERNEL_OWNER),
  );
  const owners = new Map(entityOwners);
  for (const [table, moduleId] of Object.entries(overrides)) {
    if (!owners.has(table)) owners.set(table, moduleId);
  }

  const createdTables = new Set<string>();
  const tableCreators = new Map<string, MigrationSource>();
  const rawReferences: { fromTable: string; toTable: string; declaredIn: MigrationSource }[] = [];

  for (const migration of collectMigrationFiles(root, modules)) {
    const source = readFileSync(join(root, migration.file), 'utf8');
    for (const statement of tableStatements(source)) {
      for (const match of statement.body.matchAll(REFERENCE_RE)) {
        rawReferences.push({
          fromTable: statement.table,
          toTable: match[1]!,
          declaredIn: migration,
        });
      }
    }
    for (const match of source.matchAll(STATEMENT_START_RE)) {
      if (match[1]!.toLowerCase() !== 'create') continue;
      const table = match[2]!;
      createdTables.add(table);
      const known = tableCreators.get(table);
      if (known === undefined || isEarlier(migration, known)) {
        tableCreators.set(table, migration);
      }
    }
  }

  const unownedTables = [...createdTables].filter((table) => !owners.has(table)).sort();

  const unresolvedReferences: string[] = [];
  const references: FkReference[] = [];
  const aggregated = new Map<string, { from: string; to: string; count: number; via: string[] }>();

  for (const { fromTable, toTable, declaredIn } of rawReferences) {
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

    references.push({ from, to, fromTable, toTable, declaredIn });

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
    tableCreators,
    edges,
    references,
    unownedTables,
    unresolvedReferences: unresolvedReferences.sort(),
    modules,
  };
}
