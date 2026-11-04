---
'@endora-commerce/mod-carts': patch
---

`CartPlacementApplyPort.awaitsApproval` takes an optional `organizationRoleId`, the basket owner's organization role when the caller knows it (`specs/170-organization-roles/` FR-080). With it the cart-approval rule is judged from the role cache and the owner's account is not read; a caller that does not pass it is served as before.
