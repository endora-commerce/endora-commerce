---
"@endora-commerce/page-builder-core": minor
"@endora-commerce/page-builder-admin": minor
"@endora-commerce/cms-components": minor
"@endora-commerce/email-components": minor
"@endora-commerce/mod-cms": minor
"@endora-commerce/mod-blog": minor
"@endora-commerce/mod-invoices": minor
"@endora-commerce/mod-newsletter": minor
"@endora-commerce/mod-transactional-emails": minor
"@endora-commerce/cli": minor
---

The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
its package at 0.21 (`npm install @measured/puck` now prints *"Puck has moved"*), and these
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
