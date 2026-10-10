# @endora-commerce/mod-cms

## 0.105.0

### Patch Changes

- 2e355fb: Every admin write to a CMS block, a CMS template and a CMS hook now runs through the Command Bus
  and leaves one audit entry, written in the write's own transaction and attributed to the acting
  admin. Page writes already did; these three kinds changed the row and recorded nothing, so "who
  edited this block" or "who detached it from that hook" could not be answered afterwards.

  - **Blocks** — `objectType: 'cms_block'`, actions `cms_block.create`, `cms_block.update`,
    `cms_block.set_content`, `cms_block.delete`.
  - **Templates** — `objectType: 'cms_template'`, actions `cms_template.create`,
    `cms_template.update`, `cms_template.set_content`, `cms_template.delete`.
  - **Hooks** — `objectType: 'cms_hook'`, actions `cms_hook.create`, `cms_hook.update`,
    `cms_hook.delete`, and for the blocks attached to a hook `cms_hook.attach_block`,
    `cms_hook.reorder_block`, `cms_hook.detach_block`. An attachment has no id of its own, so its
    entries carry the hook id as `objectId` and name the block and its position in the state.

  An entry records the facts an operator sets — name, code, active flag, description, languages,
  sales channels and version — on each side of the write; a content save records the language and
  the version it produced rather than the content tree, as a page's does. A refused write, a patch
  that names no field, and detaching or reordering a block that was not attached record nothing.

  Routes, request and response shapes and status codes are unchanged. Deleting a block, a template
  or a hook, and detaching a block, now run inside a transaction; they ran as bare statements
  before. `CmsBlockService`, `CmsTemplateService` and `CmsHookService` take the `CommandBus` as
  their second constructor argument; the module's own composition supplies it, so a host composed
  through `composeApp` or the test kit's `composeTestServer` needs no change.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [964ada7]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/cms-components@0.105.0
  - @endora-commerce/page-builder-admin@0.105.0
  - @endora-commerce/page-builder-core@0.105.0

## 0.104.0

### Minor Changes

