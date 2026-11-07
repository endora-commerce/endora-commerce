---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
---

The cart read answers its VAT per rate, the way the order computes it (issue #436).

- `@endora-commerce/contracts`: new `cartVatSchema` / `CartVat` and `cartVatRowSchema` / `CartVatRow`. `cartFullPayloadSchema` gains `vat` (`CartVat | null`, default `null`): one row per rate (`taxRate`, `net`, `vat`, `gross`), `vatTotal`, `subtotalGross` and `grandTotalGross`. `cartViewLineSchema` gains the optional `taxRate` (a fraction) and `lineGross` (the line's own rounding of its gross, informational). All additive: a reply without them parses as before.
- `@endora-commerce/mod-carts`: `GET /api/v1/cart` (the full view) answers `vat` and each line's `taxRate` and `lineGross`. The rates are resolved as placement resolves them — the product's tax class against the Organization's VAT status and registered country — and the VAT is the contracts' `vatByRate`: per rate, on the sum of the line nets, rounded half-up once; gross = net + VAT; the discount comes off the gross untaxed. For the same lines the cart's gross grand total equals the order total before delivery and the payment surcharge. The line-mutation replies answer `vat: null`, as does a read whose rate resolution failed; the mini view (`?view=mini`) is unchanged. The module now declares `taxes` as a dependency (it resolves `taxService`).
