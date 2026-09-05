import type { MigrationObject } from '@mikro-orm/core';
// The graph walk is the platform's (D-160.11): the lifecycle orchestrator refuses an
// install whose arrival closes a cycle, and the member list it names an operator has to
// be the member list reported here. One implementation is what makes that true.
import {
  moduleDependencyCycles,
  sortComponentsTopologically,
  stronglyConnectedComponents,
} from '../lifecycle/services/dep-graph.js';

/**
 * Computes the order in which migrations are handed to the migrator.
 *
 * Pure by design: no I/O, no clock read, no environment read, and no import
 * from `src/modules/`. It is importable and testable without booting the ORM.
 *
 * The rule is two blocks. A **baseline block** — the migrations named by the
 * platform's published baseline list — is emitted first, in the order that list
 * holds them, exactly as history applied them. Everything else is the
 * **open block**, emitted module by module in a topological order of the
 * module dependency graph, each module's migrations contiguous and ascending
 * by timestamp. So a timestamp orders migrations only **within** their own
 * module, and a manifest's `dependencies` array is the only thing ordering one
 * module's schema against another's — which is what lets a migration arrive
 * from an installed package whose author knows nothing of the host's history.
 *
 * Specified by specs/081-per-module-migration-order/contracts/ — the ordering
 * in `ordering-algorithm.md` (which supersedes the feature-065 contract in
 * whole), the class-name rule it enforces in `migration-identity.md`. The
 * baseline block's membership rule is amended by
 * `specs/110-instance-repository/contracts/instance-migration-order.md`: it is
 * an **identity**, not a stamp and not an origin, so that the same corpus
 * installed from packages orders identically. That contract's §1 is where every
 * obvious alternative — squash, re-stamp, declare a dependency, drop the
 * boundary — is refused with the reason.
 */

/** A migration class as MikroORM instantiates it. */
export type MigrationClass = MigrationObject['class'];

/** Where a registry entry came from. Absent means `'core'`. */
export type MigrationOrigin = 'core' | 'external';

export interface MigrationRegistryEntry {
  /**
   * Owning module id — a `manifest.id` from the resolved manifest index, or
   * the literal 'core' for the cross-cutting migrations in src/db/migrations/.
   */
  moduleId: string;
  /** The migration class. `cls.name` IS the migration name persisted in the DB. */
  cls: MigrationClass;
  /**
   * Absent means `'core'`, so the committed generated registry is untouched. A
   * producer outside it must set `'external'`.
   *
   * **No ordering decision is taken on it** (R1.6). It survives because the
   * acceptance criterion's per-origin template digest reads it and
   * `configured-migrations.ts` reports it — but it once decided membership of
   * the frozen prefix, and that is exactly what made the prefix empty when the
   * modules became packages: `origin` answers *"did this come out of our
   * build"*, which is not the question *"is this one of the migrations whose
   * order is history"*. The second question is answered by
   * {@link OrderMigrationsInput.baseline}, which names them.
   */
  origin?: MigrationOrigin;
}

export type MigrationOrderErrorCode =
  | 'unparsable-name'
  | 'duplicate-name'
  | 'duplicate-timestamp'
  | 'unknown-module'
  | 'unscoped-name';

export class MigrationOrderError extends Error {
  readonly code: MigrationOrderErrorCode;

  constructor(code: MigrationOrderErrorCode, message: string) {
    super(message);
    this.name = 'MigrationOrderError';
    this.code = code;
  }
}

/**
 * The frozen historical prefix boundary. **Closed. Never drained.**
 *
 * Every migration the committed core registry contributed at or before this
 * UTC stamp predates feature 065: it was written, and applied, in the
 * hand-maintained array order of the pre-065 `migrationsList`, and those
 * modules' `dependencies` arrays do not describe the order they actually need
 * — they contradict it in 37 places. Emitting that block in any other order
 * produces one a fresh database cannot apply: measured, not assumed — with the
 * boundary removed, `db:fresh` fails at
 * `Migration20260505T102206AssetsLibraryInit` with `relation "cms_pages" does
 * not exist`, because the graph pulls `assets_library` ahead of `cms`.
 *
 * So it is not "the block we have not corrected yet"; it is "the block whose
 * order is history", and nothing should try to drain it. It cannot grow
 * either: `scripts/new-migration.ts` clamps every scaffolded core stamp past
 * the boundary.
 *
 * **It is a generation-time rule, and no longer a runtime membership test**
 * (`specs/110-instance-repository/contracts/instance-migration-order.md` R1.2).
 * `scripts/new-migration.ts` clamps a scaffolded stamp past it, and
 * `composer:generate` renders the published baseline list out of what the
 * committed core registry contributes at or below it. Nothing asks it at run
 * time, because a stamp is a claim an arriving package can make and a name is
 * not: an entry stamped `20250101T000000` reaches this platform from a registry
 * with the same authority as one of ours, and history is a list of names.
 */
