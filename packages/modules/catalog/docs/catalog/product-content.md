---
title: Product content
description: Page Builder documents kept per product in content attributes and rendered on the product page's description tab.
---

# Product content

A **content attribute** holds one Page Builder document per language for each
product — a buying guide, a feature banner, a size chart. The product page shows
it in the description tab (**Opis**), below the plain description. Anything the
Page Builder offers can go into it, including formatted text written in its
rich-text block.

## Defining a content attribute

On **Catalog → Attributes**, create an attribute with the type **Page Builder
content**. The type comes with fixed settings:

- it is always kept **per language**;
- it cannot be searchable, filterable, comparable, a variant axis, a
  promotion or price-list rule, mass-editable, quick-searchable, required,
  shown in the **Parametry** tab, or set per sales channel. The form does not
  offer those settings, the list shows them locked, and the API refuses each one
  with `400 VALIDATION_FAILED`, naming the setting;
- it has no options;
- its type cannot be changed later, and no other attribute can be changed into
  it (`409`).

Then add the attribute to an [attribute set](./attribute-sets.md). Its position
in the set is the order in which the product page shows the set's content
attributes. The type is offered for products only — the generic custom-field
screens of other records do not offer it.

## Authoring

On the product's **Attributes** tab, each content attribute of the product's
saved attribute set is a card rather than an input, below the attribute values.
The card shows, per editing language, whether content is filled in, and a short
summary of what is stored. The cards are the same at every scope of the editor's
scope switcher: content has no value per sales channel.
**Edit content** opens the product content screen
(`/catalog/products/:id/content/:attributeKey`). It has:

- a **language** switch — English, Polish, and any other language the stored
  content already has;
- the **Page Builder** canvas for the selected language;
- **Save content** — one save stores every language you edited. Leaving the screen with
  unsaved edits asks first. The back link returns to the product's Attributes
  tab.

The card offers no link while the product has not been saved yet, or while the
Details tab shows a different attribute set from the saved one — save the
product first.

To remove a language, delete every block from its document and save. A language
with no block is not stored, and an attribute with no language left holds no
value.

Reading content needs the catalogue read permission, and saving it the catalogue
write permission. Without the write permission the screen is read-only.

The canvas offers the Page Builder's **Translate** action under its usual
switch and permission. A translation lands in the canvas and is stored only when
you press **Save content**.

## On the storefront

The description tab is shown when the product has a plain description **or** at
least one content attribute with content. It shows the plain description first,
then each content attribute in the attribute set's order. No heading or label is
printed above a document — the document carries its own headings.

Each document is resolved to one language in this order: the visitor's language,
the sales channel's default language, English, then any language that has
content. A language whose document holds no block is skipped. The content is the
product's, so it is the same whichever variant is selected.

The blocks are drawn by the storefront's Page Builder renderer — the one that
draws CMS pages — so HTML an operator typed is sanitised the same way, and a
block that belongs to a switched-off module is not drawn. A saved change is
visible on the next load of the product page.

Content never appears in the **Parametry** tab. That tab lists only attributes
marked visible on the product page that hold a value, and it is not shown when
there is none.

## When the CMS module is off

Product content needs the CMS module, which provides the Page Builder:

- the product page shows **no** content, and the product API returns none — a
  product whose only description was content shows no description tab;
- the admin cards keep showing which languages hold content, but offer no
  **Edit content** link, and the content screen explains that no editor is
  available. An operator without access to the CMS module sees the same;
- nothing stored is changed or deleted. Switching the CMS module back on brings
  the content back on the product page and makes it editable again.

This is stricter than [category page content](./category-content.md), which
keeps rendering while the CMS module is off.

## Lifecycle

- **Duplicate** — the copy carries the same content.
- **Attribute set** — when a content attribute leaves the product's attribute
  set, its content is kept but not offered: the card disappears, the content
  screen answers *not available*, and the product page leaves it out. Adding the
  attribute back brings it all back.