- fcf6daa: A category can carry content for its storefront page, authored in the Page Builder.

  - **`@endora-commerce/mod-catalog`** — new nullable `categories.content` column (migration
    `Migration20261008T092714CatalogCategoryContent`; run your instance's migrations) holding one
    Page Builder document per language. New routes: `GET` / `PUT
/api/v1/admin/catalog/categories/:id/content` (`catalog:read` / `catalog:write`) and the
    storefront read `GET /api/v1/catalog/categories/:id/content`. New admin screen
    `/catalog/categories/:id/content`, reached from a **Content** action on the category tree. A save
    runs the `category.content.update` command and emits `category.content.updated.v1`, which flushes
    the storefront's `catalog:categories` cache tag and — unlike `category.updated.v1` — does not
    re-index the category's products. The category list, the category tree and
    `CatalogCategoryRecord` are unchanged and do not carry the content.
  - **`@endora-commerce/contracts`** — new `categoryContentEnvelopeSchema`,
    `putCategoryContentRequestSchema`, `adminCategoryContentSchema`, `categoryPageContentSchema`,
    their inferred types and `CATEGORY_CONTENT_MAX_BYTES` (1 MiB). New admin zone
    `category.content.editor` with `CategoryContentEditorZoneProps`
    (`{ categoryId, language, data, onChange }`): the catalog owns the document and mounts the zone,
    and a module that owns a Page Builder contributes the editor. `assetReferenceKindSchema` gains
    `'category_content'`: a library asset embedded in a category's content cannot be deleted while
    the content references it.
  - **`@endora-commerce/mod-cms`** — contributes its Page Builder to `category.content.editor`
    (gated on `cms.read`). With the CMS module off the catalog's **Content** action is not offered;
    stored content is kept.

  A storefront has to render it to show it: read `getCategoryPageContent(node.id, ctx)` beside the
  listing and render the result through the Page Builder render boundary, as the reference
  storefront's `/c/[slug]` page and `components/CategoryContent.tsx` do.

### Patch Changes

- bf51b0b: The CMS page, block and template editors no longer squeeze the Page Builder on
  mid-width screens.

  The settings panel becomes a column beside the builder from 1800px instead of
  1536px: between the two, the canvas was under 300px wide and the builder's
  toolbar clipped its own title. Below 1800px the panel still sits above the
  canvas, and it now starts collapsed there when editing existing content, so the
  builder is on the first screen; "Show settings" opens it. A choice the operator
  has already made is kept, a new page, block or template still opens the panel,
  and a refused save still reveals it.

- 1bfbcea: The CMS page, block and template editors put the Page Builder first.

  The metadata card and the scope card used to sit in a row above the canvas, so every visit to an
  editor began by scrolling past them. They are now a settings panel beside the canvas — a column to
  its right from 1536 px of viewport, a block above it below that — and a **Hide settings / Show
  settings** button over the canvas puts the panel away to give the builder the full width. The
  choice is remembered per browser.

  The panel opens by itself where it is needed: for a new page, block or template, which cannot be
  saved without a name and a scope, and whenever a save is refused, so a validation error is never
  behind a collapsed panel. The content language tabs moved to sit directly above the canvas they
  switch.

  Nothing about what is saved changed — the same fields, the same requests. No exported symbol
  changed either: the shell is the module's own and `@endora-commerce/mod-cms/admin-ui` still
  publishes only `PageBuilderEditor`, so the blog editors that render that canvas are untouched.

- 5e2ade8: Saving content in the Admin UI now reaches the storefront on the next request. Until now a saved CMS
  page, block, template or hook — and an edited megamenu — appeared only after the storefront's own
  60-second cache window, and the **Cache** screen could not shorten that: it cleared Redis, which the
  save had already done, and never told the storefront.

  - **`@endora-commerce/contracts`** exports the cache-tag vocabulary both sides must spell alike:
    `CMS_STOREFRONT_CACHE_TAGS`, `MEGAMENU_STOREFRONT_CACHE_TAG`, the event name
    `CMS_CONTENT_CHANGED_EVENT` (`cms.content_changed.v1`) and its payload type `CmsContentChange`.
    The tag strings are the ones the storefront already used, with one addition: the published-page
    index (the sitemap's source) is tagged `cms:page-index` instead of `cms:page`.
  - **`@endora-commerce/mod-cms`** publishes `cms.content_changed.v1` on the EventBus after every page,
    block, template and hook write has committed, and answers it by posting the matching tags to the
    storefront's `/api/revalidate`. A block save now also drops the cached hooks that inline that
    block, which it did not before.
  - **`@endora-commerce/mod-megamenu`** revalidates the `megamenu` tag on every menu write, and
    subscribes to `cms.content_changed.v1` so a saved block or page drops the menus that embed or link
    to it.
  - **`@endora-commerce/mod-blog`** drops its cache when a category is created and when a tag is
    renamed without a code change; both used to leave the old listing in place for five minutes.
  - **`@endora-commerce/mod-settings`** — clearing the `cms` or `megamenu` namespace on the Cache
    screen, or with `settings cache-clear`, now revalidates the storefront's copy too.

  Nothing to configure beyond what an instance already sets: revalidation runs when
  `STOREFRONT_BASE_URL` and `REVALIDATE_SECRET` are present on the backend and the same secret is on
  the storefront, is skipped otherwise, and never fails a save when the storefront cannot be reached.

  **An existing storefront tree** keeps working — its tags are the same strings — with one exception
  worth taking: change the tag on its `getCmsPageIndex` fetch from `cms:page` to
  `CMS_STOREFRONT_CACHE_TAGS.pageIndex`, or a newly published page reaches `sitemap.xml` only when the
  60-second window runs out.

- 9d6dfbc: Every Page Builder editor is laid out the same way: the blog post, blog category and
  transactional e-mail editors join the CMS ones.

  **`@endora-commerce/page-builder-admin` publishes the editor shell.** New exports on `.`:
  `PageBuilderEditorLayout`, `usePageBuilderEditorSettingsPanel`,
  `PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY`, `PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH` and the
  types `PageBuilderEditorLayoutProps` and `PageBuilderEditorSettingsPanel`. It is the layout the CMS
  editors already have — canvas as the main column, the entity's cards in a settings panel that is a
  column beside it from 1800 px, a block above it below that, collapsed by default there, always open
  for a new entity, revealed when a save is refused, the choice remembered per browser — moved out of
  `cms` so that a module does not have to depend on `cms` to lay out an editor. Three shapes: with a
  settings panel; without one (`settings` omitted — the canvas has the page); and `builder={null}`
  for an entity that has no canvas yet, where the cards are the page and nothing collapses. Its four
  strings are `pageBuilder.editorLayout.*` in the `core` bundle (`@endora-commerce/mod-i18n`).

  **Blog post and blog category editors.** The Page Builder is the main column and the fields are in
  the settings panel, grouped: Metadata, Scope, Search engines (SEO), then for a post Tags, Related
  posts, Related products and Lifecycle. **One Save replaces "Save metadata" and "Save content" /
  "Save description"**: it is in the header with "Save and exit", sends the same requests (the fields,
  then the canvas only if it was edited), and a save that cannot go through names what is missing and
  opens the panel instead of leaving a disabled button. Publish / Unpublish moved to the header;
  Archive is in the Lifecycle card. The canvas now follows the language tab, and saving tags or
  related content no longer puts the stored content back under unsaved canvas edits. A new post or
  category, which has no canvas until it exists, shows the fields as the page. `mod-blog` gains
  `@endora-commerce/page-builder-admin` as an optional peer dependency, next to the
  `@endora-commerce/mod-cms` one it already had. Removed bundle keys: `common.saveContent`,
  `common.saveDescription`, `common.saveMetadata`, `messages.contentSaved`,
  `messages.descriptionSaved`.

  **Transactional e-mail, e-mail block and e-mail template editors.** The canvas takes the full
  editor width and starts on the first screen; the scope, the language and the subject sit on one row
  above it instead of in three stacked cards. These editors deliberately have **no** settings panel:
  those fields say which message is on the canvas or are part of it. Their labels and messages are
  now translated (`pl` included) instead of hard-coded English. A save without a subject is refused
  on the screen, with a sentence that names the field and the cursor put in it, instead of the API's
  generic validation error; `EmailSubjectWithVariables` (`@endora-commerce/page-builder-admin/email`)
  gains the optional `invalid` and `describedBy` props that carry it.

  **`mod-cms`**: no visible change. Its three editors import the shell from
  `@endora-commerce/page-builder-admin`; the `editorLayout.*` keys left its bundle for `core`. The
  shell was never exported from `cms` (`./admin-ui` still publishes only `PageBuilderEditor`), so no
  import breaks. The remembered choice keeps its storage slot, `b2b-admin.cms-editor.settings-panel`,
  so operators who already chose keep their choice — and it now applies to the blog editors too.
  One behaviour differs: when a refused save opens the panel, the page scrolls to the top of the
  editor, so the message is on screen with the fields under it, rather than to the panel alone.

  No request, response or payload shape changed.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [9d6dfbc]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/page-builder-admin@0.104.0
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/cms-components@0.104.0

## 0.103.1

### Patch Changes

- 7f6a4ba: The Page Builder extension guide this package ships no longer says that every storefront runs
  `blocks:generate`. That is true of a storefront created by release `0.103.0` or later. A storefront
  created earlier keeps its source through an upgrade — `endora upgrade` moves its packages only — so
  it has no `blocks:generate` script, no `lib/page-builder/` and no rule for a switched-off module's
  block until its owner brings those files over. The guide now says so and names where the steps
  are: _Upgrading an instance_, under _Module blocks in an existing storefront_. No code changes.
- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/cms-components@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/page-builder-admin@0.103.1
  - @endora-commerce/page-builder-core@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: The CMS editor renders a module's block with the renderer that module contributes through its `./admin` layer, and a declared block nothing renders is now insertable and editable from its declared fields behind a neutral preview — it used to be a placeholder with no editable field. The documentation page _Extending the Page Builder_ describes how a module package ships its renderers. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).

### Patch Changes

- bb56a0d: Every admin write to a CMS page now runs through the Command Bus and leaves one audit entry,
  written in the write's own transaction and attributed to the acting admin. Creating, updating,
  saving content, publishing, archiving, unarchiving and deleting a page each used to change the
  row and record nothing, so "who published this page" could not be answered afterwards.

  The entries carry `objectType: 'cms_page'`, the page id as `objectId`, and one of seven actions:
  `cms_page.create`, `cms_page.update`, `cms_page.set_content`, `cms_page.publish`,
  `cms_page.archive`, `cms_page.unarchive` and `cms_page.delete`. An entry records the page's name,
  slug, status, languages, sales channels, meta and version on each side of the write; a content
  save records the language and the version it produced rather than the content tree. A refused
  write, a patch that names no field and a delete of a page that is not there record nothing.

  Routes, request and response shapes and status codes are unchanged. A host composed through
  `composeApp` or the test kit's `composeTestServer` needs no change: both already register the
  `commandBus` the module now resolves. A composition assembled by hand must register one, or the
  module's boot fails with `Could not resolve 'commandBus'`.

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/page-builder-admin@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/cms-components@0.103.0

## 0.102.0

### Minor Changes

- 255b60b: The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
  its package at 0.21 (`npm install @measured/puck` now prints _"Puck has moved"_), and these
  packages now import `@puckeditor/core` 0.23 — the code, the types and the stylesheet
  (`@puckeditor/core/puck.css`).

  **What a consumer changes.** If your project declares the editor itself — an admin application
  that bundles `@endora-commerce/page-builder-admin`, `@endora-commerce/mod-cms` or any of the
  modules above, or a storefront rendering pages through `@endora-commerce/cms-components`:

  ```bash
  pnpm remove @measured/puck
  pnpm add @puckeditor/core@^0.23.0
  ```

  and rename the specifier in any import of your own (`'@measured/puck'` → `'@puckeditor/core'`,
  `'@measured/puck/puck.css'` → `'@puckeditor/core/puck.css'`). A project scaffolded with
  `create-endora-commerce` / `endora new instance` gets the new name at its root from this release
  on; an existing instance renames the one line in its root `package.json`. Leaving
  `@measured/puck` installed does not satisfy the peer — the two names are different packages —
  so a bundler resolves `@puckeditor/core` to nothing and the editor fails to build.

  **Stored content is unchanged.** Puck 0.21–0.23 changed no part of the page data shape: CMS
  pages, blocks, templates, blog bodies, e-mail templates, newsletter blocks and invoice templates
  persisted under 0.20 render and edit as they did, with no migration and no read-time adapter.

  **The editor looks and behaves as it did.** Three 0.21–0.23 defaults that reshape the editor are
  pinned back for every builder host through new exports of `@endora-commerce/page-builder-core/editor`:
  `withPuckLegacySideBar(plugins)` keeps the stacked Components + Outline side bar instead of the
  0.21 Plugin Rail, `PUCK_LEGACY_VIEWPORTS` keeps the 0.20 Small / Medium / Large viewports without
  the 0.21 full-width one (the CMS host keeps passing its own breakpoints), and `PUCK_LEGACY_DND`
  keeps the 0.20 fluid drag-and-drop instead of the 0.23 insertion line. A host of your own built on
  these packages can pass the same three to its `<Puck>`.

  `@puckeditor/core` 0.23 requires Node 20 or later, below this platform's own floor (22.17).

### Patch Changes

- 489a0b6: Documentation: "Extending the Page Builder" now describes how a module contributes a block
  today — by declaring `blocks` and `blockCategories` in its own module manifest, with a
  `<module id>.<Name>` block name — instead of calling `PageBuilderRegistry.register` from
  `composition.ts`, which no longer exists. It states the two rules `defineModuleManifest`
  enforces, that a duplicate name throws `DuplicateBlockNameError` rather than overwriting, that
  `contexts` is required, and that a module published outside this repository cannot add a
  renderer to `@endora-commerce/cms-components` without changing that package.
- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/page-builder-admin@0.102.0
  - @endora-commerce/cms-components@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/cms-components@0.101.1
  - @endora-commerce/contracts@0.101.1
  - @endora-commerce/page-builder-admin@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/cms-components@0.101.0
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0
  - @endora-commerce/page-builder-admin@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [61bc20a]
- Updated dependencies [54c7417]
  - @endora-commerce/cms-components@0.100.2
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/page-builder-admin@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/cms-components@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/page-builder-admin@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/page-builder-admin@0.9.7
  - @endora-commerce/page-builder-core@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-admin@0.9.6
  - @endora-commerce/page-builder-core@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/cms-components@0.9.5
  - @endora-commerce/page-builder-admin@0.9.5
  - @endora-commerce/page-builder-core@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/page-builder-admin@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/page-builder-admin@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-admin@0.9.2
  - @endora-commerce/page-builder-core@0.9.2

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/cms-components@0.9.1
  - @endora-commerce/page-builder-admin@0.9.1
  - @endora-commerce/page-builder-core@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

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

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/cms-components@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/page-builder-admin@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-admin@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- 02838b7: Nine modules now declare the environment inputs they own, in `manifest.env`, so a
  client who installs them can be told what to put in their `.env`. Each declaration
  carries an English and a Polish sentence, a requirement, and — for an `optional`
  one — what is lost without it.

  `health_checks` was the tenth until D-229 dissolved it into the platform; its two
  declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
  because the platform now declares that name and a module may not describe a
  platform input a second time.

  Nothing changes at runtime: no module reads a new variable and none changes how it
  reads an existing one. What changes is that the requirement is now on the wire, in
  the manifest the platform already carries, and reaches a consumer through the
  package's own `exports` map.

  Every module here declares only what it **owns**. The seven platform-owned names
  these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
  `PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
  `SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
  are deliberately not repeated here.

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1
  - @endora-commerce/page-builder-admin@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

## 0.8.0

### Minor Changes

- 4eeb5cd: `cms` publishes `CmsBlockReadPort`, and `megamenu` resolves its own cross-module targets.

  **New on `@endora-commerce/contracts`:** `CmsBlockReadPort`, `CmsBlockRecord` and
  `CmsLocalizedBlockRecord`. Two methods, which is the whole of the demand.
  `findById(id)` answers _does this block exist_ and carries `active` on the record
  rather than filtering on it, because the two callers disagree about a deactivated
  block on purpose. `findLocalizedById(id, language)` answers _what does it render as
  here_ and is the reason the port exists: the per-language envelope —
  `content.languages[<code>]`, a legacy `schema_version` riding along, an absent key
  meaning "nothing authored" — is `cms`' storage layout, and a consumer that had to
  know it would be reading the column with extra steps. `null` covers all three
  absences, because a caller inlining a block has the same thing to do in each.

  **New on `@endora-commerce/mod-cms`:** the port is registered as `cmsBlockReadPort`
  with `ctx.di.providePort`, so it fails closed with 503 `MODULE_DISABLED` when an
  operator switches the CMS off. Nothing else changed in this package.

  **Removed from `@endora-commerce/mod-megamenu/backend`: `TargetValidatorDeps` and
  `StorefrontDeps`.** Both existed so a composition root could write eight closures
  against them — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
  the storefront URL shapes — and this module's own barrel argued they had to stay in
  a root until one of the three owners grew an existence-check port. All three have:
  `catalogCategoryReadPort`, `cmsPageReadPort` and `assetReadPort` came out of feature
  075, and `cmsBlockReadPort` above is the one that was still missing. The module now
  resolves those four plus `assetsLibraryPort` with `lazyPort` and declares the edges
  in its manifest, where `catalog` joins `cms`, `assets_library`, `languages`,
  `sales_channels`, `auth` and `dictionaries`.

  **If you contributed `megamenuValidatorDeps` or `megamenuStorefrontDeps`**, delete
  both contributions: the container names are read by nobody and registering them now
  does nothing. There is no replacement to write, and the interfaces are deleted
  rather than relocated — what replaces them is module-private and holds no closure.
  Make sure the composition registers the five ports, which it does by composing
  `catalog`, `cms` and `assets_library`.

  Two behaviours were divergent between the reference deployment and the test harness
  and are now single-valued, both settling on the deployment's answer: a category
  target resolves to `/c/<slug>` (the harness built `/catalog/<slug>`, which the
  reference storefront serves from nowhere), and a deactivated or soft-deleted
  category drops its menu item and its children (the harness narrowed on neither).
  A CMS page target is deliberately _not_ narrowed on status or `active`, which is
  what both roots did.

- fa9e7d3: `cms` resolves its own asset embeds, through `assets_library`' published port.

  `cmsAssetResolver` was a **contribution point**: the module registered the name
  defaulted to `undefined`, and a composition root was expected to build the closure
  out of `assets_library`' service and contribute it. It is the module's own
  registration now, over `lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')`,
  with the edge already declared in this module's manifest `dependencies`.

  **If your composition contributed `cmsAssetResolver`, you no longer have to**, and
  you no longer should. Contributing it still wins — `contribute` overwrites, and the
  registration is read from the cradle per call — but the closure you were writing is
  a raw hold on another module's service, which is what the port replaces:

  ```diff
  -composedModules.contribute({
  -  cmsAssetResolver: async (assetId: string) => {
  -    try {
  -      const detail = await assetsLibrary.handle.service.getAsset(assetId);
  -      return { url: detail.url, mimeType: detail.mimeType, filename: detail.filename,
  -               label: detail.label, visibility: detail.visibility };
  -    } catch {
  -      return null;
  -    }
  -  },
  -});
  +// Nothing. `cms` registers it.
  ```

  **What changes for a running platform**: a composition that never contributed the
  name resolved every CMS asset embed to `{}`. That was this repository's own test
  harness — `composition.ts` contributed it and `test-server.ts` did not — so a CMS
  storefront response under test carried no asset detail at all, quietly, an empty
  map being a plausible answer rather than a wrong one. There is no composition in
  which the name is unset any more, and `CmsCradle.cmsAssetResolver` is
  `CmsAssetResolver` rather than `CmsAssetResolver | undefined`.

  The `catch` that answers `null` for an asset the library no longer has is kept —
  `getAsset` throws 404 for a row that is gone, and a page embedding a deleted asset
  renders without it — with `rethrowIfModuleDisabled` as its first line, so it cannot
  also absorb the owner's refusal.

  The mapping is `createAssetEmbedResolver` in
  `src/backend/services/asset-embed-resolver.ts`, exported from nothing: it is a
  function of the port rather than of the `ModuleContext`, which is what lets its
  test stub `AssetsLibraryPort` and compose no container.

  Three packages are touched with no release meaning of their own, and all three are
  comments: `@endora-commerce/mod-assets-library`, whose barrel recorded the drain
  condition this change meets; `@endora-commerce/mod-pim-ergonode`, whose barrel
  described `assetsLibraryService` as a live composition-root bridge; and
  `@endora-commerce/contracts`, where `AssetsLibraryPort`'s doc block named
  `pim_ergonode` as its only consumer. The interface itself is unchanged — `cms`
  takes `getAsset` and nothing was added to admit it, which is what publishing one is
  for.

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

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/page-builder-admin@0.8.0
  - @endora-commerce/page-builder-core@0.8.0
  - @endora-commerce/cms-components@0.8.0

## 0.7.0

### Major Changes

- 316f44b: `@endora-commerce/admin-kit` publishes four generic members that sat under a module's
  admin directory and were rendered from another's (feature 091, P8).

  **`./components` gains `ContentLanguageTabs` and `ScopePicker`.**
  - `ContentLanguageTabs({ languages, activeLanguage, onChange })` — a tab strip over
    content language codes. Its props type is `ContentLanguageTabsProps`.
  - `ScopePicker({ value, onChange })` — sales channels and the content languages inside
    them. Its props type is `ScopePickerProps` and its value type is **`ScopePickerValue`**,
    which is `CmsScopeValue` renamed: `{ salesChannelIds: string[]; languages: string[] }`,
    field for field. A consumer importing `CmsScopeValue` from `mod-cms`' admin code renames
    the type and changes nothing else.
  - `listScopeSalesChannels(pageSize?)` and `fetchScopeSalesChannel(code)` come with it. The
    picker called `sales_channels`' admin API client; it now builds both `GET`s from the
    published `apiClient` and the contract's own `SalesChannelListResponse` /
    `SalesChannelDetail`, so the kit holds no module code.

  **`./ui` gains `Section`** — `Section({ title, action?, className?, children })` and
  `SectionProps`. A heading, an optional action beside it and a slot; it is a layout
  primitive, which is why it is here and not on `./components`.

  **`./lib` gains the three invoice e-mail-outcome helpers** — `invoiceEmailNotSentReason`,
  `sendInvoiceEmailMessage` and `issueInvoiceNotice`, plus the `Translate` type they take.
  Signatures are unchanged: each still receives the caller's scope-bound `t`.

  **`@endora-commerce/mod-cms`' bundle loses six keys** and `@endora-commerce/mod-i18n`'s
  gains them under new names, because the two components now render out of `core` (ruling
  R-1: a translation namespace is module knowledge). None of the six had another reader.

  | gone from `mod-cms`      | arrives in `mod-i18n`           |
  | ------------------------ | ------------------------------- |
  | `languageTabs.empty`     | `contentLanguageTabs.empty`     |
  | `languageTabs.ariaLabel` | `contentLanguageTabs.ariaLabel` |
  | `scope.title`            | `scopePicker.title`             |
  | `fields.languages`       | `scopePicker.languages`         |
  | `scope.selectChannel`    | `scopePicker.selectChannel`     |
  | `scope.loadingLanguages` | `scopePicker.loadingLanguages`  |

  Every value is carried across unchanged in both shipped languages. **A consumer that
  supplies its own bundle has to move all six**: a key left in the `cms` scope does not fail
  to compile and does not 404 — it renders `core.scopePicker.title` into the operator's screen
  as a label.

  The invoice e-mail helpers move no key. All twelve they read —
  `invoices.emailNotSent.<reason>` (seven), `invoices.emailSent`,
  `invoices.emailNotSentNotice` and three `orderDetail.issueInvoice.*` — were already
  `mod-i18n`'s in both languages and in neither `mod-invoices`' bundle nor `mod-orders`'.

- 09df879: The shared admin page-builder chrome's copy moves out of `mod-cms`' bundle and into
  `mod-i18n`'s, which the admin serves under the synthetic `core` scope (feature 091 P5a;
  ruling R-1: a translation namespace is module knowledge, and this copy is nobody's).

  **`@endora-commerce/mod-cms`' bundle loses 33 keys**, every one of them under
  `pageBuilder.*` and every one of them read only by `PageBuilderHeaderActions.tsx` — the
  header shell, the template actions and the header tools that `cms`, `invoices` and the
  e-mail builder all render. The blocks that moved whole are
  `pageBuilder.saveAsTemplate.*` (9), `pageBuilder.applyTemplate.*` (9),
  `pageBuilder.copyLanguage.*` (8, minus `emptySource`), `pageBuilder.clearCanvas.*` (5) and
  `pageBuilder.fullscreen.*` (2). The bundle keeps its other 65 `pageBuilder.*` keys —
  `components.*`, `categories.*`, `drawer.*`, `copyLanguage.emptySource` and the rest — which
  belong to `cms`' own screens, and it keeps `common.saving`, `fields.name` and `fields.code`,
  which its editors read.

  **`@endora-commerce/mod-i18n` gains those 33 plus three new `common.*` entries**:
  `common.state.saving`, `common.field.name` and `common.field.code`. They are additions
  rather than moves because `cms` reads its own copies of the same three concepts from its own
  screens; no existing `core` key carried those values.

  **What a consumer that supplies its own bundle has to do:** move the 33 `pageBuilder.*` keys
  from the `cms` scope into `core`, and add the three `common.*` entries. A key left behind
  does not fail to compile and does not 404 — it renders `core.pageBuilder.clearCanvas.button`
  into the operator's screen as a label.

  `common.state.saving` is `"Saving…"` / `"Zapisywanie…"`, with the typographic ellipsis its
  `common.state.loading` sibling uses, where `cms`' own `common.saving` is `"Saving..."`. That
  is the one rendered character this release changes.

### Minor Changes

- 59c59c6: `cms` and `blog` ship their admin screens, and `cms` publishes its page-builder canvas.

  **Two packages' `./admin` subpath is new, and `@endora-commerce/mod-cms` gains a second UI
  subpath.** Eighteen routes and seven sidebar entries between them, at the paths the
  hand-written host registrations carried, plus `./admin-ui` on `cms` for the one component
  another module renders. The exported symbol on `./admin` is the same one every other module
  package uses — `contributions`, an `AdminContributions` object, and nothing else.
  - `@endora-commerce/mod-cms` — **new `./admin` subpath**, exporting `contributions`. Eleven
    routes: `/cms` and `/cms/pages` (the landing route) on `cms.read`, `/cms/pages/:id`,
    `/cms/blocks`, `/cms/blocks/:id`, `/cms/templates`, `/cms/templates/:id` and `/cms/hooks`
    on `cms.read`, and `/cms/pages/new`, `/cms/blocks/new` and `/cms/templates/new` on
    **`cms.write`**. `/cms` is a second declaration of the page list rather than a redirect,
    because a redirect would be the consuming application's route and not this module's. Four
    sidebar rows, in the `content` section at weights 100 to 400.
  - `@endora-commerce/mod-blog` — **new `./admin` subpath**, exporting `contributions`. Seven
    routes: `/blog/posts` (the landing route), `/blog/posts/:id`, `/blog/categories`,
    `/blog/categories/:id` and `/blog/tags` on `blog.read`, and `/blog/posts/new` and
    `/blog/categories/new` on **`blog.write`**. Three sidebar rows, in the `content` section at
    weights 600 to 800.

  **The five create routes take the write code, and that is a behaviour change for a consumer
  rendering these routes.** Each create screen exists to write — `POST /api/v1/admin/cms/pages`
  and its four siblings enforce the write code — and each module's own palette action
  (`new-page`, `new-post`) already advertised that code. The routes were ungated while they
  belonged to the admin application, so a read-only operator could open a form whose save then
  refused. The five create controls are gated on the same code in this release — the _New page_,
  _New block_, _New template_, _New post_ and _New category_ buttons and the category tree's
  _+ Child_ — so the dead end is closed at both ends. `@endora-commerce/mod-sales-channels`
  ships the identical split for `/sales-channels/new` and `@endora-commerce/mod-credentials` for
  `/credentials/new`.

  **`CategoryTreeNode` takes a new required prop.** It is not exported from any subpath, so this
  affects nobody outside the package; it is recorded because the prop is `canCreate: boolean`
  and required rather than optional — a caller that forgets it does not compile, which is the
  direction a permission gate has to fail in.

  **`@endora-commerce/mod-cms` — new `./admin-ui` subpath, exporting `PageBuilderEditor` and the
  `PageBuilderData` type.** This is the Puck canvas the CMS page, block and template editors
  render and that `@endora-commerce/mod-blog`'s post and category editors render too. Its props
  are `data` in and `onChange` back, so the consumer decides that it appears — a published
  component rather than something the owner contributes to a place of its own choosing. It is
  not in `@endora-commerce/admin-kit` because it is a `@measured/puck` host and the kit is what
  every module's admin layer compiles against, and not in
  `@endora-commerce/page-builder-admin` because it calls this module's API client, reads this
  module's translation namespace and lays the CMS page container out — that package holds the
  builder chrome that names no module at all.

  **`@endora-commerce/mod-blog` gains `@endora-commerce/mod-cms` as a peer dependency**, which
  is what a published component costs: the reach survives into the emitted JavaScript, so a
  consumer bundling `blog`'s admin layer must resolve `cms`. It is not a `dependency` — a module
  reaches another through a port declared in its manifest, never through npm — and it is not
  optional. A consumer that installs `@endora-commerce/mod-blog` without `@endora-commerce/mod-cms`
  will fail to resolve `@endora-commerce/mod-cms/admin-ui` at bundle time. There is no runtime
  half to worry about: `blog`'s module manifest already declares `cms` in its `dependencies`, so
  a platform where `cms` is absent or switched off is one where `blog` cannot be activated
  either.

  **`@endora-commerce/mod-cms` and `@endora-commerce/mod-blog` ship new i18n keys, and
  `@endora-commerce/mod-i18n` loses seven.** `nav.cmsPages.label`, `nav.cmsBlocks.label`,
  `nav.cmsTemplates.label`, `nav.cmsHooks.label`, `nav.blogPosts.label`,
  `nav.blogCategories.label` and `nav.blogTags.label` are in the two modules' own
  `i18n/{en,pl}.json`; `appShell.nav.cmsPages`, `appShell.nav.cmsBlocks`,
  `appShell.nav.cmsTemplates`, `appShell.nav.cmsHooks`, `appShell.nav.blogPosts`,
  `appShell.nav.blogCategories` and `appShell.nav.blogTags` are removed from the shared bundle
  in both shipped languages, nothing rendering them any more. **A consumer resolving one of
  those seven keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **Neither module declares a new palette action, and neither loses one.** `cms` has declared
  `new-page` and `blog` `new-post` all along, and the admin application's own palette table
  never carried a hand-written row for either — so unlike batches 10, 13 and 14 there was
  nothing to convert.

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

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

- b0df9c1: A shop can tell crawlers its CMS pages exist, and an operator is told where a page will live.

  **`@endora-commerce/contracts`** gains four names, all additive:
  - `cmsPageIndexEntrySchema` / `CmsPageIndexEntry` and `cmsPageIndexResponseSchema` /
    `CmsPageIndexResponse` — `{ pages: [{ slug, updatedAt }] }`, the shape of
    `GET /api/v1/cms/pages/by-channel`. `slug` is the **per-channel** slug from
    `cms_page_sales_channels`, never `cms_pages.slug`: the address is per channel
    (Constitution XII) and the page row's own column is one value shared by all of them.
  - `cmsReservedSegmentsResponseSchema` / `CmsReservedSegmentsResponse` — the deployment's
    reserved first path segments, normalised.
  - `firstSlugSegment(slug)` — the first path segment of a CMS page slug, lowercased.
    `cmsSlugRe` permits `/`, so `pomoc/dostawa` is one page and its first segment is `pomoc`.
    It is published because **two** programs ask that question and must agree: the backend
    refusing a save, and the page editor warning while an operator types.
  - `ERROR_CODES.CMS_SLUG_RESERVED`.

  **`@endora-commerce/mod-cms`** gains two endpoints, a Setting and a refusal:

  ```
  GET /api/v1/cms/pages/by-channel            # storefront, channel-scoped, published-only
  GET /api/v1/admin/cms/pages/reserved-segments   # admin, `cms.read`
  ```

  The first is what a sitemap is built from. Until now the reference storefront advertised **no
  CMS URL to any crawler at all** — its `SITEMAP_DYNAMIC_ROUTES` named the route _pattern_, which
  is a declaration for the indexability check's reconciliation and says nothing about the rows
  behind it. Both routes are registered inside the module's existing `ctx.routes` seam, so both
  answer `503 MODULE_DISABLED` while `cms` is switched off and the storefront's sitemap then
  advertises no CMS URL and still serves.

  The Setting is `cms.reserved_slug_segments` — `valueType: 'json'`, `defaultValue: []`, in the
  existing `cms` group. A CMS page is served at the storefront root, `/{slug}`, so a page slugged
  `cart` saves, publishes and is never shown: a root catch-all is Next's lowest-priority match and
  the storefront's own `/cart` wins. **Nothing in this change creates that precedence**; what it
  removes is the silence. `CmsPageService.create` and `.patch` refuse a slug whose first segment
  the deployment reserves, with `409 CMS_SLUG_RESERVED` carrying `details.segment`, and the page
  editor reads the same value and warns inline while the operator types. A patch that writes no
  slug is not refused, so a page whose slug predates the reserved set stays editable.

  **The default is empty and that is not a gap.** The set is a fact about a _storefront's route
  table_; a headless backend serves storefronts it did not build, so a list shipped inside `cms`
  would be a derived fact about a consumer written into the owner. The reference storefront
  publishes its own as `RESERVED_TOP_LEVEL_SEGMENTS` in `storefront/app/reserved-segments.ts`,
  reconciled against its route tree in both directions by `check:storefront-indexability`; a
  deployment copies its value from there.

  Nothing is removed and no existing shape changes.

- 661e80d: Fourteen new packages: the **second** batch of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time, then ten together; these fourteen are the
  same shape as the ten, and the properties below hold fourteen times over.

  **One changeset, not fourteen**, for the reason batch one gives: a changeset is written for
  the consumer of a package, and a package that did not exist a moment ago has no upgrader to
  instruct. What genuinely differs per package is its layer inventory, and that is the table.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                     | Subpaths                         | Entities                                                                                                                                                                                                                                                                                                                                       | Migrations | Ships          |
  | ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-admin-notifications`  | `.`, `./backend`, `./migrations` | `AdminNotificationRead`, `AdminNotification`                                                                                                                                                                                                                                                                                                   | 1          | `dist`         |
  | `@endora-commerce/mod-api-keys`             | `.`, `./backend`, `./migrations` | `ApiKey`                                                                                                                                                                                                                                                                                                                                       | 1          | `dist`         |
  | `@endora-commerce/mod-linkedin-ads`         | `.`, `./backend`, `./migrations` | `LinkedInConversionMapping`                                                                                                                                                                                                                                                                                                                    | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-sales-channels`       | `.`, `./backend`                 | —                                                                                                                                                                                                                                                                                                                                              | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shopping-lists`       | `.`, `./backend`, `./migrations` | `ShoppingListItem`, `ShoppingList`                                                                                                                                                                                                                                                                                                             | 2          | `dist`         |
  | `@endora-commerce/mod-delivery-methods`     | `.`, `./backend`, `./migrations` | `DeliveryMethod`                                                                                                                                                                                                                                                                                                                               | 2          | `dist`         |
  | `@endora-commerce/mod-prompt-actions`       | `.`, `./backend`, `./migrations` | `PromptActionRequest`                                                                                                                                                                                                                                                                                                                          | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-mfa`                  | `.`, `./backend`, `./migrations` | `MfaEnrolment`, `MfaOrganizationPolicy`, `MfaRecoveryCode`, `MfaSocialIdentity`                                                                                                                                                                                                                                                                | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-webhooks`             | `.`, `./backend`, `./migrations` | `WebhookDelivery`, `Webhook`                                                                                                                                                                                                                                                                                                                   | 3          | `dist`         |
  | `@endora-commerce/mod-transactional-emails` | `.`, `./backend`, `./migrations` | `EmailBlockSalesChannel`, `EmailBlock`, `EmailTemplateSalesChannel`, `EmailTemplate`, `TransactionalEmailContent`, `TransactionalEmail`                                                                                                                                                                                                        | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-cms`                  | `.`, `./backend`, `./migrations` | `CmsBlock`, `CmsHookBlockAttachment`, `CmsHook`, `CmsPage`, `CmsTemplate`                                                                                                                                                                                                                                                                      | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-pwa`                  | `.`, `./backend`, `./migrations` | `PushMessageDelivery`, `PushMessage`, `PushSubscription`, `PwaIconRendition`                                                                                                                                                                                                                                                                   | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-newsletter`           | `.`, `./backend`, `./migrations` | `NewsletterAutomationRun`, `NewsletterAutomation`, `NewsletterCampaignSubscriber`, `NewsletterCampaign`, `NewsletterCustomField`, `NewsletterEmailBlockSalesChannel`, `NewsletterEmailBlock`, `NewsletterEngagementEvent`, `NewsletterSendRecord`, `NewsletterSubscriberTag`, `NewsletterSubscriber`, `NewsletterSuppression`, `NewsletterTag` | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-returns`              | `.`, `./backend`, `./migrations` | `Refund`, `ReturnCaseAttachment`, `ReturnCaseComment`, `ReturnCaseItem`, `ReturnCase`, `ReturnDeliveryMethod`, `ReturnListSavedView`, `ReturnReason`, `ReturnShipment`, `ReturnStatusTransition`, `ReturnStatus`                                                                                                                               | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168) — type-only exports included, which this batch measured rather than assumed:
  two packages published their entities' row types so the dev seed could name them, and
  `module-package-entity-surface.test.ts` refused both, in as many words — _"that is the one
  thing that makes a foreign module's `import type { … }` compile"_. The exports are gone and
  the seed takes each class off the published array by name.

  **One of the fourteen owns no table and says so with an empty array rather than by
  omission.** `@endora-commerce/mod-sales-channels` exports `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export
  with `[]`, so "this module has no table" and "somebody forgot the array" would otherwise
  arrive as one silence, whose only symptom is a query against a table nobody created.

  **One package publishes a type on `./backend` that is not an entity**, and it is there
  because a composition root has to name a contribution it supplies:
  `@endora-commerce/mod-shopping-lists` re-exports `ShoppingListService`. A root cannot reach
  a package's internal file — `rootDir` makes a relative specifier into `packages/` TS6059
  even for an `import type` — so a contribution shape has to be on a published subpath or it
  is unnameable.

  **Two packages declare a `@fastify/*` dependency nothing imports.**
  `@endora-commerce/mod-mfa` peers on `@fastify/cookie` and `@endora-commerce/mod-pwa` on
  `@fastify/multipart`, because `reply.setCookie`, `request.isMultipart()` and
  `request.file()` are declaration-merging augmentations rather than imports. Inside the
  application those arrived ambiently through the host's own dependency; a package compiles
  against its own manifest, where an unnamed dependency does not exist. Both write
  `import type {} from '@fastify/…'`, which is type-only: the plugin is still the host's to
  register.

  **`@endora-commerce/mod-newsletter` and `@endora-commerce/mod-pwa` also carry a companion
  `@types/*` in `devDependencies`** — `@types/nodemailer` and `@types/web-push` — which the
  manifest generator now derives. Nothing imports a `@types` package; the compiler finds it
  through `node_modules/@types`, which inside a package is the package's own declaration, so
  a module importing a JS-only library did not build until this landed.

- 1f07b01: The fifteen `pageBuilder.colorPalette.*` strings move from `mod-cms`' bundle into
  `mod-i18n`'s, in both shipped languages (feature 091, P5b — the remedy P5a applied to the
  other thirty-three chrome keys, arriving for the one chrome file P5a's set did not include).

  `ColorPaletteModal` is the shared page-builder chrome's, not `cms`' screen: `cms`,
  `invoices` and the e-mail builder all render it, and it now ships in
  `@endora-commerce/page-builder-admin`. A package cannot depend on one module's bundle for
  strings three modules read, and a namespace is resolved at runtime by string — so a key the
  namespace does not carry renders `cms.pageBuilder.colorPalette.title` into the operator's
  screen instead of failing. The keys therefore live where the reader does, which for chrome
  is the synthetic `core` scope `mod-i18n` serves.

  **If you ship a translation override** keyed `cms.pageBuilder.colorPalette.*`, re-key it to
  `core.pageBuilder.colorPalette.*`. The fifteen keys, their values and both languages are
  otherwise unchanged; no other `cms` key moves, and the other sixty-five `pageBuilder.*` keys
  in `mod-cms`' bundle are its own screens' and stay.

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

- b8bd8c7: `cms` declares the ten error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  `CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` is among them despite naming two other
  modules' nouns — it is this module's refusal, raised twice in
  `cms-page-service.ts` — and `CMS_REFERENCED` is the cross-entity reference guard
  for pages, blocks and templates rather than a narrowing of `assets_library`'s
  `ASSET_REFERENCED`. Going the other way, the seven raises this module makes of
  `VERSION_CONFLICT` and `VALIDATION_FAILED` are the platform's codes and are not
  declared here.

  All ten already carry a written sentence in both `en` and `pl` in this package's
  own `i18n/` bundles, so no sentence moves and none is added. No `tokens`: none
  of the 32 raises of these codes passes a `details.code` discriminator.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [11fc9f3]
- Updated dependencies [afedd32]
- Updated dependencies [f66ce9b]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [1f07b01]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/cms-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/page-builder-admin@0.7.0