export const BASELINE_THROUGH = '20260801T000000';

export interface OrderMigrationsInput {
  /** Registry entries. Order is irrelevant. */
  entries: readonly MigrationRegistryEntry[];
  /**
   * moduleId → directly declared `dependencies`. Must contain every entry's
   * moduleId. This is the primary ordering input, and no other manifest array
   * is read: nothing else orders one module's migrations against another's.
   */
  moduleDependencies: ReadonlyMap<string, readonly string[]>;
  /**
   * The frozen historical prefix, **by identity**: the migration class names
   * whose order is history, in the order history applied them.
   *
   * Normally `BASELINE_MIGRATIONS`, the list `@endora-commerce/platform`
   * publishes — data about this platform's history, carried to a client by the
   * package that carries the history (R1.5), and generated rather than
   * hand-written (R1.3). A name here that this composition does not supply is
   * simply not emitted, which is what an instance installing a subset of the
   * modules is; the two-way reconciliation that would catch a *wrong* list is a
   * guard over this repository's committed artefacts
   * (`test/unit/db/instance-migration-order.test.ts`), never a throw here.
   */
  baseline: readonly string[];
}

/** What the computation observed and did not refuse. */
export interface MigrationOrderDiagnostic {
  kind: 'module-cycle';
  /** Every member of the strongly connected component, sorted. At least two. */
  modules: readonly string[];
  /** Operator-readable: names the members and says what the order did instead. */
  message: string;
}

export interface MigrationOrderResult {
  /** Assigned verbatim to `migrations.migrationsList`. */
  migrations: MigrationObject[];
  diagnostics: readonly MigrationOrderDiagnostic[];
}

/** The cross-cutting pseudo-module owning src/db/migrations/. */
const CORE_MODULE_ID = 'core';

/** Class-name recognizer — see contracts/migration-identity.md §2. */
const MIGRATION_CLASS_RE = /^Migration(\d{8}T\d{6})[A-Z0-9]/;

interface ParsedMigration {
  name: string;
  timestamp: string;
  moduleId: string;
  origin: MigrationOrigin;
  cls: MigrationClass;
}

