---
title: addresses
description: Customer postal addresses with default-per-kind invariant
---

# `addresses`

Customer postal addresses scoped to an Organization. Each address has a
`kind` (`shipping`, `billing`, `delivery`) and a per-kind default flag.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/organizations/mine/addresses` | List own Organization's addresses |
| `POST /api/v1/organizations/mine/addresses` | Create; `isDefault=true` atomically demotes the previous default of the same kind |
| `PATCH /api/v1/organizations/mine/addresses/:id` | Update |
| `DELETE /api/v1/organizations/mine/addresses/:id` | Delete (rejected if referenced by an order via `409 ADDRESS_IN_USE`) |

## Entities

`Address` — partial unique index `(organization_id, kind) WHERE
is_default = true` enforces "at most one default per kind" at the DB level.

## Extension points

- **Country-specific validation** — `address-service.ts#createAddress`
  delegates per-country format checks; add validators here when new markets
  go live.
- **Snapshot on order** — Orders embed an `AddressSnapshot` value object so
  later edits to the source address don't mutate historical orders.
