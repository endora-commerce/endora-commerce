---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/platform': patch
---

`organizations` now creates `organizations.customer_group_id` and
`organizations_customer_group_id_index` itself, in the new
`Migration20261117T033143OrganizationsCustomerGroupColumn` (issue #611). Until now only
`price_lists`' `Migration20260426T075235PriceListsPricingInit` created them, although the column
belongs to `organizations`' `Organization` entity. That migration keeps its class name and no
longer names `organizations` in `up()` or `down()`. The new migration uses `if not exists` with the
same type and index name, so a database that has already applied the old migration does not change.
`FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `price_lists` writing `organizations`.
