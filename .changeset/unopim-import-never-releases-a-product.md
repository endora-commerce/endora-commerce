---
'@endora-commerce/mod-pim-unopim': patch
---

A UnoPim import no longer puts a product back on sale.

The product phase used to re-activate any linked product it found `inactive`, on every
run, before anything had asked why it was inactive:

```ts
link.withdrawnAt = null;
if (product.status === 'inactive') {
  await deps.catalogAdmin.updateProduct(product.id, { status: 'active' });
}
```

The one fact that distinguishes *"this connector withdrew it"* from *"an administrator
switched it off"* is `link.withdrawnAt`, and it was cleared on the line above the
condition — which read `product.status` alone. So the branch could not tell the two
apart, and answered both the same way.

Two consequences, both measured against a running platform:

- **A product withdrawn under FR-025 came back on sale** the next time UnoPim published
  the SKU again. Withdrawal was a state the connector could not keep for longer than one
  run.
- **An administrator's deactivation of any product this connection manages was
  overwritten** on the next import. That needed no deletion and no reappearance: an
  operator switching a product off and an import running afterwards was enough.

Both are now gone. An import writes a product's status in exactly one direction — to
`inactive`, when UnoPim deletes or disables the SKU — and never back. A product that
reappears at the source has its withdrawal mark cleared, because the mark records what the
source last said and would otherwise block a later, genuine withdrawal; the product itself
stays where the administrator left it. Releasing a product is the administrator's decision
and survives every import (FR-024), which is the same rule that makes a newly imported
product `draft` rather than `active`.

**If you relied on the old behaviour** to bring products back automatically, there is no
replacement and no setting: re-activate the product from the product editor, or from
`PATCH /api/v1/admin/catalog/products/:id`. Nothing else changes — the run counters, the
withdrawal reporting and the link's `lastSyncedAt`, passport and adopt-by-SKU behaviour
are untouched.
