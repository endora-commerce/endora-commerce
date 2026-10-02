---
'@endora-commerce/platform': patch
---

Make the module lifecycle work in an instance: the Modules screen loads, a
running process hears a change made elsewhere, and `module:disable`,
`module:enable` and `module:uninstall` persist what they report.

**`GET /api/v1/admin/modules` answered 404 in every instance**, so
`/platform/modules` rendered "Resource not found". `_lifecycle` mounts that
route only where a `lifecycleOrchestrator` is contributed, and the only
composition that contributed one was this repository's own reference
deployment; an instance calls `composeApp` and contributes nothing. `composeApp`
now builds the lifecycle assembly itself, for every deployment. Nothing changes
in an instance's files — upgrading the package is the whole fix.

**A running instance never heard a module state change made by another
process.** The same assembly carries the plugin that subscribes to
`b2b:module:state-changed`, so in an instance nothing armed it: an API or worker
process kept the presence it booted with until it restarted, whatever
`module:disable` or an activation written through another API process had done
since. It is armed by `composeApp` now.

**`module:disable`, `module:enable` and a soft `module:uninstall` printed
success and changed nothing.** `ModuleLifecycleOrchestrator` read the
`module_registrations` row through one call of its `em` factory and flushed
through another, and every production factory forks — so the flush belonged to
a unit of work that had never loaded the row. The audit entry was written and
the state change published over a row that had not moved; with `--cascade` the
dependents were disabled and the target was not. Each operation now loads and
flushes through one `EntityManager`. This was not specific to an instance: the
reference deployment's own `module:*` scripts fork the same way.

`lifecycleModuleFromStaticEntries` is no longer exported from
`@endora-commerce/platform/lifecycle`. That subpath is host-internal — no module
may name it — and the function's one consumer outside the package was the
reference deployment's composition root, which no longer builds the assembly.
