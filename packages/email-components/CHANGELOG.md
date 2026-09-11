# @endora-commerce/email-components

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [e27bf6c]
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Major Changes

- f66359f: Page Builder block names are namespaced. **Every renderer map is re-keyed.**

  `defaultPageBuilderConfig` and `defaultEmailBuilderConfig` stop being `Config` objects
  keyed by bare names (`Row`, `EmailHeading`) and become renderer maps keyed by the
  persisted, namespaced name (`cms.Row`, `transactional_emails.EmailHeading`). The
  `categories` block is **deleted** from both: a palette section is declared by the module
  whose blocks occupy it and is served, merged across the effectively present modules, by
  `GET /api/v1/admin/cms/page-builder/config`.

  ```diff
  -import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
  -const row = defaultPageBuilderConfig.components?.Row;
  -const layout = defaultPageBuilderConfig.categories?.layout;
  +import { defaultPageBuilderConfig, buildPaletteCategories } from '…';
  +const row = defaultPageBuilderConfig.components?.['cms.Row'];
  +// Sections come from the descriptor, merged per (key, context):
  +const layout = buildPaletteCategories(descriptor.components, descriptor.categories, 'cms', {
  +  title: (section) => t(section.ownerModule, section.titleKey),
  +  renderable: new Set(Object.keys(config.components ?? {})),
  +});
  ```

  `@endora-commerce/email-components` additionally re-keys `EMAIL_SAFE_COMPONENT_NAMES`,
  `EMAIL_COMPONENT_REQUIRED_VARIABLES` and `EMAIL_ORDER_LABELED_FIELDS`, and its 28 renderer
  `case` labels in `render-email-html` / `render-email-text`. `emailContexts` is gone: every
  entry now declares `contexts: ['email']`, and the newsletter palette is served by the
  `email → newsletter` admission rather than by a widened declaration.

  `@endora-commerce/page-builder-core` gains two things and breaks nothing:
  - `buildPaletteCategories(blocks, sections, context, options)` — the one implementation of
    "which sections does the palette for this context have, and what is in them". It applies
    `contextAdmits` to blocks **and** to sections, which is what keeps the newsletter palette
    sectioned rather than 28 entries in Puck's _Other_ drawer.
  - a `./migration` subpath exporting `FROZEN_BLOCK_RENAMES`, its inverse, the structural
    walk (`renameBlockNames`, `countBlockNames`, `mapBlockNames`) and the SQL builders the
    five rename migrations use. **It is not a runtime path** — the map is a frozen historical
    constant, not an alias table, and the difference is only real while nothing resolves
    through it.

  `@endora-commerce/contracts` extends `cmsPageBuilderDescriptorSchema.categories` additively
  with `ownerModule`: the module whose declaration won the merge, derived and never declared.

- 11fc9f3: Renamed from `@b2b/email-components` to `@endora-commerce/email-components`. Nothing else
  about the package changed — same components, same `exports` subpaths.

  Update the dependency and every specifier, root and subpath alike:

  ```diff
  -"@b2b/email-components": "workspace:^"
  +"@endora-commerce/email-components": "workspace:^"
  ```

  ```diff
  -import { renderEmailHtml } from '@b2b/email-components/render/render-email-html';
  -import { walkEmbeds } from '@b2b/email-components/tree/walk-embeds';
  +import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
  +import { walkEmbeds } from '@endora-commerce/email-components/tree/walk-embeds';
  ```

  Its peer `@endora-commerce/page-builder-core` is renamed in the same release; both
  specifiers must move together, or the application resolves two copies of the Page Builder
  runtime and its React context reads `null`.

- f66ce9b: `@endora-commerce/email-components` now ships compiled JavaScript and declarations. `main`, `types`
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

### Patch Changes

- a92d972: Comments only — no exported symbol, type or behaviour changes.

  Four `ComponentConfig.render` functions gain an `eslint-disable-next-line
react-hooks/rules-of-hooks` and the sentence explaining it: Puck mounts `render` as a React
  component, so the hook call inside it obeys the rules of hooks, and the linter objects to the
  field's name rather than to the call. It is recorded here because `tsc` does not strip
  comments, so the emitted `dist` differs.

- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [e1465e0]
  - @endora-commerce/page-builder-core@0.7.0
