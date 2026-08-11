import type { MigrationObject } from '@mikro-orm/core';

/**
 * Computes the order in which migrations are handed to the migrator.
 *
 * Pure by design: no I/O, no clock read, no environment read, and no import
 * from `src/modules/`. It is importable and testable without booting the ORM.
 *
 * The algorithm, its invariants and its error codes are specified in
 * specs/065-manifest-aware-migrations/contracts/ordering-algorithm.md; the
 * migration naming rule it parses is specified in
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md.
 * Feature 072 retired that contract's `frozenOrder` input, its
 * `frozen-boundary` error code and the rename map behind them: no migration
 * class name is fixed any more, only the emitted order of the pre-065 block.
 *
 * Accepted limitation (contract §4): a migration added later, inside the
 * correction horizon, MAY change the relative order of two migrations that
 * some databases have already applied. That is harmless for those databases —
 * umzug filters applied migrations out of `pending` regardless of list
 * position — and fresh databases are covered by the CI backend job, which
 * applies the whole chain to an empty database.
 */

/** A migration class as MikroORM instantiates it. */
export type MigrationClass = MigrationObject['class'];

export interface MigrationRegistryEntry {
  /**
   * Owning module id — a `manifest.id` from the resolved manifest index, or
   * the literal 'core' for the cross-cutting migrations in src/db/migrations/.
   */
  moduleId: string;
  /** The migration class. `cls.name` IS the migration name persisted in the DB. */
  cls: MigrationClass;
}

export type MigrationOrderErrorCode =
  | 'unparsable-name'
  | 'duplicate-name'
  | 'duplicate-timestamp'
  | 'unknown-module'
  | 'module-cycle'
  | 'unresolvable-order';

export class MigrationOrderError extends Error {
  readonly code: MigrationOrderErrorCode;

  constructor(code: MigrationOrderErrorCode, message: string) {
    super(message);
    this.name = 'MigrationOrderError';
    this.code = code;
  }
}

/**
 * Everything at or before this UTC stamp is emitted in plain chronological
 * order and is never dependency-corrected.
 *
 * These migrations predate feature 065: they were written, and applied, in the
 * hand-maintained array order of the pre-065 `migrationsList`, and their
 * modules' `dependencies` arrays do not describe the order they actually need.
 * Correcting them produces an order a fresh database cannot apply — measured,
 * not assumed: with the watermark removed, `db:fresh` fails at
 * `Migration20260505T102206AssetsLibraryInit` with `relation "cms_pages" does
 * not exist`, because the correction pulls `assets_library` ahead of `cms`.
 *
 * It is a **position** watermark only. Migration class names are free to
 * change: renaming one — as feature 072 T020 did when it moved the kernel's
 * migrations into the core group — changes nothing here.
 *
 * `scripts/new-migration.ts` clamps every scaffolded stamp past this
 * watermark, so no new migration ever lands in the uncorrected block.
 */
export const UNCORRECTED_THROUGH = '20260801T000000';

export interface OrderMigrationsInput {
  /** Registry entries. Order is irrelevant. */
  entries: readonly MigrationRegistryEntry[];
  /** moduleId → directly declared dependency ids. Must contain every entry's moduleId. */
  moduleDependencies: ReadonlyMap<string, readonly string[]>;
  /** Everything at or before this 'YYYYMMDDTHHmmss' stamp keeps chronological order. */
  uncorrectedThrough: string;
  /** A dependency inversion is corrected only within this many days. */
  correctionHorizonDays: number;
}

/** The cross-cutting pseudo-module owning src/db/migrations/. */
const CORE_MODULE_ID = 'core';

/** Class-name recognizer — see contracts/naming-convention.md §2. */
const MIGRATION_CLASS_RE = /^Migration(\d{8}T\d{6})[A-Z0-9]/;

const MS_PER_DAY = 86_400_000;

interface ParsedMigration {
  name: string;
  timestamp: string;
  epochMs: number;
  moduleId: string;
  cls: MigrationClass;
}

function parseTimestamp(name: string, timestamp: string): number {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(9, 11));
  const minute = Number(timestamp.slice(11, 13));
  const second = Number(timestamp.slice(13, 15));
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(epochMs);
  const sameInstant =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day &&
    roundTrip.getUTCHours() === hour &&
    roundTrip.getUTCMinutes() === minute &&
    roundTrip.getUTCSeconds() === second;
  if (!sameInstant) {
    throw new MigrationOrderError(
      'unparsable-name',
      `[migration-order] migration "${name}" carries the timestamp ${timestamp}, ` +
        `which is not a real UTC instant. Fix the class name and the filename.`,
    );
  }
  return epochMs;
}

