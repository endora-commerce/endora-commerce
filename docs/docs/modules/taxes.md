---
title: taxes
---

# `taxes`

Tax-rate resolution (T128, T131 / FR-051). Each `Tax` row is a rule
narrowed by zero or more of `country`, `productType`, `appliesToVatStatuses`.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/taxes` | admin (`taxes:read`) | List rules |
| `PUT /api/v1/admin/taxes/:code` | admin (`taxes:write`) | Upsert |
| `DELETE /api/v1/admin/taxes/:id` | admin (`taxes:write`) | Remove |
| `GET /api/v1/admin/taxes/preview?country&productType&vatStatus` | admin (`taxes:read`) | Resolve effective rate |

Every one of the four enforced `catalog:write` until 2026-08-28 — the two reads
included, so seeing a VAT rate required the authority to change it. The module
now owns `taxes:read` and `taxes:write`, declared in its manifest and therefore
grantable on `/admin-roles`. It is a **clean break**: a role that reached the tax
table through the catalogue's write code is granted `taxes:read` (and
`taxes:write`, to edit) explicitly. See
`specs/080-f4-real-scope/payments-permission-ownership.md` §7.2 and
`backend/test/contract/taxes/permission-authority.test.ts`.

Nothing else reads a rate through these routes: `orders`, `carts`,
`product_feeds` and `quote_requests` resolve one in process through the
`taxService` port, which the permission change does not touch.

## Resolution algorithm

`TaxService.taxRateFor({ country, productType, vatStatus })`:

1. A rule **matches** when each narrowing field is either null
   (unconstrained) or equal to the input.
2. Among matching rules, the one with the **most narrowed fields** wins.
3. Specificity ties → `priority` desc → `createdAt` asc.
4. When no rule matches, the row with `isDefault=true` wins.
5. When no default exists either, the resolver returns `{ source: 'none' }` —
   an answer with **no `rate` field at all**.

Point 5 is a type, not a convention (issue #124). A configured 0% rate is a
legitimate answer in some jurisdictions, so it comes back as
`{ source: 'default', rate: 0, taxId }` and prices an order like any other rate.
"Nothing is configured" is not an answer, so it carries no number a caller could
spend by accident: `ResolvedTax` is a discriminated union and `.rate` does not
compile until the caller narrows on `source`. The two used to share one shape,
`{ rate: 0, source: 'none' }`, and every consumer read `.rate` — which is how an
unconfigured deployment quoted 0% VAT onto real invoices.

A third state — the `taxes` module being absent — is deliberately not in the
union. Absence is not a value: the port gate raises the 503 `MODULE_DISABLED`
envelope before a resolution runs, so an order the platform cannot tax is
refused rather than taxed at a figure nobody chose.

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
