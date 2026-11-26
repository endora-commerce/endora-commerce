---
'@endora-commerce/cli': minor
---

The CLI scaffolds an overlay module's schema (issue #1852, `specs/190-overlay-full-modules/`
FR-055 – FR-058).

- **`endora new module --entities [--tenant-scope org-scoped|customer-scoped|global]`** now works
  inside an instance. It writes `entities/<slug>-item.entity.ts`, with decorators from
  `@mikro-orm/decorators/legacy` and exactly one tenancy decorator (`org-scoped` by default). It
  adds `export const entities = [...]` to `backend.ts` and writes a first migration,
  `migrations/<STAMP>_<module>_init.ts`, with no barrel. The next steps now include `pnpm run
  build` and `pnpm run migrate`. `--tenant-scope` without `--entities` is refused.
- **`endora new migration <moduleId> --name <slug> [--dry-run]`** is new. It writes the next
  migration of an overlay module of the selected deployment (`.env`'s `DEPLOYMENT`, else the only
  directory under `apps/`). The file is `<YYYYMMDDTHHmmss>_<module>_<slug>.ts`, its UTC stamp is
  above `BASELINE_THROUGH`, and its class `Migration<STAMP><PascalCaseTail>` has empty `up()` and
  `down()`. An id that is not an overlay module of that deployment is refused, and so is the id
  of an installed package. The command exits 1 on a refusal and 2 outside an instance.
- **`endora generate`** adds the selected deployment's overlay modules to the test entity index
  (`backend/test/entities.generated.ts`). Each module whose sources declare an `@Entity` class is
  keyed by its id and imports its `backend.ts`. An overlay id that an installed package already
  holds is refused.
- **API.** `@endora-commerce/cli/lib/migration-naming.js` is new and exports `BASELINE_THROUGH`,
  `MIGRATION_FILE_RE`, `segmentFor`, `classNameFromFile`, `normalizeSlug`, `formatStamp`,
  `parseStamp`, `nextFreeStamp`, `migrationFileName` and `buildMigrationScaffold`. The root export
  adds `runNewMigration`, `emitOverlayModuleFiles`, `planOverlayModule`, `resolveOverlayHost`,
  `entitySource` and `initMigrationSource`. `collectEntityIndexEntries` takes an optional second
  argument with the overlay entries, and `collectOverlayEntityIndexEntries` is new.
- **Fixed.** An entity scaffolded with `--tenant-scope global` no longer imports `Index`
  without using it. That unused import failed a type-check with `noUnusedLocals`.
