---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
---

A category can carry content for its storefront page, authored in the Page Builder.

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
