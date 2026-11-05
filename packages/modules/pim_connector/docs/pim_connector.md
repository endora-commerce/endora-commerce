---
title: PIM connector shared layer
sidebar_label: PIM connector shared layer
description: The locale-mapping contract, the whole-field protection grammar and the scoped write rules every PIM connector writes products through.
---

# PIM connector shared layer (`pim_connector`)

This page is for the engineer writing or maintaining a PIM connector. It states what a connector
sends to Endora since the three-level scope model: how source locales map to sales channels and
languages, which source locale writes the Global value, how a value is encoded, which fields a
connector may write and how field protection names a field. A connector's own transport, screens
and storage are documented by that connector's package.

`pim_connector` owns the mapping contract and the protection grammar. The product write itself is
the `catalog` module's scoped write port. The types live in `@endora-commerce/contracts`
(`pim-locale-mapping.ts`, `pim-field-path.ts`, `scoped-write-encoding.ts`).

## The three levels a connector writes

A product value lives at one of three levels:

| Level | Meaning |
| --- | --- |
| **Global** (G) | The value every channel and language uses unless it overrides it. |
| **Channel** (C) | The value for one sales channel, in every language of that channel. |
| **Channel and language** (C×L) | The value for one language of one sales channel. |

There is no "language only" level: a PIM locale is always mapped onto a channel and language
pair, or onto Global.

## The locale mapping

A connector stores one mapping per connection and passes it to `planLocaleWrites()`:

```ts
{
  sourceLanguageForGlobal: 'en_US' | null,
  entries: Array<{
    sourceLocale: 'pl_PL',          // pl_PL, pl-PL or pl; compared case-insensitively, _ equals -
    sourceChannel: 'ecommerce' | null, // the PIM's channel or scope code; null matches any
    targets: Array<{ channelId: '<uuid>', languageCode: 'pl-PL' }>, // 1 to 64 targets
  }>,                                // at most 500 entries, no duplicate (locale, source channel)
}
```

The planner applies these rules, in this order:

1. Non-localizable values are written to **Global**.
2. The locale named by `sourceLanguageForGlobal` writes **Global** for localizable fields, and also
   writes its mapped targets when it has entries.
3. A locale matched by an entry writes each target at **Channel and language**. An entry naming
   a source channel matches only that channel; an entry with `sourceChannel: null` matches any.
   The more specific entry wins.
4. A locale matched by nothing is **not written**. It comes back in `unmapped`, and the run
   reports one warning per locale with the number of products affected.
5. A target the product is not valid for (a channel it is not sold in, or a language the channel
   does not offer) comes back in `skipped` for that product. The other targets are still written.
6. A field that has no Channel and language level (for example `status`) is written at the
   target's **Channel** level.
7. When two locale groups land on the same field and scope, the specific entry wins, then the
   first entry in mapping order.

## The write encoding

Every scoped write carries an explicit operation, never a bare value that could be read as one:

| Intent | Operation | JSON form | CSV form |
| --- | --- | --- | --- |
| Set a value | `{ op: 'set', value }` | the value | the text |
| Deliberately empty | `{ op: 'empty' }` | `null` | `NULL` |
| Inherit from the level above | `{ op: 'inherit' }` | `{ "inherit": true }` | `INHERIT` |
| No change | field absent | absent or `""` | empty cell |

This is not JSON Merge Patch: `null` means "empty on purpose", not "remove". Inheriting at
Global, and emptying a required field (`name`, `urlKey`, required attributes), are refused per
cell. A value whose shape looks like an operation (for example a custom field holding
`{ "op": "empty" }`) is still a value when the connector sends it inside `{ op: 'set' }`.

## What a connector may write

The `catalogProductScopeWritePort` accepts: `name`, `description`, `attribute:<key>` (attributes
of the product's attribute set, checked against their value type and levels),
`gallery:<itemId>:altText`, `attachment:<id>:name` and `:description`, `packagingUnit:<id>:name`,
`urlKey`, `status` and the publication `window`. Status, window and URL key go through the same
validation and the same completeness gate as the editor.

It refuses with `not_supported`: `audience`, `product.*`, `seo:*`, `galleryRole:*`, `*:hidden`,
`minOrderQuantity` and `returnable`. A connector writes SEO through the `seo` module, not through
this port.

Each product is one call: at most 2 000 cells, no duplicate (field, scope), subject ids bound to
the product, and `options.source` set to the connector's registered module id. Refusals come back
per cell and the rest of the product is applied. A taken URL key is reported, never taken over.

## Field protection: whole fields only

An operator protects a **field**, never one language or channel of it. A protected path removes
every scope of that field from the planned writes (`filterProtectedWrites()`). The grammar is:

```text
name
description
attribute.<key>
seo.metaTitle | seo.metaDescription | seo.metaKeywords
gallery.<n>
attachment.<uuid>
price.<uuid>.<CUR>
category.<uuid>
```

A locale or channel segment (the grammar before the three-level model, such as
`name.pl_PL` or `attribute.colour.<channel-uuid>`) is invalid: `canonicalisePimFieldPath()`
returns `null` for it. Stored protection rules in a connector's own database are not migrated by
Endora. A connector that kept such rules must rewrite them to the whole-field form.

## The CSV import uses the same contract

The products CSV import of the `import_export` module uses the same mapping (stored there as an
import profile), the same planner and the same encoding. Protection does not apply to CSV.
