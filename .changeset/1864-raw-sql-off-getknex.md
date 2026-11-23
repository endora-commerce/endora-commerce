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
knex query builders and `getKnex().raw(…)` calls are now parameterised statements run through
`em.execute(sql, params)`; the two order-lock transactions (`invoices`' issuing lock and
`returns`' settlement lock) use the connection API (`getConnection().transactional` with
`execute(…, trx)`). Results are unchanged; reads that used to take a pooled connection of their
own now run on the EntityManager's transaction context when one is open.

`@endora-commerce/platform`: the foreign-schema guard now judges a package migration's
`execute(sql, params)` with its `??` identifier placeholders bound, so a table named only
through a parameter (`execute('delete from ??', ['orders'])`) is refused like a literal one.
