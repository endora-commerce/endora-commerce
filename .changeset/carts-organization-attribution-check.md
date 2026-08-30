---
'@endora-commerce/mod-carts': minor
---

`carts` refuses a row that names a customer account and no organisation.

A new migration adds
`check ("customer_account_id" is null or "organization_id" is not null)` to the
`carts` table, after deriving the missing organisation from the account that
owns the cart and refusing — with the count and up to twenty ids, deleting
nothing — anything left over.

**Why it matters to anything writing this table.** `Cart` is `@CustomerScoped`
and carries its own `organization_id`, and the tenant filter's `allowed-set` arm
reads that column: a sales representative sees the carts of the organisations
they are assigned to. MikroORM applies no filter to `INSERT`, so until now a
cart written with an account and a null organisation was simply invisible to
that representative, with nothing anywhere reporting it. The database is the
only place that refusal can live.

**What can break.** An insert or update that sets `customer_account_id` without
setting `organization_id` now fails with a check violation instead of writing a
row nobody can attribute. Every write path in this package already stamps it —
`CartService`'s owned-create branch does, its anonymous branch legitimately
leaves both columns null, and the anonymous→customer merge completes the
anonymous cart rather than re-owning it — so no call site changes. A fixture or
an external writer that built a cart by hand is the case to look at.

The constraint is an **implication**, not an equivalence: an ownerless cart is a
representable state and needs no organisation. No foreign key is added.
