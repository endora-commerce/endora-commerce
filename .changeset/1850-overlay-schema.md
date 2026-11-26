---
'@endora-commerce/cli': minor
'@endora-commerce/platform': minor
---

An overlay module may own database tables (issue #1850, `specs/190-overlay-full-modules/`
FR-030 – FR-038). The platform reads the active deployment's overlay schema at runtime, as it reads
an installed package's, and the refusals that stopped it are removed.

- **Entities.** `backend.ts` exports `entities`, an array of classes. Each class needs exactly one
  tenancy classification and decorators from `@mikro-orm/decorators/legacy`. Every class under the
  module's `entities/` that carries entity metadata must be in that export.
- **Migrations.** The module's `migrations/` directory is read one file at a time, with no barrel.
  Each file is named `<YYYYMMDDTHHmmss>_<module-segment>_<slug>` and exports exactly one class
  whose name the filename derives (`Migration<STAMP><PascalCaseTail>`), scoped by the module id.
  The migrations are ordered by the manifest's `dependencies` and owned by the module, so
  `module:uninstall --hard` reverts them. Each one runs inside the foreign-schema guard with the
  module's own entities as its owned set and no exemption. A write to another module's table is
  refused at `migrate` and the run rolls back.
- **Refusals.** A schema that breaks these rules stops the API, the worker, `migrate` and every
  `module:*` command before anything opens. The refusal is `OverlaySchemaError`, and its `verdict`
  is `entities-not-array`, `entity-not-class`, `migration-file-shape` or
  `overlay-entity-unexported`. Each is printed as one sentence naming the file.
- **API.** `configuredEntitiesFrom({ coreEntities, env, deploymentRoot })` and
  `discoverConfiguredMigrations(sources, env, deploymentRoot)` take the directory that holds
  `apps/`. Without it, or with `DEPLOYMENT` unset, the result is unchanged. `MigrationOrigin` gains
  `'overlay'`, and `ConfiguredMigrations` gains `overlays`. `composeApp`'s ORM reads the overlay
  schema from its `deploymentRoot`.
- **Removed.** `refuseOverlaySchema` is removed from `@endora-commerce/platform/composition`.
  `endora generate` no longer refuses a `migrations/` or `entities/` directory under an overlay
  module.
- **Not yet scaffolded.** `endora new module --entities` and `--tenant-scope` still refuse for an
  overlay module, and say to write the entity and the migration by hand.

**Upgrading an instance.** `backend/src/migrate.ts` imports `refuseOverlaySchema`, so it no longer
compiles against this release. `backend/src/mikro-orm.config.ts` does not yet pass the deployment
root, so without it overlay migrations are not applied. `endora upgrade` rewrites both files while
they are still exactly what 0.112.0 rendered. The new `mikro-orm.config.ts` passes
`deploymentRoot` (`backend/dist`), and `migrate.ts` catches a refusal with `exitOnRefusal`. A file
you edited is reported and left as it is. In that case, delete the `refuseOverlaySchema` import and
call, and pass `deploymentRoot: fileURLToPath(new URL('.', import.meta.url))` to
`configuredEntitiesFrom` and as the third argument of `discoverConfiguredMigrations`.
