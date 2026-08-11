import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { ALL_ENTITIES } from './entities-registry.js';
import { DISCOVERED_MANIFESTS } from '../modules/_lifecycle/manifest-index.generated.js';
import { MIGRATION_REGISTRY } from './migrations-registry.js';
import { orderMigrations, UNCORRECTED_THROUGH } from './migration-order.js';

/**
 * MikroORM configuration for the B2B platform backend.
 *
 * - PostgreSQL driver (constitutional stack).
 * - Plural snake_case table names + snake_case columns (Principle VI) via the
 *   custom naming strategy in ./pluralizing-naming-strategy.ts (R-04).
 * - Migration ownership is module-local: each module keeps its migration files
 *   under src/modules/<module>/migrations/. Only the few genuinely cross-cutting
 *   bootstrap migrations (foundation/commerce init, module-lifecycle, tenant
 *   indexes) live in src/db/migrations/. Adding a migration means dropping a
 *   file in the owning module's migrations/ dir and adding one import + entry
 *   in ./migrations-registry.ts — never here.
 * - The registry stays an explicit static-import list rather than a filesystem
 *   glob: glob discovery needs runtime dynamic `import()` of .ts files, which
 *   Node's ESM loader cannot transform and which breaks under Vitest (same
 *   reason entities are listed in ./entities-registry.ts). The
 *   "registered ⇔ on-disk" round-trip is enforced by
 *   test/unit/db/migrations-registry.test.ts.
 * - Execution order is computed by ./migration-order.ts from each migration's
 *   UTC timestamp, corrected by the module-manifest dependency graph. See
 *   docs/docs/architecture/migrations.md.
 */

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

/** A dependency inversion is corrected only within this many days (feature 065). */
const CORRECTION_HORIZON_DAYS = 45;

const moduleDependencies = new Map<string, readonly string[]>([
  ['core', []],
  ...DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
]);

// Throws at import time on a cycle, a duplicate timestamp or an unknown module
// id — a loud, actionable boot failure by design.
const migrationsList = orderMigrations({
  entries: MIGRATION_REGISTRY,
  moduleDependencies,
  uncorrectedThrough: UNCORRECTED_THROUGH,
  correctionHorizonDays: CORRECTION_HORIZON_DAYS,
});

export default defineConfig({
  clientUrl: databaseUrl,
  namingStrategy: PluralizingNamingStrategy,
  // Explicit class list, not a glob — glob discovery requires runtime dynamic
  // `import()` of .ts files, which Node's ESM loader cannot transform and which
  // breaks under Vitest. See src/db/entities-registry.ts for the rationale.
  entities: [...ALL_ENTITIES],
  debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
  allowGlobalContext: false,
  forceUndefined: true,
  extensions: [Migrator],
  migrations: {
    migrationsList,
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
