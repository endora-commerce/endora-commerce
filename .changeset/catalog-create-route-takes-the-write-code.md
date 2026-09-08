---
'@endora-commerce/mod-catalog': minor
---

The product create form is a declared admin route on `catalog:write`, and the two
*New product* affordances on the product list are gated on the same code (D-221).

`contributions.routes` gains `/catalog/products/new` before the existing
`/catalog/products/:id`, which keeps `catalog:read`. Both entries resolve the same
`ProductEditor` component — the id `new` is what its own `params.id === 'new'` reads — so
this splits one screen's two entry points rather than adding a screen.

**What changes for an operator.** A role holding `catalog:read` and not `catalog:write`
can no longer open the product create form, and no longer sees a button offering it. That
role could not create a product before either: the save refused. What it had was a form it
could fill in and not submit, and since feature 091 the admin router enforces a route's
declared code, so once this route exists an ungated button would send that role to the
admin's not-found page — which says nothing about permissions. The affordance therefore
moves with the route.

**The manifest declares `{ code: 'catalog:write', requires: ['catalog:read'] }`.**
`ProductEditor`'s loader fetches `/api/v1/admin/catalog/categories` and
`/api/v1/admin/catalog/attribute-sets` unconditionally — before any `isNew` branch, with
the create path using the second to select the new product's default attribute set — and
both are `requireAdmin('catalog:read')`. So the write code alone opens the route and
cannot render the form. `requires` is advisory (D-175): nothing is refused at the gate, and
the role editor renders the shortfall with a one-click add. The requirement is attached to
the code rather than to the screen, so every holder of `catalog:write` is advised to add
`catalog:read`, including holders of gates other modules enforce with it.

**If you consume this package's `./admin` contributions**, the `routes` array is one entry
longer and its order changed; nothing was removed and no `requiredPermission` on an
existing entry moved. `i18n/{en,pl}.json` gain `productsList.empty.readOnly`, the
empty-state sentence a role without the write code sees in place of the one that carried
the create link.
