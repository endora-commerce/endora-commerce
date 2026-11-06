---
---

Storefront: no free text from the URL reaches the page (issue #790). Only the `storefront` application changes, which is in the Changesets `ignore` list; no published package's emitted code moves. After *Save to list*, the cart's `?listAdded=` carries the list's id and the banner reads the name of the buyer's own list, so a crafted link shows nothing. The quick-order preview no longer travels in the URL: it is kept in an httpOnly cookie the storefront writes itself, bound to the session and cleared once the cart or quote request is built; a list too long to keep is refused with a message asking to split it. The quote reference after a quick-order build is shown only when it is reference-shaped.
