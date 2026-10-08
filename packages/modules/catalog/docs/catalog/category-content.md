---
title: Category page content
---

# Category page content

Content an operator authors for one category's storefront page — an
introduction, a banner, a buying guide — rendered above the product grid. It is
a Page Builder document, so anything the Page Builder offers can go into it,
including formatted text written in its rich-text block.

## For operators

Open **Catalog → Categories** and choose **Content** on the category's row. The
content screen has:

- a **language** switch — content is kept per language, like the category's
  name. Each language has its own document, and a language you leave empty
  shows the content of another one rather than nothing;
- the **Page Builder** canvas for the selected language;
- **Save content** — one save stores every language you edited.

The storefront shows a saved change on the next visit to the category page.

To remove the content, delete every block from the document and save. A
category with no content shows its product listing exactly as before.

The **Content** action appears only while a module that provides a Page Builder
(the CMS module) is enabled and you have access to it. Content that is already
stored is kept while that module is off.

## On the storefront

The category page renders the content between the category heading and the
listing toolbar, on the **first page** of the listing only — a visitor paging
through products is not shown the introduction again above every page.

The document is resolved to one language in this order: the visitor's language,
the sales channel's default language, English, then any language that has
content. A language whose document holds no block is skipped.

The content follows the category's visibility: an inactive category, or one
under an inactive parent, has no page and its content is not served.

The blocks are drawn by the storefront's Page Builder renderer — the one that
draws CMS pages — so HTML an operator typed is sanitised the same way, and a
block that belongs to a switched-off module is not drawn.

## For integrators

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/categories/:id/content` | storefront | The document resolved to the caller's `Accept-Language`: `{ categoryId, language, content }`. `content` is `null` when nothing is authored. `404` for a category the category tree does not list |
| `GET /api/v1/admin/catalog/categories/:id/content` | admin (`catalog:read`) | The whole envelope: `{ categoryId, content }` with `content` = `{ languages: { "<code>": <document> } }` or `null` |
| `PUT /api/v1/admin/catalog/categories/:id/content` | admin (`catalog:write`) | Replaces the envelope. `{ "content": null }` clears it |

The envelope is the one a CMS page uses and is limited to 1 MiB of JSON across
all languages. Each document is stored as the Page Builder wrote it and is
opaque to this module.

The category list (`GET /api/v1/admin/catalog/categories`) and the category
tree do **not** carry the content, and neither does the search index, a product
feed, or an import or export.

Saving runs the `category.content.update` command — the audit entry records
which languages the envelope carried, not the documents — and emits
`category.content.updated.v1`, on which the storefront's category cache is
flushed. It does not emit `category.updated.v1`, so a content save does not
re-index the category's products.

The schemas are `categoryContentEnvelopeSchema`,
`putCategoryContentRequestSchema`, `adminCategoryContentSchema` and
`categoryPageContentSchema` in `@endora-commerce/contracts`.

## Providing an editor

The content screen owns the document and no editor: it renders the admin zone
`category.content.editor` and saves what the zone reports. A module that owns a
Page Builder contributes a component there; its props are
`{ categoryId, language, data, onChange }`, where `data` is the document to
open and `onChange` reports every edit. The contributor never saves.
