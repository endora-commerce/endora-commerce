---
---

Storefront order actions and organization addresses by organization permission (`specs/170-organization-roles/`, WP-16). Only the `storefront` application changes, which is in the Changesets `ignore` list; no published package's emitted code moves. The order detail offers *Order again → cart* only to a member whose role holds `carts.create` and *Order again → quote request* only to one holding `quote_requests.create`. `/organization/addresses` keeps the address list for every member and shows the add form and the *Remove* buttons only to a holder of `addresses.manage`; anyone else reads one line saying their role does not allow adding or removing addresses. A session the storefront cannot read keeps the page as before, and the API stays the gate.
