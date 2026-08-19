import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { ALL_ENTITIES } from './entities-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../modules/_lifecycle/manifest-index.generated.js';
import { MIGRATION_REGISTRY } from './migrations-registry.generated.js';
import { orderMigrations, BASELINE_THROUGH } from './migration-order.js';

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
 *   file in the owning module's migrations/ dir and regenerating — never here.
 * - Both registries stay explicit static-import lists rather than a filesystem
 *   glob: glob discovery needs runtime dynamic `import()` of .ts files, which
 *   Node's ESM loader cannot transform and which breaks under Vitest. Since
 *   feature 071's F2 the lists are *emitted* from a filesystem walk by
 *   scripts/generate-composer.ts and committed, so they are static imports
 *   nobody maintains by hand. The "registered ⇔ on-disk" round-trip is enforced
 *   by test/unit/db/migrations-registry.test.ts, and `overlay:check` fails on a
 *   committed artefact that drifted from the tree.
 * - Execution order is computed by ./migration-order.ts: a frozen historical
 *   prefix, then module by module in a topological order of the manifest
 *   dependency graph, each module's migrations contiguous and ascending by
 *   timestamp. See docs/docs/architecture/migrations.md.
 */

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

const moduleDependencies = new Map<string, readonly string[]>([
  ['core', []],
  ...DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
]);

// Throws at import time on a duplicate name, a duplicate per-module timestamp,
// an unscoped class name or an unknown module id — a loud, actionable boot
// failure by design.
const { migrations: migrationsList, diagnostics } = orderMigrations({
  entries: MIGRATION_REGISTRY,
  moduleDependencies,
  baselineThrough: BASELINE_THROUGH,
});

// A dependency cycle is a diagnostic, not a throw: the graph is the primary
// ordering now, so refusing here would let one mis-declared manifest stop the
// whole platform's schema from migrating. Nothing in this file branches on it —
// test/unit/db/module-graph.test.ts fails the build on a cycle in this
// repository, which is the only refusal that exists today. The install-time
// refusal for a cycle arriving from a package is FR-012 and is not yet built.
for (const diagnostic of diagnostics) {
  console.warn(diagnostic.message);
}

export default defineConfig({
  clientUrl: databaseUrl,
  namingStrategy: PluralizingNamingStrategy,
  // Explicit class list, not a glob — glob discovery requires runtime dynamic
  // `import()` of .ts files, which Node's ESM loader cannot transform and which
  // breaks under Vitest. See src/db/entities-registry.generated.ts for the
  // rationale and for what emits it.
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
