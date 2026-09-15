# @endora-commerce/cms-components

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [0eeb9b5]
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.0

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

- 11fc9f3: Renamed from `@b2b/cms-components` to `@endora-commerce/cms-components`. Nothing else
  about the package changed — same components, same `exports` subpaths, same stylesheet.

  Update the dependency and every specifier, including the CSS one:

  ```diff
  -"@b2b/cms-components": "workspace:^"
  +"@endora-commerce/cms-components": "workspace:^"
  ```

  ```diff
  -import { CmsRenderProvider } from '@b2b/cms-components';
  -import '@b2b/cms-components/styles.css';
  +import { CmsRenderProvider } from '@endora-commerce/cms-components';
  +import '@endora-commerce/cms-components/styles.css';
  ```

  Its peer `@endora-commerce/page-builder-core` is renamed in the same release; both
  specifiers must move together, or the application resolves two copies of the Page Builder
  runtime and its React context reads `null`.

- afedd32: `defaultPageBuilderConfig`'s hidden drawer is keyed `internal`, not `_internal`.

  ```ts
  // before
  defaultPageBuilderConfig.categories._internal; // { title: 'Internal', visible: false, … }
  // after
  defaultPageBuilderConfig.categories.internal;
  ```

  Same word, same title, same `visible: false`, same two components (`Column` and
  `Slide`) — only the key moves. A declared palette section's key is
  `^[a-z][a-z0-9_]*$` (`blockCategoryKeyRe` in `@endora-commerce/contracts`), which
  forbids a leading underscore, and this section becomes `mod-cms`' `internal`
  declaration.

  It is a major because the key is part of an exported object: anything indexing
  `categories._internal`, or deriving a translation key from it, has to move in the
  same release. In this repository that is one i18n key,
  `pageBuilder.categories._internal` in `@endora-commerce/mod-cms`' bundles, which
  moves with it.

- f66ce9b: `@endora-commerce/cms-components` now ships compiled JavaScript and declarations. `main`, `types` and
  every `exports` subpath resolve under `./dist`; `files` is `["dist"]`. `./styles.css`
  already pointed at `./dist/cms-components.css` and is unchanged — the `build` script now
  runs `tsc` first and the Tailwind step second.

  **What changes for you.** No import statement moves: `@endora-commerce/cms-components`,
  `@endora-commerce/cms-components/components/*`, `@endora-commerce/cms-components/schema/*` and the `./*` wildcard
  all keep their names and reach the same modules, one directory over. What can go is the
  `transpilePackages` entry, loader or bundler plugin you needed to compile its `.tsx`
  source. `"use client"` survives the emit as the first line of each file.

  **Five dependencies became optional peer dependencies**, and this is the part to read.
  The package imports `@tiptap/extension-color`, `@tiptap/extension-highlight`,
  `@tiptap/extension-image`, `@tiptap/extension-text-style` and `leaflet` from published
  source, and declared all five as **devDependencies** — which are not installed for you.
  Nothing said so: with the package distributed as TypeScript you compiled it yourself and
  your own install happened to satisfy them, or the import sat in a code path you never
  reached. Shipping `dist` makes them real specifiers in real emitted JavaScript, so they
  are now declared where a consumer can see them, beside the four Tiptap peers that were
  already there:

  ```
  peerDependencies:      + @tiptap/extension-color @tiptap/extension-highlight
                         + @tiptap/extension-image @tiptap/extension-text-style + leaflet
  peerDependenciesMeta:  all five optional
  ```

  Optional, so an install that does not want the rich-text editor or the map is not warned
  at. `leaflet` was already listed under `peerDependenciesMeta` with no matching
  `peerDependencies` entry, which declares nothing at all; it does now. If you render
  `RichContent` or `Map` and have not installed these, that was already broken and is now
  visible at install time instead of at runtime.

  **One hand-written declaration does not ship.** `src/types/leaflet.d.ts` is source, not
  emit, so it is not in `dist`. Nothing in the published surface references it — the
  `leaflet` import is dynamic and its type does not reach a public signature — but a change
  that puts it there would need the file published with it.

### Minor Changes