- **Product delete** — a deleted product's content stays stored with it, and is
  unreachable from the admin, the API and the storefront. Assets embedded in it
  are no longer reported as in use.
- **Attribute delete** — deleting a content attribute deletes its content on
  every product. The delete confirmation says how many products carry content
  first (see [Attributes](./attributes.md#deleting-an-attribute)).
- **Assets** — a library asset embedded in a product's content is reported as in
  use by that product, so it cannot be deleted while the content holds it.

## What content does not take part in

Content attributes are deliberately left out of:

- values per sales channel or per channel language (the editor's Channel and
  Channel × language scopes): the editor's save and the connectors' scoped write
  refuse a content attribute's key;
- product export and import — export omits them, and a non-empty cell under a
  content attribute's `attribute:<key>` column is refused for that cell
  (`content_attribute`), the rest of the row being imported;
- the external (integration) API and PIM/ERP connectors, and the API-key read of
  an attribute set;
- the products bulk editor;
- product feeds — neither as a feed field nor in a selection rule;
- storefront search, quick search and the admin product search;
- promotions, price lists, comparison and storefront filters;
- the product list, the search response and every other product read except
  the product page's.

## For integrators

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/products/:idOrSlug?include=content` | storefront | The product detail with `contentAttributes`: `[{ key, language, content }]`, each document resolved to the caller's language, in set order. Without `include` the response has no `contentAttributes` key. `include` accepts only `content` |
| `GET /api/v1/admin/catalog/products/:id/content` | admin (`catalog:read`) | The card list: `{ productId, attributeSetId, attributes: [{ attributeId, key, label, labelDefault, position, languages: [{ language, filled, blocks, excerpt }] }] }`. Summaries only, never documents |
| `GET /api/v1/admin/catalog/products/:id/content/:attributeKey` | admin (`catalog:read`) | One attribute's envelope: `{ productId, attributeKey, content }` with `content` = `{ languages: { "<code>": <document> } }` or `null` |
| `PUT /api/v1/admin/catalog/products/:id/content/:attributeKey` | admin (`catalog:write`) | Replaces the envelope; the body is `{ "content": <envelope> }`, and `{ "content": null }` clears it. Answers the stored, normalised value |

The envelope is the one a CMS page uses and is limited to 1 MiB (1 048 576
bytes) of JSON across all languages; a larger one is refused with
`400 VALIDATION_FAILED`. A key that is not a content attribute of the product's
current set is refused with `400 ATTRIBUTE_VALUE_REJECTED`. An unknown or deleted
product answers `404 PRODUCT_NOT_FOUND`. The `PUT` body is validated by the
handler, so the published OpenAPI document shows no request schema for it.

A content attribute's key is refused in `attributeValues` everywhere —
`POST`/`PATCH /api/v1/admin/catalog/products`, the API-key
`PUT /api/v1/catalog/products/by-sku/:sku` and the catalogue's write port — with
`400 ATTRIBUTE_VALUE_REJECTED`; content is written only through the route above.

Saving runs the `product.content.update` command — the audit entry records the
attribute and which languages the envelope carried, not the documents — and
emits `product.content.updated.v1`, on which the storefront's product cache is
flushed. It does not emit `product.updated.v1`, so a content save does not
re-index the product.

A connector that maps attribute types should skip `page_builder`: it is a value
type of `customFieldValueTypeSchema`, `attributeValueTypeSchema` and
`apiAttributeTypeSchema` in `@endora-commerce/contracts`, and none of the
integration paths carries it. The content schemas are
`productContentEnvelopeSchema`, `putProductContentRequestSchema`,
`adminProductContentSchema`, `adminProductContentListSchema` and
`productPageContentAttributeSchema`.

## Providing an editor

The content screen owns the document and no editor: it renders the admin zone
`product.content.editor` and saves what the zone reports. A module that owns a
Page Builder contributes a component there; its props are
`{ productId, attributeKey, language, data, onChange }`, where `data` is the
document to open and `onChange` reports every edit. The contributor never saves.
When nothing contributes, the card and the screen say that no editor is
available.
