import type { MigrationObject } from '@mikro-orm/core';

/**
 * Computes the order in which migrations are handed to the migrator.
 *
 * Pure by design: no I/O, no clock read, no environment read, and no import
 * from `src/modules/`. It is importable and testable without booting the ORM.
 *
 * The rule is two blocks. A **baseline block** — everything the committed core
 * registry contributed at or before `BASELINE_THROUGH` — is emitted first, in
 * plain timestamp order, exactly as history applied it. Everything else is the
 * **open block**, emitted module by module in a topological order of the
 * module dependency graph, each module's migrations contiguous and ascending
 * by timestamp. So a timestamp orders migrations only **within** their own
 * module, and a manifest's `dependencies` array is the only thing ordering one
 * module's schema against another's — which is what lets a migration arrive
 * from an installed package whose author knows nothing of the host's history.
 *
 * Specified by specs/081-per-module-migration-order/contracts/ — the ordering
 * in `ordering-algorithm.md` (which supersedes the feature-065 contract in
 * whole), the class-name rule it enforces in `migration-identity.md`.
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
   * producer outside it must set `'external'`: the baseline block is a claim
   * about *our* history, and an entry that lies about its origin joins a
   * prefix it has no business in.
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
 * It is a **position** boundary only — renaming a class changes nothing here —
 * and membership takes two conditions, `origin === 'core'` and the stamp. See
 * `isBaseline` for why the stamp alone is not enough.
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
  /** The frozen historical prefix boundary — normally `BASELINE_THROUGH`. */
  baselineThrough: string;
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
function chronologically(left: ParsedMigration, right: ParsedMigration): number {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1;
  return left.name < right.name ? -1 : 1;
}

/**
 * Step 2 — baseline membership. **Both conditions are required.** The stamp
 * alone lets an entry produced outside the committed registry join a prefix
 * whose order is historical fact: measured, a package migration stamped
 * `20250101T000000` is emitted at index 0, ahead of the platform's own
 * foundation migration. The origin alone would freeze nothing, since it is
 * `'core'` for every committed entry.
 */
function isBaseline(migration: ParsedMigration, baselineThrough: string): boolean {
  return migration.origin === CORE_MODULE_ID && migration.timestamp <= baselineThrough;
}

/**
 * Step 3 — strongly connected components of the ordering graph (Tarjan).
 * Iterative, never recursive: a large graph must not be able to blow the
 * stack. The condensation built from the result is acyclic by construction,
 * which is what makes Step 4 always succeed.
 */
function stronglyConnectedComponents(
  nodes: readonly string[],
  neighboursOf: (id: string) => readonly string[],
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const discover = (id: string): void => {
    index.set(id, counter);
    lowLink.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    discover(root);
    // `edge` is how far through the node's neighbour list the walk has got.
    const work: { id: string; edge: number }[] = [{ id: root, edge: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbours = neighboursOf(frame.id);
      if (frame.edge < neighbours.length) {
        const next = neighbours[frame.edge]!;
        frame.edge += 1;
        if (!index.has(next)) {
          discover(next);
          work.push({ id: next, edge: 0 });
        } else if (onStack.has(next)) {
          lowLink.set(frame.id, Math.min(lowLink.get(frame.id)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) break;
        }
        components.push(component.sort());
      }
      const parent = work[work.length - 1];
      if (parent) lowLink.set(parent.id, Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!));
    }
  }

  return components;
}

/**
 * Step 4 — a stable topological sort of the condensation. Kahn's algorithm,
 * the ready set drained by the smallest module id in the component — except
 * that the component holding `'core'` is drained first whenever it is ready
 * (`''` sorts below every module id). `'core'` declares nothing and nothing
 * declares it, so it is always ready at the start; every module's tables sit
 * downstream of the bootstrap tables, and saying so beats relying on an
 * accident of alphabetical ordering. It always succeeds: the condensation is
 * acyclic, so the ready set cannot empty early, and there is no unresolvable
 * order.
 */
function sortComponents(
  components: readonly string[][],
  neighboursOf: (id: string) => readonly string[],
): string[][] {
  const componentOf = new Map<string, number>();
  components.forEach((members, position) => {
    for (const member of members) componentOf.set(member, position);
  });

  const successors: number[][] = components.map(() => []);
  const indegree = components.map(() => 0);
  components.forEach((members, position) => {
    for (const member of members) {
      for (const dependency of neighboursOf(member)) {
        // The edge means "my migrations follow theirs", so the dependency's
        // component is emitted first: the arrow in the sort points at us. A
        // repeated edge is counted twice on both sides and cancels out.
        const target = componentOf.get(dependency);
        if (target === undefined || target === position) continue;
        successors[target]!.push(position);
        indegree[position]! += 1;
      }
    }
  });

  const coreComponent = componentOf.get(CORE_MODULE_ID);
  const sortKey = (position: number): string =>
    position === coreComponent ? '' : components[position]![0]!;

  const ready = components.map((_, position) => position).filter((p) => indegree[p] === 0);
  const ordered: string[][] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (sortKey(left) < sortKey(right) ? -1 : 1));
    const next = ready.shift()!;
    ordered.push(components[next]!);
    for (const successor of successors[next]!) {
      indegree[successor]! -= 1;
      if (indegree[successor] === 0) ready.push(successor);
    }
  }

  return ordered;
}

export function orderMigrations(input: OrderMigrationsInput): MigrationOrderResult {
  const { entries, moduleDependencies, baselineThrough } = input;
  const parsed = parseEntries(entries, moduleDependencies);

  const nodes = [...moduleDependencies.keys()];
  if (!moduleDependencies.has(CORE_MODULE_ID)) nodes.push(CORE_MODULE_ID);
  // Edges to ids absent from the map are skipped; a *migration* claiming such
  // a module is rejected by Step 1 instead.
  const neighboursOf = (id: string): readonly string[] =>
    (moduleDependencies.get(id) ?? []).filter((dependency) => moduleDependencies.has(dependency));
  const components = stronglyConnectedComponents(nodes, neighboursOf);

  // Reported, never thrown: the graph is the primary ordering now, so a throw
  // would mean a stranger's manifest can stop a shop's own schema from
  // migrating. The readers want different reactions — a red unit test
  // (`test/unit/db/module-graph.test.ts`), a `warn` at boot, and eventually the
  // lifecycle refusing an install that closes a loop (FR-012, not yet built) —
  // and none of them belongs in a pure function.
  const diagnostics: MigrationOrderDiagnostic[] = components
    .filter((members) => members.length > 1)
    .map((members) => ({
      kind: 'module-cycle' as const,
      modules: members,
      message:
        `[migration-order] modules [${members.join(', ')}] declare a dependency cycle. ` +
        `Their migrations are emitted as one block in timestamp order, because the ` +
        `declarations contain no order. Fix the \`dependencies\` array in one of them.`,
    }));

  const baseline: ParsedMigration[] = [];
  const openByModule = new Map<string, ParsedMigration[]>();
  for (const migration of parsed) {
    if (isBaseline(migration, baselineThrough)) {
      baseline.push(migration);
      continue;
    }
    const bucket = openByModule.get(migration.moduleId);
    if (bucket) bucket.push(migration);
    else openByModule.set(migration.moduleId, [migration]);
  }
  baseline.sort(chronologically);

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
