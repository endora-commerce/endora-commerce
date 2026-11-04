---
'@endora-commerce/mod-carts': patch
---

A signed-in member's cart answers (`GET /api/v1/cart`, every cart write's reply and `POST /api/v1/cart/submit-for-approval`) judge the cart-approval rule with the role the request's actor already carries, so the permission port no longer reads the member's account on each of them (`specs/170-organization-roles/` FR-080, SC-004). `CartsDeps.resolveCartActor`'s and `CartsOrganizationRoutesDeps.resolveCartActor`'s `customer`, `CartsDeps.cartApprovalPolicy`'s buyer and `ApproveActor` gain an optional `organizationRoleId`; a composition that does not pass it is served as before. No response changes.
