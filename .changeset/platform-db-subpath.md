---
'@endora-commerce/platform': minor
'@endora-commerce/cli': patch
---

`./db` — the ORM configuration, the migration ordering and the bootstrap, plus the
platform's own twelve migrations on `./migrations`.

Everything between a committed registry and an open `MikroORM` is the platform's now
(`specs/110-instance-repository/` T116, FR-013): a client's schema is not a client's to
edit, and the code that decides which entity classes the ORM registers and which
migrations run at all was in the application it now composes.

**`./db` is a new host-internal subpath.** Declared by the `exports` map and carried by no
published barrel (D-160.14), so `node` and `tsc` resolve it for a host and
`check:platform-surface` answers a module's reach into it with `host-internal-subpath`. It
carries `PluralizingNamingStrategy` / `pluralize` / `toSnakeCase`; `orderMigrations`,
`historicalBaselineOrder`, `findModuleCycles`, `BASELINE_THROUGH`, `MigrationOrderError`
and the ordering types; `configuredEntitiesFrom`; `configuredMigrationsFrom`,
`migrationOwnershipOf`, `committedMigrationOwnership`, `committedModuleDependencies`,
`discoverConfiguredMigrations` and `CORE_MODULE_ID`; `mikroOrmConfigFrom`;
`createOrmBootstrap`; and `runMigrationCommand`.

**Nothing on it reads a generated artefact.** The committed migration registry, the
committed entity registry and the generated manifest index are facts about one
repository's tree, so they arrive as parameters. For a host that used to call the
application's own functions, the calls are:

```ts
// before — the application's src/db/, which imported the registries itself
const migrations = await configuredMigrations();
const ownership = coreMigrationOwnership();
const graph = coreModuleDependencies();
const entities = await configuredEntities();
const config = await mikroOrmConfig();

// after — the same computations, over registries the host supplies
import {
  committedMigrationOwnership,
  committedModuleDependencies,
  configuredEntitiesFrom,
  createOrmBootstrap,
  discoverConfiguredMigrations,
  mikroOrmConfigFrom,
} from '@endora-commerce/platform/db';

const sources = { coreEntries: MIGRATION_REGISTRY, manifests: DISCOVERED_MANIFESTS };
const migrations = await discoverConfiguredMigrations(sources);
const ownership = committedMigrationOwnership(sources);
const graph = committedModuleDependencies(DISCOVERED_MANIFESTS);
const entities = await configuredEntitiesFrom({ coreEntities: ALL_ENTITIES });
const config = mikroOrmConfigFrom({ entities, migrations });
const { initOrm, getOrm, closeOrm } = createOrmBootstrap(async () => config);
```

`configuredMigrationsFrom` and `migrationOwnershipOf` keep their names and signatures.

**`./migrations` now publishes the twelve core migration classes** beside
`BASELINE_MIGRATIONS`. They moved unchanged — no rename, no consolidation, no re-stamping
(R7.5) — because `mikro_orm_migrations` persists the class name, so a rename would make
every migrated database see the migration as pending. There is no `migrations` array on
that subpath, unlike a module package's: nothing discovers the platform, and an array here
would be a claim nothing reads.

**Two removals from `./lifecycle`.** `moduleDependencyCycles`,
`sortComponentsTopologically` and `stronglyConnectedComponents` left it, and so did the
`MigrationOwnership` type: their one consumer outside the platform was the ordering code,
which is inside it now. A consumer that named them there takes the graph walk from
`ModuleDepGraph` and `MigrationOwnership` from `./db`.

**`@mikro-orm/migrations` is a new peer dependency**, on the same reasoning as
`@mikro-orm/core`: the configuration registers the `Migrator` extension and the twelve
migrations extend `Migration`, and a second copy of the package is a second `Migration`
base class.

The `@endora-commerce/cli` bump is `lib/platform-surface`'s `HOST_INTERNAL_SUBPATHS`
gaining its `db` entry, with the reason that entry is required to carry.