/** Step 1 — parse & validate entries. */
function parseEntries(
  entries: readonly MigrationRegistryEntry[],
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): ParsedMigration[] {
  const byName = new Map<string, ParsedMigration>();
  const byTimestamp = new Map<string, ParsedMigration>();
  const parsed: ParsedMigration[] = [];

  for (const entry of entries) {
    const name = entry.cls.name;
    const match = MIGRATION_CLASS_RE.exec(name);
    if (!match) {
      throw new MigrationOrderError(
        'unparsable-name',
        `[migration-order] migration class "${name}" does not match the naming ` +
          `convention Migration<YYYYMMDDTHHmmss><PascalCaseTail>. See ` +
          `specs/065-manifest-aware-migrations/contracts/naming-convention.md.`,
      );
    }
    const timestamp = match[1]!;
    const epochMs = parseTimestamp(name, timestamp);

    const duplicateName = byName.get(name);
    if (duplicateName) {
      throw new MigrationOrderError(
        'duplicate-name',
        `[migration-order] migration "${name}" is registered more than once ` +
          `(modules "${duplicateName.moduleId}" and "${entry.moduleId}"). ` +
          `Remove the duplicate entry from src/db/migrations-registry.ts.`,
      );
    }

    const duplicateStamp = byTimestamp.get(timestamp);
    if (duplicateStamp) {
      throw new MigrationOrderError(
        'duplicate-timestamp',
        `[migration-order] duplicate migration timestamp ${timestamp}: ` +
          `"${duplicateStamp.name}" and "${name}". Advance one of them by a ` +
          `whole second (rename the file and the class).`,
      );
    }

    if (entry.moduleId !== CORE_MODULE_ID && !moduleDependencies.has(entry.moduleId)) {
      throw new MigrationOrderError(
        'unknown-module',
        `[migration-order] migration "${name}" declares the unknown owning ` +
          `module "${entry.moduleId}". Add the module's manifest and run ` +
          `\`pnpm --filter backend run manifest-index:generate\`.`,
      );
    }

    const migration: ParsedMigration = {
      name,
      timestamp,
      epochMs,
      moduleId: entry.moduleId,
      cls: entry.cls,
    };
    byName.set(name, migration);
    byTimestamp.set(timestamp, migration);
    parsed.push(migration);
  }

  return parsed;
}

/**
 * Step 2 — module-graph cycle detection.
 *
 * Iterative three-colour DFS (never recursive: a large graph must not be able
 * to blow the stack). Edges pointing at ids absent from the map are skipped;
 * a migration claiming such a module is rejected by Step 1 instead.
 */
function assertAcyclic(moduleDependencies: ReadonlyMap<string, readonly string[]>): void {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of moduleDependencies.keys()) colour.set(id, WHITE);

  for (const root of moduleDependencies.keys()) {
    if (colour.get(root) !== WHITE) continue;
    const path: string[] = [];
    // `enter` distinguishes the descend step from the post-visit pop.
    const stack: { id: string; enter: boolean }[] = [{ id: root, enter: true }];

    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (!frame.enter) {
        colour.set(frame.id, BLACK);
        path.pop();
        continue;
      }
      if (colour.get(frame.id) === BLACK) continue;
      colour.set(frame.id, GREY);
      path.push(frame.id);
      stack.push({ id: frame.id, enter: false });

      for (const dependency of moduleDependencies.get(frame.id) ?? []) {
        if (!moduleDependencies.has(dependency)) continue;
        if (colour.get(dependency) === GREY) {
          const start = path.indexOf(dependency);
          const cycle = [...path.slice(start), dependency].join(' → ');
          throw new MigrationOrderError(
            'module-cycle',
            `[migration-order] cycle in module dependency graph: [${cycle}]. ` +
              `Fix the \`dependencies\` array in one of those modules' manifest.ts.`,
          );
        }
        if (colour.get(dependency) === WHITE) {
          stack.push({ id: dependency, enter: true });
        }
      }
    }
  }
}

