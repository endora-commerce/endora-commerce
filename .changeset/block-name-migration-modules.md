---
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-ksef': patch
---

The stored Page Builder block names are namespaced, once, by five migrations.

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

Read-only, across all eleven columns, classifying every stored name as *will be renamed →
new name*, *already namespaced* or *unrecognised*. Run it before upgrading, resolve or accept
the unrecognised set, take a backup, upgrade, and run it again: every *will be renamed*
becomes *already namespaced* and the unrecognised set is unchanged.

`catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
the registry serves — the eight `catalog` blocks, the eight `orders` ones and
`ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.
