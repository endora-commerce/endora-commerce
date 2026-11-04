---
---

Storefront organization area for organization roles (`specs/170-organization-roles/`, WP-09). Only the `storefront` application changes, which is in the Changesets `ignore` list; no published package's emitted code moves. The account navigation offers *Members* and *Roles* to administrators and *Carts to approve* to `carts.approve` holders, none of them in a personal Organization; new role list, create and edit pages (a refused save keeps its input); the members page assigns and invites by `roleId`; the account page lists what the member's role allows (not in a personal Organization); the cart-approval policy page is removed (OR-3).
