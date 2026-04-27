---
title: taxes
---

# `taxes`

Tax-rate resolution (T128, T131 / FR-051). Each `Tax` row is a rule
narrowed by zero or more of `country`, `productType`, `appliesToVatStatuses`.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/taxes` | admin (`catalog:write`) | List rules |
| `PUT /api/v1/admin/taxes/:code` | admin | Upsert |
| `DELETE /api/v1/admin/taxes/:id` | admin | Remove |
| `GET /api/v1/admin/taxes/preview?country&productType&vatStatus` | admin | Resolve effective rate |

## Resolution algorithm

`TaxService.taxRateFor({ country, productType, vatStatus })`:

1. A rule **matches** when each narrowing field is either null
   (unconstrained) or equal to the input.
2. Among matching rules, the one with the **most narrowed fields** wins.
3. Specificity ties → `priority` desc → `createdAt` asc.
4. When no rule matches, the row with `isDefault=true` wins.
5. When no default exists either, the resolver returns
   `{ rate: 0, source: 'none' }`.

The "at most one default" invariant is enforced by a partial unique index
`(is_default) WHERE is_default = true`. `upsertByCode` demotes any prior
default before promoting the new one so the swap stays consistent.

## Entities

`Tax` — `code`, `name`, `rate` (0..1), nullable `country` /
`productType`, JSONB `appliesToVatStatuses`, `isDefault`, `priority`.

## Extension points

- **VAT-OSS / one-stop-shop** — model the buyer's status separately and
  emit different rates per country pair.
- **Reduced-rate triggers** — the `appliesToVatStatuses` array is the
  natural place to add buyer-side discriminators (e.g. consumer vs B2B).
- **Per-currency rates** — today the rate is currency-agnostic. For VAT
  in different reporting currencies, add a `currency` column and route
  the resolver based on the order's currency.
