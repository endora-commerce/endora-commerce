import { DISCOVERED_MANIFESTS } from '../modules/_lifecycle/manifest-index.generated.js';
import { MIGRATION_REGISTRY } from './migrations-registry.generated.js';
import { orderMigrations, BASELINE_THROUGH, type MigrationOrderDiagnostic } from './migration-order.js';

/**
 * The migration order this platform runs, as a value — with no database in it.
 *
 * `mikro-orm.config.ts` computed this inline and nothing else could read it,
 * because reading it meant importing that config, and **the config captures
 * `DATABASE_URL` at import**: whichever database that variable names when the
 * first import happens is the one the process migrates for the rest of its
 * life. The test harness needs the order *before* it knows which database this
 * run will migrate — issue #289 keys the migration template on it — so the
 * ordering moved here, where it depends on the registry and the manifests and
 * on nothing about a connection.
 *
 * The config imports this module and assigns `MIGRATIONS` verbatim, so there is
 * one ordering rather than a copy of it in the harness.
 *
 * `orderMigrations` throws at import time on a duplicate name, a duplicate
 * per-module timestamp, an unscoped class name or an unknown module id — a
 * loud, actionable boot failure by design. A dependency *cycle* is a
 * diagnostic instead, and reacting to it belongs to the readers: see the
 * comment on the warning loop in `mikro-orm.config.ts`.
 */
const ordered = orderMigrations({
  entries: MIGRATION_REGISTRY,
  moduleDependencies: new Map<string, readonly string[]>([
    ['core', []],
    ...DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  ]),
  baselineThrough: BASELINE_THROUGH,
});

/** Assigned verbatim to `migrations.migrationsList`. */
export const MIGRATIONS = ordered.migrations;

/** The class names, in execution order — what a migrated database records. */
export const MIGRATION_NAMES: readonly string[] = ordered.migrations.map((entry) => entry.name);

export const MIGRATION_ORDER_DIAGNOSTICS: readonly MigrationOrderDiagnostic[] = ordered.diagnostics;
