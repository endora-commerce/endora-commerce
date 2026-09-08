/**
 * `./db` — the ORM configuration, the migration ordering and the bootstrap,
 * and the platform's twelfth subpath (`specs/110-instance-repository/` T116,
 * FR-013).
 *
 * ## What is on it
 *
 * Everything between a committed registry and an open `MikroORM`: the naming
 * strategy Principle VI is enforced by, the order a migration corpus runs in,
 * the two merges that fold an installed package's entities and migrations into
 * the committed core ones, the configuration itself, the cached bootstrap and
 * the four migration verbs.
 *
 * It reads no artefact. The two committed registries and the generated manifest
 * index are facts about *one repository's tree* (D-160.3, D-104), so they arrive
 * as parameters — R7.4, FR-014, the pattern `registered-manifests.ts` took one
 * directory over. What is left in `backend/src/db/` is exactly that supply: the
 * generated files themselves, five bindings that hand them over, and the
 * `migrate.ts` entry point four `package.json` scripts name.
 *
 * ## Why the platform carries it
 *
 * A client's schema is the platform's, not the client's: the tables, the order
 * they are created in and the strategy that names their columns are what makes
 * an installed module's migration apply cleanly, and a tree that could edit any
 * of them is a tree whose next `pnpm update` is a merge. `../migrations/`
 * carries the platform's own twelve migrations for the same reason and is the
 * other half of this answer.
 *
 * ## Why no module may name it
 *
 * D-160.14's third state, for `./composition`'s own reason. This is the code
 * that decides which entity classes the ORM registers and which migrations run
 * at all, so a module that could name it could configure — and eventually
 * re-order — its siblings' schema. It is declared by the `exports` map and
 * carried by no published barrel, so `node` and `tsc` resolve it for the host
 * and the test kit, and `check:platform-surface` answers a module's reach into
 * it with `host-internal-subpath`. A module reaches its own schema through its
 * own `./migrations` subpath and its entities through `./backend`; neither
 * needs this one.
 *
 * The barrel names every symbol explicitly rather than re-exporting a
 * directory: `check:platform-surface` exits 2 on an `export *`, because a
 * wildcard makes the published set a property of whatever the files happen to
 * declare rather than of a decision anybody took.
 */

export {
  PluralizingNamingStrategy,
  pluralize,
  toSnakeCase,
} from './pluralizing-naming-strategy.js';

export {
  BASELINE_THROUGH,
  findModuleCycles,
  historicalBaselineOrder,
  MigrationOrderError,
  orderMigrations,
  type MigrationClass,
  type MigrationOrderDiagnostic,
  type MigrationOrderErrorCode,
  type MigrationOrderResult,
  type MigrationOrigin,
  type MigrationRegistryEntry,
  type OrderMigrationsInput,
} from './migration-order.js';

export {
  configuredEntitiesFrom,
  type ConfiguredEntity,
  type EntityConfigurationInputs,
} from './configured-entities.js';

export {
  committedMigrationOwnership,
  committedModuleDependencies,
  configuredMigrationsFrom,
  discoverConfiguredMigrations,
  migrationOwnershipOf,
  CORE_MODULE_ID,
  type ConfiguredMigrations,
  type CoreMigrationSources,
  type MigrationOwnership,
  type RegisteredMigration,
} from './configured-migrations.js';

export {
  mikroOrmConfigFrom,
  type OrmConfigurationInputs,
} from './mikro-orm.config.js';

export { createOrmBootstrap, type OrmBootstrap } from './orm.js';

export { runMigrationCommand, type MigrationCommandIo } from './migrate.js';