- 5fc0550: A stored Page Builder block whose owning module is absent now degrades to a visible,
  data-preserving placeholder instead of vanishing.

  **`@endora-commerce/cms-components`** gains `withMissingBlockPlaceholders(config, storedNames)`.
  Give it a Puck `Config` and the block names a stored document carries, and every name the
  config cannot render comes back keyed to a placeholder that names the block and its owning
  module. It adds no category entry: a degraded block stays editable where it already is and is
  insertable by nobody.

  ```diff
   const filtered = filterConfigByContext(merged, context);
  +const degraded = withMissingBlockPlaceholders(filtered, [...countBlockNames(doc).keys()]);
  ```

  It takes names rather than the document deliberately — a React caller needs a stable memo key,
  and a keystroke inside a text block moves the document without moving its names.

  **`makeMissingComponentConfig` gains a third, optional argument**, `{ visible?: boolean }`.
  Existing calls are unchanged: omitting it keeps the placeholder deciding for itself from the
  `?cms_admin=1` preview parameter, which is right for a customer-facing surface. Pass
  `{ visible: true }` on an editing surface, where the operator has to be told which module the
  block is waiting on.

  **`@endora-commerce/page-builder-core`** exports `countBlockNames`, `mapBlockNames`,
  `renameBlockNames` and their two types from the package root. They were reachable only through
  the `./migration` subpath, which still exports them, so no existing import changes. What that
  subpath quarantines is the frozen rename map; the walk itself is a generic "which node `type`
  values does this document hold" and is now needed at runtime.

  **`@endora-commerce/mod-cms`**'s `PageBuilderEditor` applies both. Its canvas previously
  rendered nothing at all for a block whose owner had been switched off — indistinguishable
  from a block somebody had deleted — because the placeholder it merged was built only for
  names the backend descriptor declares, and a switched-off module's blocks are filtered out
  of that descriptor. Every placeholder it did merge rendered an empty `<span>`, the
  `?cms_admin=1` parameter being set by nothing.

- e1465e0: These three packages stop being `"private": true` and can be published.

  They are the set a scaffolded storefront resolves (D-195), derived rather than chosen:
  `storefront/package.json` declares exactly these three `@endora-commerce/*` ranges, and their
  closure over `dependencies` and `peerDependencies` adds nothing.

  Each now declares `repository` — a consumer's path back to the code, and npm's prerequisite for
  provenance — and `publishConfig.access: "public"`, which is a property of the package rather than
  of the registry it happens to reach. **No `publishConfig.registry` in any of them**: the registry
  is CI configuration and the client's `.npmrc`, so moving from the private rehearsal to npmjs is
  one variable rather than three manifest edits.

  Nothing about the packages' own API changes in this release. What changes is that there is one:
  a consumer can install them by version instead of by tarball path.

  Two consequences worth knowing before the first `changeset version` run. `page-builder-core` and
  `cms-components` are in the `linked` group with `email-components` and `page-builder-admin`
  (D-108), and at `0.0.0` a `workspace:^` peer range is out of range after any bump — so those two
  will have their `version` fields advanced while staying private and unpublished. That is correct
  and needs no repair. And the private registry's version history is independent of npmjs': a
  version published privately is not thereby taken on the public registry, and
  `changeset publish` replays no history — it publishes the current version of each package or
  nothing.

### Patch Changes

- 1f07b01: New package: `@endora-commerce/page-builder-admin`, the admin-side page-builder chrome and
  the e-mail builder (feature 091 P5b; owner ruling D-192, widened in name only by
  `admin-component-contribution.md` Z1.2).

  Two subpaths. **`.`** publishes the chrome any builder composes — `PageBuilderHeaderActions`
  with `PageBuilderHeaderShell` and `PageBuilderTemplateActions`, the `createImage*` /
  `createSlideImage` / `createVideo*` asset field factories, the `create*Slug*` catalog field
  factories, `PageBuilderColorPaletteProvider`, `ColorPaletteModal`,
  `PageBuilderOverlayBridge`, `QuickTooltip` / `wrapQuickTooltip`, the `action-bar-target`
  store and `emptyPageBuilderData` / `isEmptyPageBuilderData`. **`./email`** publishes the
  e-mail builder those primitives compose — `EmailEditorPane`, `EmailVariablesProvider`,
  `EmailSubjectWithVariables`, `mergeEmailVariables`, `createEmailBuilderEditorPlugin` and the
  three template operations `saveCanvasAsEmailTemplate`, `listEmailTemplatesForApply` and
  `loadEmailTemplateCanvas`.

  **Why a fourth `page-builder` family member rather than a directory in `cms`.** All of it
  lived in `admin/src/modules/cms/components/` and `admin/src/modules/_shared/email-builder/`,
  and none of it names `cms`: `cms` held the chrome because `cms` was the first builder
  written. `cms` publishing it would make `transactional_emails` depend on `cms` in order to
  build an e-mail, and the admin kit refuses it on shape — every file here is a Puck component
  or field factory, so the kit would put `@measured/puck` behind the admin design system for
  all 66 module packages.

  **It is in the `linked` group** with `@endora-commerce/page-builder-core`,
  `@endora-commerce/cms-components` and `@endora-commerce/email-components`, and it peers on
  all three plus `@endora-commerce/admin-kit`. The peer ranges are load-bearing rather than
  tidy: `PageBuilderColorPaletteProvider` wraps `page-builder-core`'s `ColorPaletteProvider`
  context and `EmailVariablesProvider` is a context of its own, so a consumer that resolves two
  copies of either gets a `null` context at runtime and no type error.

  **Nothing here is new code.** Every binding is the one that stood in `admin/src`, and
  `admin/src` keeps a re-export shim at each old path, so an existing `@/modules/cms/components/…`
  specifier resolves to the package's own binding rather than to a copy.

  `@endora-commerce/cms-components` is patched because nothing of its own changed: it is listed
  so the release records that this package compiles its source and peers on its range.

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
