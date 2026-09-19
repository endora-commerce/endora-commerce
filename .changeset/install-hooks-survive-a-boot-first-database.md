---
'@endora-commerce/platform': minor
---

An install hook is no longer silenced for ever by a database that booted before it installed

Boot convergence marks a shipped module `installed` without running its `installHook` — it cannot,
and D-157.6(b) is why it must not. `install` then short-circuited on that row and answered
`already-installed`, so on a database whose first action after the migrations was a boot, an install
hook never ran and never would: no migration, no settings reconcile, no participant pass, no hook,
and nothing saying so.

## What changes

**A new nullable column, `module_registrations.boot_converged_at`** (migration
`Migration20260919T101500CoreModuleRegistrationsBootConverged`). The boot reconciler stamps it on
every row *it* wrote; it means *"boot convergence wrote this and no install has run"*. The reconciler
still inserts only and still decides nothing.

**`install` completes a row it did not write.** The `already-installed` short-circuit now needs
`state === 'installed'` **and** a null marker. With the marker set the normal body runs and step 4
clears it, so the second run is the ordinary no-op again. Every step is already safe on a converged
database: `getPendingMigrations()` returns none so the rollback set is empty, the settings reconcile
is idempotent, the participants upsert-and-prune, and the hook is idempotent by contract. This makes
`module:install --all` the command that **repairs** a boot-first database.

**The convergence stops being silent.** One warning per converged manifest that declares an
`installHook`, naming `module:install <id>`. A warning and not a refusal: it must not break a first
boot.

## Upgrading

**No backfill and no action for an already-installed deployment.** The column arrives `null`
everywhere, which reads as *"an install produced this"*, and that is true of every historical row: no
version of this package published before 2026-09-19 shipped alongside a module declaring an
`installHook`, so none can have been skipped. The cost on an installed deployment is one null check
per `module:install`.

**One residual.** A database converged *before* this column existed holds `null`, so a module that
gains its first `installHook` afterwards is still answered `already-installed` there.
`module:uninstall <id> && module:install <id>` completes it, and a rebuilt database is unaffected.

**If you compose the platform yourself**, `ShippedModuleEntry` gains an optional `installHook` field
and `firstBootInsertPopulation` answers with entries rather than manifests — both source-compatible
with handing `resolvedManifestEntries()` straight through, which is what every root does.
