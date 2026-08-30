---
'@endora-commerce/cli': minor
---

`lib/admin-surfaces` names the admin application as an owner, and names the three
registries the layout is read from.

Three additions, all of them so that a consumer can exclude or attribute without spelling a
path twice:

- **`ADMIN_HOST_OWNER`** — the owner id of the admin application itself, `'host'`. It was a
  literal in `backend/scripts/ledgers/admin-registrations.ts`, which is deleted when the
  last module's registrations move out of `App.tsx`; the boundary ledger that now uses the
  same id outlives it, so the spelling moved here and that ledger re-exports it under the
  name its own consumers already use.
- **`ADMIN_REGISTRY_ARTEFACT`** — `'modules.generated.ts'`, the generated contribution
  registry's filename. `generate-composer.ts` renders it under the alias member's source
  root and now derives the path from this constant, so a reader that has to exempt the
  artefact and the writer that produces it cannot end up naming different files.
- **`AdminSurfaceLayout.registryFiles` and `.generatedRegistryFile`** — `App.tsx`,
  `components/AppShell.tsx` and the artefact above, absolute. The first two are the paths
  `resolveAdminSurfaces` already opened to read the route table and the nav; returning them
  is what lets a caller exclude the pair without a second copy of it.

```diff
 const layout = resolveAdminSurfaces(members, registered);
+// The two hand-written registries, as the layout itself names them.
+for (const file of layout.registryFiles) skip(file);
```

Both new fields are required on `AdminSurfaceLayout`, so a caller that **constructs** one
by hand — a test fixture, not a consumer of `resolveAdminSurfaces` — has to add them.
