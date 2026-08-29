---
'@endora-commerce/mod-import-export': minor
---

`@endora-commerce/mod-import-export` ships an `./admin` layer: the import/export centre's screen,
its route and its sidebar entry now live in this package instead of in the admin application.

```ts
import { contributions } from '@endora-commerce/mod-import-export/admin';
// { routes: [{ path: '/import-export', component: () => import(…), … }], nav: [ … ] }
```

The entry exports data and nothing else — one route whose component is a dynamic-import factory,
and one sidebar declaration. A host that consumes it renders `[...hostRoutes, ...registryRoutes]`
and gates each contribution on the module's effective presence and the permission its own API
routes enforce (`catalog:write`); it must not import the screen directly.

The module's user-facing strings moved with it, from the platform's shared `core` i18n namespace
into this package's own `i18n/en.json` and `i18n/pl.json` under the `import_export` namespace, and
lost their `importExport.` prefix in the process (`importExport.page.title` → `page.title`). The
sidebar label is `nav.importExport.label`; the platform's `appShell.nav.importExport` is gone.

The package now emits its UI layer under `tsconfig.ui.json` (`jsx: react-jsx`, the `DOM` lib) and
peers on `react`, `lucide-react` and `@endora-commerce/admin-kit`.
