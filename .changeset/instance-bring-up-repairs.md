---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

Make a scaffolded instance able to migrate, compose and install its own module set.

**`@endora-commerce/cli`.** `endora new instance` wrote every root script as
`pnpm --filter backend run <x>` while the member it delegates to is named
`<name>-backend`: pnpm matched no project, printed `No projects matched the
filters` and exited **0**, so `migrate`, `build`, `start`, `dev` and the five
`module:*` scripts were silent no-ops. They are now `pnpm -C backend run <x>`,
which names the directory `pnpm-workspace.yaml` declares and exits 1 when the
directory or the script is missing. The five generated `module:*` entry points
now close the ORM and Redis handles they open and exit — they previously printed
their answer and hung forever — and run inside a system scope, as the host's own
scripts do. The next-steps block and the generated README now name
`pnpm run build` and `pnpm run module:install --all`, the two steps a client
needs and was not told about.

**`@endora-commerce/platform`.**

- `configuredEntitiesFrom` and `discoverConfiguredMigrations` now merge the
  platform's **own** six entity classes and twelve migrations, published as
  `PLATFORM_ENTITIES` and `PLATFORM_MIGRATION_ENTRIES` on `./db`. A host that
  already names them — this repository's generated registries do — is unchanged:
  the merge is an identity de-duplication over the same objects. An instance
  supplies `coreEntities: []` and `coreEntries: []` and previously therefore ran
  none of the platform's own schema.
- `resolveManifestEntries` and `composeApp`'s default composition now contribute
  `_lifecycle`, whose sources are this package's. An instance ships no generated
  manifest index, so it composed `_lifecycle` nowhere and its boot refused with
  `not-shipped: _lifecycle`.
- `composeApp` now contributes a default `lifecycleManifestRegistry`. Both
  composition roots in the Endora repository override it; an instance supplies
  no contribute callback, so the name resolved to nothing and the boot died in
  `_i18n`'s bundle reconcile.
- `module:install` accepts **`--all`**: every registered module that is not
  already installed, in the dependency order `ModuleDepGraph` computes. An
  instance's modules are installed packages, whose `module_registrations` rows no
  boot writes, and the single-module command refuses on unmet dependencies —
  so there was no performable way to install a scaffolded set.
- `PackageSchemaContribution` gains a required `dependencies` field, read from
  the package's own manifest. `configuredMigrationsFrom` used to fall back to
  `[]` for any module id the host's committed index did not carry; in an
  instance that is every module, so the per-module migration order degenerated to
  the tie-break. Construct one and you must now supply the field.
- `CORE_MODULE_ID` is declared in `./db`'s `platform-schema.ts` and re-exported
  from its previous home unchanged.
