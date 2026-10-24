---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-i18n': minor
---

A typed money amount with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED`, never rounded (issue #417, owner ruling of 2026-10-24).

- `@endora-commerce/contracts`: new `money-input` module — `twoDecimalAmount(schema)` for a number schema, `twoDecimalAmountString(schema)` for a decimal string, `addAmountPrecisionIssue(ctx, path)` for a `superRefine` that decides per field, `hasAtMostTwoDecimals(value)`, `isAmountPrecisionIssue(issue)` and the `AMOUNT_PRECISION_EXCEEDED` constant; new `ERROR_CODES.AMOUNT_PRECISION_EXCEEDED`.
- `@endora-commerce/platform`: the error envelope answers `400 AMOUNT_PRECISION_EXCEEDED` when every failed issue of a request is the precision issue, whether the route validated through the type provider or parsed the body itself; a request failing anything else as well stays `VALIDATION_FAILED`, the precision issue listed among its details.
- `@endora-commerce/mod-i18n`: declares the code in the platform block, with its sentence in English and Polish.
