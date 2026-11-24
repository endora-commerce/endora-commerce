---
'@endora-commerce/platform': patch
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
---

Raw SQL no longer goes through `getKnex()` (issue #1864, preparing MikroORM 7). The modules'
knex query builders and `getKnex().raw(…)` calls are now `em.execute(sql, params)` statements
with `?` / `??` placeholders, which MikroORM 6 fills in client-side with escaping
(`Platform.formatQuery`); a JavaScript array given to one `?` expands to a comma-separated list,
so id sets use one placeholder per id or a PostgreSQL array literal. The two order-lock
transactions (`invoices`' issuing lock and `returns`' settlement lock) use the connection API
(`getConnection().transactional` with `execute(…, trx)`). Results are unchanged; reads that used
to take a pooled connection of their own now run on the EntityManager's transaction context when
one is open.

`@endora-commerce/platform`: the foreign-schema guard now judges a package migration's
`execute(sql, params)` as the ORM renders it (`Platform.formatQuery`), so a table named through
a parameter is refused like a literal one.
