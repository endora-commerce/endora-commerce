---
'@endora-commerce/mod-carts': patch
---

Cart approval works end to end (issue #619). For an Organization that requires cart approval:

- `POST /api/v1/cart/submit-for-approval` now stores the cart as `pending`, with its audit entry, in one write. It used to answer `200 { approvalStatus: 'pending' }` and store nothing, so a second submit was accepted again; it is now refused with `422 CART_APPROVAL_ALREADY_SUBMITTED`.
- An Organization administrator now reaches the carts of every member of their own Organization on `GET /api/v1/organization/carts`, `GET /api/v1/organization/carts/:id`, `POST …/:id/approve` and `POST …/:id/reject`. These read only the administrator's own carts before, so a member's cart answered `404 NOT_FOUND` and the list showed none. A cart of another Organization still answers `404`, and a member who is not an administrator is still refused with `403 FORBIDDEN`.
- Switching the policy off through `PATCH /api/v1/organization/policies/cart-approval` now returns every member's pending or approved cart to `not_required`; it reset only the administrator's own before.
- Changing an approved cart now stores it as `pending` again, as the re-arm rule says; the change was not stored before.
- The cart answers (`GET /api/v1/cart` and the line, coupon and quantity answers) now give `primaryCta: 'submit_for_approval'` for a basket a member must send for approval. It was always `checkout`, so the storefront offered checkout instead of the submit.

`CartsDeps` (the options of `registerCartRoutes`) gains a required `cartApprovalPolicy` member; the module's own composition provides it.
