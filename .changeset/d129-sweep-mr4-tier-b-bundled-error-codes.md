---
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
placeholder sentences leave the platform bundle.

`manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
(`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
`CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
`PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
`@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
`IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
`TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
(`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
`@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
`specs/090-module-owned-error-codes/d129-sweep.md`).

`@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
`@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
`error.code` is unchanged for all twenty.

**Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
`"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
of the eight are replaced by real prose in both languages in the receiving module's own bundle:

- `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
- `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
  `@endora-commerce/mod-customer-accounts`
- `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
`PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
describe and the placeholder is deleted without a replacement. A consumer that reads those keys
out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
platform produced the codes they belonged to.
