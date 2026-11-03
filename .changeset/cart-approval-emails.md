---
'@endora-commerce/mod-carts': minor
---

The cart-approval e-mails are sent (issue #651). `CartApprovalService` called an optional `CartEmailDispatch` that the `carts` composition never supplied, so nobody was told about a submit, an approve or a reject. The composition now supplies one, `createCartApprovalEmailDispatch` (`services/cart-approval-emails.ts`), which sends through `transactional_emails`:

- `cart_approval_requested` — to every active, unblocked administrator of the buyer's Organization when a member sends a cart for approval;
- `cart_approved` — to the buyer, naming who approved it;
- `cart_rejected` — to the buyer, with the reason.

Each is rendered in the default language of the cart's sales channel (`en-US` when it has none), with default subjects and bodies in `en-US` and `pl-PL` that an operator can edit or switch off on the e-mail templates screen. A message that does not go out is written to the log and never fails the approval step.

The module now declares `transactional_emails` in `dependencies` and takes `@endora-commerce/email-components` as a peer dependency.
