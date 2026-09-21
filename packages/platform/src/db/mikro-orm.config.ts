import { defineConfig, type Options } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { OrgWriteGuardSubscriber } from '../tenancy/org-write-guard.js';
import type { ConfiguredEntity } from './configured-entities.js';
import type { ConfiguredMigrations } from './configured-migrations.js';

/**
 * MikroORM configuration for an Endora platform.
 *
 * - PostgreSQL driver (constitutional stack).
 * - Plural snake_case table names + snake_case columns (Principle VI) via the
 *   custom naming strategy in ./pluralizing-naming-strategy.ts (R-04).
 * - Migration ownership is module-local: each module keeps its migration files
 *   under its own `migrations/` directory. The few genuinely cross-cutting
 *   bootstrap migrations (foundation/commerce init, module-lifecycle, tenant
 *   indexes) are the platform's own and live in `../migrations/`. Adding a
 *   migration means dropping a file in the owning module's migrations/ dir and
 *   regenerating — never here.
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
 *
 * ## It takes its inputs and reads no artefact (`specs/110-instance-repository/` R7.4)
 *
 * Both committed registries are **bare core**, and stay that way: an installed
 * extension package may ship entities and migrations (D-106.2), but which
 * packages an instance installed is a fact about the process rather than about
 * the tree, so the committed artefacts must not claim to know (D-119, confirmed
 * as D-155). The package half is therefore discovered at runtime by
 * `configured-entities.ts` and `configured-migrations.ts`, and the host hands
 * the merged result in here. `backend/src/db/mikro-orm.config.ts` is the
 * binding: it holds the async factory, the memoisation and the fourteen callers
 * — all three facts about one process — and this file is the configuration
 * itself, which is the platform's. `DATABASE_URL`, `NODE_ENV` and `DB_DEBUG`
 * are the exception and stay a `process.env` read here; see {@link databaseUrl}.
 */

/** What {@link mikroOrmConfigFrom} needs from the host. */
export interface OrmConfigurationInputs {
  /** The merged entity set — `configuredEntitiesFrom`'s answer. */
  readonly entities: readonly ConfiguredEntity[];
  /** The merged execution order — `configuredMigrations`' answer. */
  readonly migrations: ConfiguredMigrations;
}

/**
 * Read off `process.env` directly, and deliberately not through an injected
 * environment.
 *
 * `check:env-inputs` reconciles the platform's declared inputs against the
 * `process.env` and `import.meta.env` reads its walk can see, so a value
 * reached through a parameter is a declared input nothing reads — measured on
 * this file when T116 moved it: `DATABASE_URL` and `DB_DEBUG` both reported
 * `unread-input`, which is an operator being asked for a value that changes
 * nothing. Which database a process talks to is a fact about that process, so
 * reading it here is also the honest shape.
 */
const databaseUrl = (): string =>
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

export function mikroOrmConfigFrom(inputs: OrmConfigurationInputs): Options {
  // A dependency cycle is a diagnostic, not a throw: the graph is the primary
  // ordering now, so refusing here would let one mis-declared manifest stop
  // the whole platform's schema from migrating — and since a manifest can
  // arrive from an installed package, that manifest may be a stranger's.
  // Nothing in this file branches on it — warning is the whole reaction, and
  // the platform boots and serves. The other two readers refuse instead, each
  // where refusing costs nothing: test/unit/db/module-graph.test.ts fails the
  // build on a cycle in the committed manifests, and the _lifecycle
  // orchestrator refuses an install whose arrival closes one (FR-012).
  // test/unit/db/migration-order-boot-warning.test.ts is the proof that this
  // warning fires on a cycle and is silent without one.
  for (const diagnostic of inputs.migrations.diagnostics) {
    console.warn(diagnostic.message);
  }

  return defineConfig({
    clientUrl: databaseUrl(),
    namingStrategy: PluralizingNamingStrategy,
    // Explicit class list, not a glob — glob discovery requires runtime
    // dynamic `import()` of .ts files, which Node's ESM loader cannot
    // transform and which breaks under Vitest. See
    // backend/src/db/entities-registry.generated.ts for the rationale and for
    // what emits it, and ./configured-entities.ts for the package half.
    entities: [...inputs.entities],
    // The tenant guard on the write side (D-260/A). One subscriber, over the
    // classification registry the `@OrgScoped()` decorators already write, so
    // there is nothing per entity and nothing per module to declare here as
    // classes arrive. It is constructed rather than passed in because it takes
    // no input: its subscribed set and its predicate are both `tenancy/`'s, and
    // a host that could substitute it could switch the guard off.
    // See ../tenancy/org-write-guard.ts for what it does and does not catch.
    subscribers: [new OrgWriteGuardSubscriber()],
    debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
    allowGlobalContext: false,
    forceUndefined: true,
    extensions: [Migrator],
    migrations: {
      migrationsList: inputs.migrations.migrations,
      transactional: true,
      disableForeignKeys: false,
      allOrNothing: true,
      emit: 'ts',
      snapshot: false,
    },
  });
}
