---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/platform': patch
---

`carts`' `Migration20260611T140352CartsConsolidation` no longer adds or drops
`organizations.requires_cart_approval` (issue #611). The column belongs to `organizations`, which
already drops it in `Migration20261104T094535OrganizationsDropLegacyRoleColumns` and re-creates it
in that migration's `down()`. The old migration keeps its class name, so a database that has
already applied it does not change. A database migrated from empty now never has the column; its
final schema is the same as before. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `carts`
writing `organizations`.
