import { DISCOVERED_MANIFESTS } from '../modules/_lifecycle/manifest-index.generated.js';
import { MIGRATION_REGISTRY } from './migrations-registry.generated.js';
import {
  orderMigrations,
  BASELINE_THROUGH,
  type MigrationOrderDiagnostic,
  type MigrationOrigin,
} from './migration-order.js';

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

/** A migration this platform runs, and which producer contributed it. */
export interface RegisteredMigration {
  /** The class name — what `mikro_orm_migrations` records. */
  readonly name: string;
  readonly origin: MigrationOrigin;
}

const REGISTRY_BY_NAME = new Map(
  MIGRATION_REGISTRY.map((entry) => [entry.cls.name, entry] as const),
);

/**
 * The ordered set with each entry's origin — the order plus the one fact that
 * says which producer a migration came from.
 *
 * The origin is not decoration: the test harness floors its migration-template
 * digest **per origin** (`test/template-identity.ts`), because a floor over one
 * total lets a producer whose files the harness cannot read be absorbed by
 * another producer's surplus. `MigrationObject` carries a name and a class and
 * cannot carry this, so it is read back off the registry the order was computed
 * from — and a name that is in the order but not in that registry is refused
 * rather than defaulted, because a guessed origin is the same silent slack one
 * layer down.
 */
export const REGISTERED_MIGRATIONS: readonly RegisteredMigration[] = ordered.migrations.map(
  (migration) => {
    const entry = REGISTRY_BY_NAME.get(migration.name);
    if (entry === undefined) {
      throw new Error(
        `[configured-migrations] "${migration.name}" is in the migration order but not in the ` +
          `registry that order was computed from, so nothing here can say which producer it ` +
          `came from. Whoever merges a second producer's migrations into this order must merge ` +
          `their registry entries too — the test harness floors its template digest per origin.`,
      );
    }
    return { name: migration.name, origin: entry.origin ?? 'core' };
  },
);

/** The class names, in execution order — what a migrated database records. */
export const MIGRATION_NAMES: readonly string[] = REGISTERED_MIGRATIONS.map(
  (migration) => migration.name,
);

export const MIGRATION_ORDER_DIAGNOSTICS: readonly MigrationOrderDiagnostic[] = ordered.diagnostics;
