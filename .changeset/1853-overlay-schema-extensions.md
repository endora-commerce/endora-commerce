---
'@endora-commerce/platform': minor
---

An overlay module's `x_*` columns are checked against the whole composed module graph (issue
#1853, `specs/190-overlay-full-modules/` FR-065 – FR-066).

- **V10 follows dependencies through core and the installed packages.** An overlay module that
  exports `schemaExtensions` passes V10 (`host-not-a-dependency`) when the host's owning module
  is anywhere in its dependency closure. That closure now runs through core modules and the
  installed packages as well as the deployment's other overlay modules. So an overlay that
  depends on `customers` can declare columns on `organizations` without naming `organizations`
  directly. `discoverConfiguredMigrations` builds the graph for you. If you call
  `overlaySchemaContributionsUnder` or `discoverOverlaySchema` yourself, pass the edges of the
  modules outside the overlay root in the new option `OverlaySchemaOptions.composedDependencies`.
  Without it, a dependency outside the root counts as a direct edge only, as before.
- **`configuredEntitiesFrom` no longer checks overlay `schemaExtensions`.** It builds the entity
  set without the composed graph, so it could refuse a declaration that the migration merge
  accepts. It now reads overlay modules with the new option
  `OverlaySchemaOptions.schemaExtensions: false`, which skips V9 – V11 and contributes no
  declarations. The merge and the ORM configuration built from it still check and use every
  declaration.
- Nothing else changes for an overlay declarer. The generated step at the head of its block, the
  `schema_extensions` ledger rows under its id, the verifier, `module:schema-extensions list` and
  `drop`, and the `orphaned` rows a hard uninstall leaves all work as they do for an installed
  package.
