---
title: Product scopes — Global, Channel and Channel × language
description: How a product value is set once for every channel and overridden per sales channel or per sales channel and language.
---

# Product scopes — Global, Channel and Channel × language

Every scoped product value lives at one of **three levels**:

- **Global** — one value for every sales channel and every language;
- **Channel** — one value for one sales channel, in every language that channel offers;
- **Channel × language** — one value for one sales channel in one of its languages.

There is no language-only level. A translation is a Channel × language value, or a Channel value when the channel
sells in one language. A value is resolved from the narrowest level that holds one:
**Channel × language → Channel → Global**.

## Which fields live where

| Field | Global | Channel | Channel × language |
| --- | --- | --- | --- |
| Name, description | yes | yes | yes |
| Text attributes marked *scopable* | yes | yes | yes |
| Other scopable attributes (numbers, selects, booleans) | yes | yes | — |
| Attributes not marked scopable | yes | — | — |
| Status | yes | yes | yes |
| Publication window, audience, minimum order quantity, returnable | yes | yes | — |
| URL key | yes | yes | yes |
| Gallery alt text, hide image, gallery roles | yes | yes | yes |
| Attachment name, description, hidden | yes | yes | yes |
| Packaging-unit name | yes | yes | yes |
| SEO title, description, Open Graph fields (owned by the `seo` module) | yes | yes | yes |

SKU, type, attribute set, categories, stock settings and the download file have one value for the whole product and
are edited at Global only. Writing one of them at another scope is refused with `GLOBAL_ONLY_FIELD`; writing a field
at a level it does not support is refused with `FIELD_NOT_AT_SCOPE`.

## Inherit, a value, or deliberately empty

At Channel and Channel × language each field is in one of three states:

- **Inherits** — the editor shows "Use value from *parent scope*" and the effective value comes from the level above;
- **Own value** — the value stored at this scope;
- **Deliberately empty** — an override that is empty on purpose. It stops the chain: a description emptied for one
  channel stays empty there even though Global has one. A required field (the name, a required attribute) cannot be
  emptied.

## The write encoding

Every writer — the editor's save, the import files and the PIM connector port — uses one encoding:

| Intent | JSON | CSV cell |
| --- | --- | --- |
| No change | the field absent, or `""` | an empty cell |
| Deliberately empty | `null` | `NULL` (the whole cell) |
| Remove the own value and inherit | `{ "inherit": true }` | `INHERIT` (the whole cell) |
| A value | the value | the text; `\NULL` and `\INHERIT` are the literal words |

This is **not** JSON Merge Patch, where `null` removes a member: here `null` stores an empty override and only
`{ "inherit": true }` removes one. It is also not Magento's `__EMPTY__VALUE__` marker. `INHERIT` at Global and an
empty required field are refused with `SCOPED_VALUE_INVALID`.

## Reading and saving a scope

- `GET /api/v1/admin/catalog/products/:id/scoped-values?channelId=&languageCode=` (`catalog:read`) answers every
  field's effective value at the scope, its source (`set`, `set_empty`, `inherited_channel`, `inherited_global`,
  `absent`), the levels it supports, what the completeness check misses at that scope and the product's
  `version`.
- `PUT /api/v1/admin/catalog/products/:id/scoped-values` (`catalog:write`) saves one scope in one Command with one
  audit entry. The body carries the `version` the editor read; a save made against an older version is refused with
  `409 VERSION_CONFLICT`, so two operators never overwrite each other silently.
- `POST …/scoped-values/copy` copies one Channel × language value to other channels of the product.

## Channels a product leaves

A value stored for a channel the product is no longer sold on, or for a language the channel no longer offers, is
kept but ignored. The scope map lists such rows so they can be removed; they come back into effect if the
product returns to that channel or language.

## Duplicating a product

**Duplicate** copies the product's values at every scope — Global, Channel and Channel × language, deliberately empty
values and inherit states included — for every field family above, in one audited Command. Two things are not
copied: URL keys (the copy gets a fresh Global key, because a key is one product's per channel) and status (the copy
starts inactive everywhere, so it is reviewed before it is sold).

## Related pages

- [URL Keys and Redirects](./url-keys-and-redirects.md) — key uniqueness per channel and redirects.
- [Gallery and Labels](./gallery-and-labels.md), [Attachments](./attachments.md),
  [Packaging Units](./packaging-units.md) — the media and packaging values per scope.