/** Step 3 — memoized transitive closure of the module graph. */
function buildClosures(
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, ReadonlySet<string>> {
  const closures = new Map<string, ReadonlySet<string>>();

  const closureOf = (moduleId: string): ReadonlySet<string> => {
    const cached = closures.get(moduleId);
    if (cached) return cached;
    const reachable = new Set<string>();
    const stack = [...(moduleDependencies.get(moduleId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === moduleId || reachable.has(next)) continue;
      reachable.add(next);
      stack.push(...(moduleDependencies.get(next) ?? []));
    }
    closures.set(moduleId, reachable);
    return reachable;
  };

  for (const moduleId of moduleDependencies.keys()) closureOf(moduleId);
  return closures;
}

/** Steps 6-7 — edge construction over the open set, then a stable topological sort. */
function orderOpen(
  open: readonly ParsedMigration[],
  closures: ReadonlyMap<string, ReadonlySet<string>>,
  horizonMs: number,
): ParsedMigration[] {
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const migration of open) {
    successors.set(migration.name, []);
    indegree.set(migration.name, 0);
  }

  const addEdge = (from: ParsedMigration, to: ParsedMigration): void => {
    successors.get(from.name)!.push(to.name);
    indegree.set(to.name, indegree.get(to.name)! + 1);
  };

  // E1 — intra-module chronology: consecutive pairs are enough, the transitive
  // constraint follows from the topological sort.
  const byModule = new Map<string, ParsedMigration[]>();
  for (const migration of open) {
    const bucket = byModule.get(migration.moduleId);
    if (bucket) bucket.push(migration);
    else byModule.set(migration.moduleId, [migration]);
  }
  for (const bucket of byModule.values()) {
    for (let index = 1; index < bucket.length; index += 1) {
      addEdge(bucket[index - 1]!, bucket[index]!);
    }
  }

  // E2 — dependency inversion, bounded by the correction horizon.
  for (const a of open) {
    for (const b of open) {
      if (a.timestamp <= b.timestamp) continue;
      if (a.moduleId === b.moduleId) continue;
      if (!closures.get(b.moduleId)?.has(a.moduleId)) continue;
      if (a.epochMs - b.epochMs > horizonMs) continue;
      addEdge(a, b);
    }
  }

  // Kahn's algorithm with a ready set drained smallest-timestamp first.
  const byName = new Map(open.map((migration) => [migration.name, migration]));
  const ready = open.filter((migration) => indegree.get(migration.name) === 0);
  const ordered: ParsedMigration[] = [];

  while (ready.length > 0) {
    ready.sort((left, right) => (left.timestamp < right.timestamp ? -1 : 1));
    const next = ready.shift()!;
    ordered.push(next);
    for (const successorName of successors.get(next.name) ?? []) {
      const remaining = indegree.get(successorName)! - 1;
      indegree.set(successorName, remaining);
      if (remaining === 0) ready.push(byName.get(successorName)!);
    }
  }

  if (ordered.length !== open.length) {
    const emitted = new Set(ordered.map((migration) => migration.name));
    const residual = open
      .filter((migration) => !emitted.has(migration.name))
      .map((migration) => migration.name);
    throw new MigrationOrderError(
      'unresolvable-order',
      `[migration-order] could not order these migrations — the correction ` +
        `edges form a cycle: ${residual.join(', ')}.`,
    );
  }

  return ordered;
}

export function orderMigrations(input: OrderMigrationsInput): MigrationObject[] {
  const { entries, moduleDependencies, uncorrectedThrough, correctionHorizonDays } = input;

  const parsed = parseEntries(entries, moduleDependencies);
  assertAcyclic(moduleDependencies);
  const closures = buildClosures(moduleDependencies);

  // Step 4 — base order. Timestamps are unique, so this is a total order.
  const base = [...parsed].sort((left, right) => (left.timestamp < right.timestamp ? -1 : 1));

  // Step 5 — split at the correction watermark. The prefix keeps the
  // chronological order it was written and applied in; only the suffix is
  // dependency-corrected. Names play no part: the split is by timestamp.
  const uncorrected = base.filter((migration) => migration.timestamp <= uncorrectedThrough);
  const open = base.filter((migration) => migration.timestamp > uncorrectedThrough);

  const openOrdered = orderOpen(open, closures, correctionHorizonDays * MS_PER_DAY);

  return [...uncorrected, ...openOrdered].map((migration) => ({
    name: migration.name,
    class: migration.cls,
  }));
}
