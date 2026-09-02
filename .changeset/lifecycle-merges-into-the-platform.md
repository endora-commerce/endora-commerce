---
'@endora-commerce/platform': minor
---

The lifecycle subsystem now ships with the platform (D-160.11).

`_lifecycle`'s platform-safe files moved into `packages/platform/src/lifecycle/`:
the module's manifest, its composition entry, its admin and storefront routes,
its activation Commands, its i18n bundles, and eight services — the
orchestrator, the manifest loader, the static registry, the dependency graph,
the gating graph, the deactivation ledger, the lease lock and the presence load.
An instance that installs the platform now has the lifecycle machinery with it,
rather than depending on a separate package it could be missing.

Two new modules are emitted from this package and are internal:
`lifecycle/services/migration-ownership.js` declares the `MigrationOwnership`
shape the orchestrator consumes (the host builds the value), and
`lifecycle/services/module-origin.js` declares `ModuleIdClaimOrigin` and
`deploymentShippedEntries`. `lifecycle/services/dep-graph.js` gains
`stronglyConnectedComponents` and `moduleDependencyCycles`, which are now the
one graph walk both the install refusal and the migration order read.

Three behaviour changes for a caller that constructs the machinery itself:

- `ModuleLifecycleOrchestrator` no longer defaults `migrationOwnership` to the
  committed core registry. Omitting it refuses every hard uninstall, naming the
  field; pass `coreMigrationOwnership()` for the previous behaviour, or
  `(await configuredMigrations()).ownership` from a composition root.
- `gatingGraph()` no longer falls back to the host's manifest registry on its
  own. A composed process is unaffected — the presence load installs the real
  graph — and anything else calls `provideDefaultGatingManifests(supplier)`
  first or gets a throw instead of an empty graph that refuses nothing.
- `loadModulePresence({ em, entries })` takes `declaredOmissions` instead of
  reading the deployment's reduced-deployment declaration itself. Omitting it
  declares no omission, which is the fail-closed direction.

No published subpath changed: the `exports` map is still the five of D-160.7.
The package's build now copies its runtime assets, so `dist/lifecycle/i18n/`
travels with it.
