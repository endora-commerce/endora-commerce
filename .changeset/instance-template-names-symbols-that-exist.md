---
'@endora-commerce/cli': patch
---

`endora new instance` writes a backend that compiles.

The template named three platform symbols that no barrel exports, three times each, so every
scaffolded tree failed `tsc` on two of its ten backend files — a tree a client is meant to own
and never to have written:

```
src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
    has no exported member 'configuredEntities'.
src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
    has no exported member 'configuredMigrations'.
src/module-commands/runtime.ts: TS2724 '@endora-commerce/platform/lifecycle'
    has no exported member named 'resolvedManifestEntries'.
```

The ORM configuration is now `configuredEntitiesFrom`, `discoverConfiguredMigrations` and
**`mikroOrmConfigFrom`** on `@endora-commerce/platform/db` — the third name matters as much as
the two corrected ones, because the file it replaces built its own `defineConfig`, which
compiles and then creates tables under MikroORM's default naming with no `Migrator` extension
registered: a tree that would have type-checked and failed at the first `pnpm run migrate`.
The operator runtime assembles the `ManifestSources` that `resolveManifestEntries` takes, with
`core: []` — an instance ships no generated manifest index, so its modules are its deployment's
overlay modules plus the packages it installed — reaching `activeOverlayModulesRoot`,
`overlayModuleIdsUnder` and `overlayModuleManifestsUnder` on `./overlay` and
`discoverPackageModuleManifests`, `installedPackageModuleIdClaims` and `nodeModulesRootsFor` on
`./packages`. It is the same shape the platform's own `defaultComposition` assembles.

**If you scaffolded an instance with an earlier build**, re-scaffold into an empty directory and
copy across `apps/<deployment>/` and any edits of your own, or replace those two files with the
ones a current `endora new instance --dry-run` prints. Nothing else in the tree changed.

The guard is `packages/cli/test/new-instance/template-reconciliation.test.ts`, which reconciles
every platform name the template writes against the barrel carrying the subpath it writes it on.
It is at symbol granularity deliberately: `./composition` and `./lifecycle` are both declared
subpaths, so a reconciliation of the specifier alone passes over all three of the errors above.
