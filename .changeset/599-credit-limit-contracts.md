---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-credit-limits': patch
---

Credit limit replies are described by their contract (issue #599, section 6):

- `creditLimitViewSchema` in `@endora-commerce/contracts` now declares `organizationName` (`string | null`, optional). Every credit-limit reply has answered it (the admin roster, the organization detail, the grant and the adjustment, and `null` on the customer's `GET /api/v1/me/credit-limit`), and the contract did not declare it. The field is optional, so a client that does not read it is unaffected.
- `@endora-commerce/contracts` publishes `creditLimitListResponseSchema` / `CreditLimitListResponse` for `GET /api/v1/admin/credit-limits`, a `data` array of `creditLimitViewSchema` rows.
- `mod-credit-limits` builds every credit-limit reply as the contract's `CreditLimitView` instead of `Record<string, unknown>`, and each handler declares its reply type. The admin Credit Limits page uses the contract's `CreditLimitView` instead of a hand-written interface. Nothing on the wire changes.
