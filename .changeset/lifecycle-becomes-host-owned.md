---
---

`_lifecycle` leaves `backend/src/modules/` and becomes host code at `backend/src/lifecycle/`,
and the generated manifest index moves to `backend/src/manifest-index.generated.ts`
(feature 080, T040b; D-160.11 and D-160.3). No package's published surface moves: every file
this change touches lives in `backend/`, which is in `ignore`, and the module does **not**
become `@endora-commerce/mod-lifecycle` — which is the whole of D-160.11. As a package the
host would have to publish the twelve platform targets this subsystem is the only consumer
of, and a package that enumerates all 66 of its siblings is a dependency cycle waiting to be
declared.

Nothing in `packages/` is imported differently, built differently or exported differently.
The module id stays `_lifecycle` everywhere it is identity of record — the manifest, the
permissions, the activation Setting, `module_registrations`, the palette action and the i18n
bundles are all unchanged, and the bundles still ship with the application's own build.
