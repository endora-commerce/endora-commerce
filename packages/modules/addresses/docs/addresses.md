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

The routes are served by `organizations`. Creating, updating and deleting need
the **`addresses.manage`** organization permission, which this module declares
(*Manage organization addresses*): a member whose role lacks it is refused
`403 ORGANIZATION_PERMISSION_REQUIRED`. Every member may read the list. The
permission is held by the Member role by default and by Administrator always;
an organization withdraws it by editing a role.

On the storefront the organization's address page (`/organization/addresses`)
shows the address list to every member, and the add form and the *Remove*
buttons only to a member whose role holds the permission. Anyone else reads one
line instead of the form: *Your role does not allow adding or removing
addresses. You can still view them and use them at checkout.*

## Entities

`Address` — partial unique index `(organization_id, kind) WHERE
is_default = true` enforces "at most one default per kind" at the DB level.

## Extension points

- **Country-specific validation** — `address-service.ts#createAddress`
  delegates per-country format checks; add validators here when new markets
  go live.
- **Snapshot on order** — Orders embed an `AddressSnapshot` value object so
  later edits to the source address don't mutate historical orders.
