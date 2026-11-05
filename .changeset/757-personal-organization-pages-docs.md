---
'@endora-commerce/mod-organizations': patch
---

The module page's *Roles on the storefront* section now says that a personal (B2C) Organization's member is offered neither *Organization* nor *Org addresses* in the storefront account: `/organization` redirects to `/account`, `/organization/addresses` to `/addresses`, the profile shows no *Organization* row, and the checkout's billing tax-id field starts empty instead of with the synthetic tax id. Documentation only; no code in the package changed.
