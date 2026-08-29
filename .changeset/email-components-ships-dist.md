---
'@endora-commerce/email-components': major
---

`@endora-commerce/email-components` now ships compiled JavaScript and declarations. `main`, `types`
and every `exports` subpath resolve under `./dist`; `files` is `["dist"]`.

**What changes for you.** No import statement moves. The three maps keep their names and
reach the same modules, one directory over:

```
'.'                → ./dist/index.js
'./*'              → ./dist/*.js            e.g. schema/envelope, render/render-email-html
'./components/*'   → ./dist/components/*.js  (was ./src/components/*.tsx)
```

What can go is the `transpilePackages` entry, loader or bundler plugin you needed to
compile the source. `renderEmailHtml`, `renderEmailText`, `walkEmbeds`, `simpleEmailBody`
and the rest keep their names and shapes.

**The React/pure split still holds and is now enforced by the emit rather than by
convention.** `render/*`, `directives/*`, `tree/*`, `schema/*` and `defaults/*` compile to
JavaScript that imports no React, so a backend send path can keep importing them without
pulling the editor in; `components/*` and `config` are the React half. React,
`react-dom`, `@measured/puck` and `@endora-commerce/page-builder-core` remain optional peer
dependencies for that reason.

**Test files are no longer part of the package.** They never were meant to be; the build
excludes them explicitly, so no `*.test.js` importing `vitest` — a devDependency, and
therefore an unresolvable specifier in your install — reaches `dist`.
