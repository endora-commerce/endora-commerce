---
'@endora-commerce/mod-i18n': minor
---

`_i18n` is a module package — the 66th of 67, and the one whose boot pass loads
every other module's translation bundles.

It publishes a root export (its manifest, its `lifecycleParticipant` and its two
`cliCommands`), `./migrations`, and `./backend`, which carries `registerModule`,
the `entities` array and the surface the host and the test tree reach:

```diff
-import { ERROR_TRANSLATION_KEYS } from './modules/_i18n/services/error-translation.js';
-import type { AdminI18nCradle } from './modules/_i18n/backend.js';
+import { ERROR_TRANSLATION_KEYS, type AdminI18nCradle } from '@endora-commerce/mod-i18n/backend';
```

Also published from `./backend`, each because something outside the module
constructs or calls it: `I18nService`, `MissingKeyLogger`, `loadModuleBundles`
and `BundleLoadError`, `reconcileBundles`, and `registerI18nAdminRoutes` with
`I18nAdminDeps`. Nothing else moved — the container names are unchanged
(`adminI18nService`, `adminI18nReconciler`), the module id stays `_i18n`, and the
`translation_bundles` migration keeps its class name.

**The npm name drops the leading underscore**: `_i18n` publishes as
`@endora-commerce/mod-i18n`, which is what `manifests:generate` has always
derived and what `_lifecycle` will do too.

**The bundles ship from the package root, not from `dist`.** `packages/modules/_i18n/i18n/`
is in `files` beside `dist`, because the platform anchors a module's `bundlesDir`
to the module's own directory — for a package that is the directory holding its
`package.json`. That is the same rule every module package with translations
already follows; it matters more here only because this module is the one doing
the loading. Verified from the compiled tree rather than assumed: `node`, over
`backend/dist`, loads bundles for all 46 modules that declare them, none empty.

Two things this move retired rather than changed:

- `i18n-service.ts` re-exported `SUPPORTED_LANGUAGES` and `BundleLoadError`
  "for tests / consumers" and had neither. The first is
  `@endora-commerce/contracts`', the second is published by `./backend`. Import
  them from there.
- `error-translation.ts` is now reached through `./backend`, so the map both
  composition roots inject into the error envelope is no longer a root's import
  out of the application's module tree. The drain that entry was waiting for —
  declaring the code→key mapping beside the codes in
  `@endora-commerce/contracts` — is still available and still worth doing.
