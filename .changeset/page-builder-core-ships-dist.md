---
'@endora-commerce/page-builder-core': major
---

`@endora-commerce/page-builder-core` now ships compiled JavaScript and declarations. `main`, `types`
and all nine `exports` subpaths resolve under `./dist`; `files` is `["dist"]`.

**What changes for you.** The package no longer hands you TypeScript. Every subpath keeps
its public name and its target file, one directory over:

```
'@endora-commerce/page-builder-core'                            ./src/index.ts        → ./dist/index.js
'@endora-commerce/page-builder-core/client'                     ./src/client.ts       → ./dist/client.js
'@endora-commerce/page-builder-core/editor'                     ./src/editor.ts       → ./dist/editor.js
'@endora-commerce/page-builder-core/types/responsive'           ./src/types/…         → ./dist/types/…
'@endora-commerce/page-builder-core/fields/hide-on-field'       ./src/fields/….tsx    → ./dist/fields/….js
```

so no import statement changes — but the `transpilePackages` entry, loader or bundler
plugin you needed to compile its source does, and can go. `ResponsiveProp`,
`DEFAULT_BREAKPOINTS`, `defineComponent` and the rest keep their names and shapes.

**`"use client"` is preserved verbatim**, as the first line of each emitted file, above
the injected JSX-runtime import. That is a property of `tsc`'s emit, and it is why this
package is compiled rather than bundled: module merging is what hoists a directive out of
place, and no bundler runs here.

**React and `@measured/puck` remain optional peer dependencies.** This package ships React
contexts and hooks, so the consuming application must resolve exactly one copy of it —
two copies mean a provider in one and a consumer in the other, which is a `null` context
at runtime and not a type error. That is also why its version moves together with
`@endora-commerce/cms-components` and `@endora-commerce/email-components`.
