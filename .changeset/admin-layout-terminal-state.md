---
'@endora-commerce/cli': major
---

The admin layout answers for an application that has no module surfaces left.

`AdminSurfaceLayout.moduleRoot` is now `string | null`. It is `null` when no directory under
the admin source root holds a child named after a registered module — the state
`specs/091-module-owned-admin-surfaces/` reaches once every module's admin screens live in
that module's own package. **Zero module roots is a measurement, not a failure**; two is still
`AdminLayoutUnresolvableError`, because picking one narrows every walk to it without saying so.

- `findAdminModuleRoot(sourceRoot, registered)` returns `string | null` instead of `string`,
  and no longer throws for zero. **A consumer that assumed a non-null return does not
  compile**; the answer at every call site is the same trivial one, because nothing is under a
  directory that does not exist. Old: `const root = findAdminModuleRoot(src, ids); walk(root)`.
  New: `const root = findAdminModuleRoot(src, ids); if (root !== null) walk(root);`
- `AdminSurfaceLayout.directories` and `AdminSurfaceLayout.moduleOfDirectory` and
  `AdminSurfaceLayout.componentDirectories` are empty when `moduleRoot` is `null`. Each is a
  measurement on the same terms.
- **New: `adminRegistryPathOf(members, readText?)`** — the generated admin contribution
  registry's absolute path, or `null` for a workspace with no admin application. It needs the
  alias member and its target and nothing else, so a caller gating a population floor on that
  artefact's presence cannot have the gate go true for an unrelated reason.
  `AdminSurfaceLayout.generatedRegistryFile` is built from it, so there is one derivation with
  two entry points.
- **New: `ModuleTreeLayout.adminSurfacesRefusal()`** — the `AdminLayoutUnresolvableError`
  message that produced `adminSurfaces()`'s `null`, memoised on the same call and non-null
  exactly when the layout is `null`. `adminSurfaces()` collapsed four distinct causes into one
  bare `null` and every caller printed a sentence of its own choosing; measured, a tree that
  refused on the module root had both of its callers report the alias, which sends a reader to
  repair a file that is correct. A consumer printing an admin refusal should print this string.