/** `orders` → `Orders`, `customer_accounts` → `CustomerAccounts`, `_i18n` → `I18n`. */
function expectedNamePrefix(moduleId: string): string {
  return (moduleId.startsWith('_') ? moduleId.slice(1) : moduleId)
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Rejects a well-formed stamp that names no real instant — month 13, hour 25,
 * 30 February. The round trip is what catches the last one: `Date.UTC` rolls it
 * forward to 2 March rather than refusing it.
 */
function assertRealInstant(name: string, timestamp: string): void {
  const at = (from: number, width: number): number => Number(timestamp.slice(from, from + width));
  const utc = new Date(Date.UTC(at(0, 4), at(4, 2) - 1, at(6, 2), at(9, 2), at(11, 2), at(13, 2)));
  // '2026-08-19T07:48:16.000Z' → '20260819T074816'. The regex bounds the year
  // to four digits, so `toISOString` never takes its extended ±YYYYYY form.
  if (utc.toISOString().replace(/[-:]/g, '').slice(0, 15) !== timestamp) {
    throw new MigrationOrderError(
      'unparsable-name',
      `[migration-order] migration "${name}" carries the timestamp ${timestamp}, ` +
        `which is not a real UTC instant. Fix the class name and the filename.`,
    );
  }
}

/** Step 1 — parse & validate entries. */
function parseEntries(
  entries: readonly MigrationRegistryEntry[],
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): ParsedMigration[] {
  const byName = new Map<string, ParsedMigration>();
  // Keyed by module, not globally: two authors who cannot talk to each other
  // must not have to coordinate stamps, and after Step 5 a stamp orders
  // nothing outside its own module anyway.
  const byModuleStamp = new Map<string, ParsedMigration>();
  const parsed: ParsedMigration[] = [];

  for (const entry of entries) {
    const name = entry.cls.name;
    const match = MIGRATION_CLASS_RE.exec(name);
    if (!match) {
      throw new MigrationOrderError(
        'unparsable-name',
        `[migration-order] migration class "${name}" does not match the naming ` +
          `convention Migration<YYYYMMDDTHHmmss><PascalCaseTail>. See ` +
          `specs/081-per-module-migration-order/contracts/migration-identity.md.`,
      );
    }
    const timestamp = match[1]!;
    assertRealInstant(name, timestamp);

    const duplicateName = byName.get(name);
    if (duplicateName) {
      throw new MigrationOrderError(
        'duplicate-name',
        `[migration-order] migration "${name}" is registered more than once ` +
          `(modules "${duplicateName.moduleId}" and "${entry.moduleId}"). The class ` +
          `name is what \`mikro_orm_migrations\` stores, so it must be globally ` +
          `unique; rename one and regenerate with \`composer:generate\`.`,
      );
    }

    const prefix = expectedNamePrefix(entry.moduleId);
    if (!name.slice(match[0].length - 1).startsWith(prefix)) {
      throw new MigrationOrderError(
        'unscoped-name',
        `[migration-order] migration "${name}" is owned by module "${entry.moduleId}", ` +
          `so it must be named Migration${timestamp}${prefix}…. A class name is ` +
          `scoped by its module, which is what makes it unique across every module ` +
          `the platform can compose — contracts/migration-identity.md §2.`,
      );
    }

    const stampKey = `${entry.moduleId} ${timestamp}`;
    const duplicateStamp = byModuleStamp.get(stampKey);
    if (duplicateStamp) {
      throw new MigrationOrderError(
        'duplicate-timestamp',
        `[migration-order] module "${entry.moduleId}" has two migrations stamped ` +
          `${timestamp}: "${duplicateStamp.name}" and "${name}". Inside one module the ` +
          `timestamp is the whole order; advance one by a whole second (file and class).`,
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
      moduleId: entry.moduleId,
      origin: entry.origin ?? CORE_MODULE_ID,
      cls: entry.cls,
    };
    byName.set(name, migration);
    byModuleStamp.set(stampKey, migration);
    parsed.push(migration);
  }

  return parsed;
}

/**
 * Ascending by timestamp, ties broken by class name — the tiebreak is what
 * keeps the output a pure function of its inputs now that two modules may
 * legally share a stamp.
 */
function chronologically(
  left: { readonly timestamp: string; readonly name: string },
  right: { readonly timestamp: string; readonly name: string },
): number {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1;
  return left.name < right.name ? -1 : 1;
}

/**
 * The frozen prefix as history recorded it, over migration **names**.
 *
 * This is the one derivation of that order in the repository: `composer:generate`
 * renders the published baseline list with it, and the fixtures that drive
 * `orderMigrations` build their own frozen block with it. A second
 * implementation would be free to disagree with the first, and nothing compares
 * two orders that are never computed together.
 *
 * It is a **generation-time** answer and takes the watermark for that reason
 * (R1.2). The result is what {@link orderMigrations} then emits verbatim: the
 * ordering itself asks no question about a stamp.
 */
export function historicalBaselineOrder(
  names: readonly string[],
  baselineThrough: string = BASELINE_THROUGH,
): string[] {
  return names
    .map((name) => {
      const match = MIGRATION_CLASS_RE.exec(name);
      if (!match) {
        throw new MigrationOrderError(
          'unparsable-name',
          `[migration-order] migration class "${name}" does not match the naming ` +
            `convention Migration<YYYYMMDDTHHmmss><PascalCaseTail>, so the frozen ` +
            `historical prefix cannot be derived from it. See ` +
            `specs/081-per-module-migration-order/contracts/migration-identity.md.`,
        );
      }
      return { name, timestamp: match[1]! };
    })
    .filter((migration) => migration.timestamp <= baselineThrough)
    .sort(chronologically)
    .map((migration) => migration.name);
}

/**
 * Step 4 — a stable topological sort of the condensation.
 *
 * **The walk is the platform's** (`sortComponentsTopologically`), for the reason
 * `stronglyConnectedComponents` is: feature 113's demo runner orders modules by
 * the same manifest graph, and its contract says it *"MUST NOT maintain an order
 * of its own"* (§4.1). Two implementations of one order would disagree silently,
 * because nothing compares a demo run's order to a migration run's.
 *
 * What stays here is the `'core'` argument, which is this file's alone: `'core'`
 * declares nothing and nothing declares it, so it is always ready at the start,
 * every module's tables sit downstream of the bootstrap tables, and saying so
 * beats relying on an accident of alphabetical ordering.
 */
function sortComponents(
  components: readonly string[][],
  neighboursOf: (id: string) => readonly string[],
): string[][] {
  return sortComponentsTopologically(components, neighboursOf, CORE_MODULE_ID);
}

/** Step 3 — the ordering graph of a module dependency map, and its components. */
function orderingGraph(moduleDependencies: ReadonlyMap<string, readonly string[]>): {
  components: string[][];
  neighboursOf: (id: string) => readonly string[];
} {
  const nodes = [...moduleDependencies.keys()];
  if (!moduleDependencies.has(CORE_MODULE_ID)) nodes.push(CORE_MODULE_ID);
  // Edges to ids absent from the map are skipped; a *migration* claiming such
  // a module is rejected by Step 1 instead.
  const neighboursOf = (id: string): readonly string[] =>
    (moduleDependencies.get(id) ?? []).filter((dependency) => moduleDependencies.has(dependency));
  return { components: stronglyConnectedComponents(nodes, neighboursOf), neighboursOf };
}

/** A component of more than one module is a cycle, and is reported, never thrown. */
function cycleDiagnostics(components: readonly string[][]): MigrationOrderDiagnostic[] {
  return components
    .filter((members) => members.length > 1)
    .map((members) => ({
      kind: 'module-cycle' as const,
      modules: members,
      message:
        `[migration-order] modules [${members.join(', ')}] declare a dependency cycle. ` +
        `Their migrations are emitted as one block in timestamp order, because the ` +
        `declarations contain no order. Fix the \`dependencies\` array in one of them.`,
    }));
}

/**
 * Every dependency cycle in a module graph, in the same shape and wording
 * `orderMigrations` reports — one strongly connected component of more than
 * one module per diagnostic, members sorted.
 *
 * Two of the diagnostic's three readers are here: `test/unit/db/module-graph.test.ts`,
 * which fails the build on a cycle in the committed manifests, and the ORM
 * configuration, which warns at boot and keeps serving. The third is the
 * `_lifecycle` orchestrator, which refuses an install whose arrival closes a
 * cycle — the one moment where refusing costs nothing (081 FR-012).
 *
 * **The walk itself is the platform's** (D-160.11): the orchestrator reads
 * `moduleDependencyCycles` directly rather than this wrapper, because it lives
 * in `@endora-commerce/platform` and this file is the host application's. Three
 * reactions, one graph walk — the split is the point, and what keeps a second
 * walk from being free to disagree with this one is that there is only one.
 * What is added here is the *wording*, which is the migration order's own.
 */
export function findModuleCycles(
  moduleDependencies: ReadonlyMap<string, readonly string[]>,
): readonly MigrationOrderDiagnostic[] {
  return cycleDiagnostics(moduleDependencyCycles(moduleDependencies));
}

export function orderMigrations(input: OrderMigrationsInput): MigrationOrderResult {
  const { entries, moduleDependencies, baseline: baselineNames } = input;
  const parsed = parseEntries(entries, moduleDependencies);

  const { components, neighboursOf } = orderingGraph(moduleDependencies);

  // Reported, never thrown: the graph is the primary ordering now, so a throw
  // would mean a stranger's manifest can stop a shop's own schema from
  // migrating. The readers want different reactions — a red unit test
  // (`test/unit/db/module-graph.test.ts`), a `warn` at boot, and the lifecycle
  // refusing an install that closes a loop (FR-012) — and none of them belongs
  // in a pure function.
  const diagnostics = cycleDiagnostics(components);

  // Step 2 — baseline membership, by **identity**. The published list is
  // ordered and that order is history's, so the block is emitted as the list
  // holds it rather than as a comparator recomputes it: a comparator that ever
  // disagreed with the list would make the artefact a lie, and this way there
  // is nothing for it to disagree with. A listed name this composition does not
  // supply is simply absent — that is an instance installing a subset.
  const baselinePosition = new Map(baselineNames.map((name, index) => [name, index] as const));
  const baseline: ParsedMigration[] = [];
  const openByModule = new Map<string, ParsedMigration[]>();
  for (const migration of parsed) {
    if (baselinePosition.has(migration.name)) {
      baseline.push(migration);
      continue;
    }
    const bucket = openByModule.get(migration.moduleId);
    if (bucket) bucket.push(migration);
    else openByModule.set(migration.moduleId, [migration]);
  }
  baseline.sort((left, right) => baselinePosition.get(left.name)! - baselinePosition.get(right.name)!);

  // Step 5 — the open block, component by component, contiguous. A
  // multi-module component has no internal order to respect, so its members'
  // migrations are merged and emitted chronologically across the whole block:
  // the baseline block's rule, applied locally.
  const open: ParsedMigration[] = [];
  for (const members of sortComponents(components, neighboursOf)) {
    const owned = members.flatMap((member) => openByModule.get(member) ?? []);
    open.push(...owned.sort(chronologically));
  }

  return {
    migrations: [...baseline, ...open].map((migration) => ({
      name: migration.name,
      class: migration.cls,
    })),
    diagnostics,
  };
}
