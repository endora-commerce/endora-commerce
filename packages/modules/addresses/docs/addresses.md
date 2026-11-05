---
title: addresses
description: Customer postal addresses with default-per-kind invariant
---

# `addresses`

Customer postal addresses scoped to an Organization. Each address has a
`kind` (`shipping`, `billing`, `delivery`) and a per-kind default flag.

This is **every customer's one address book**: a company's, and an
individual's personal organization's. Checkout offers and saves to it, and the
storefront shows it as *My addresses* (`/addresses`) to an individual and as
*Organization addresses* (`/organization/addresses`) to a company member. The
separate personal address book `customers` used to keep is retired.

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

On the storefront both address pages are the same address book. They show the
address list to every member, and the add form and the *Make default* and
*Remove* buttons only to a member whose role holds the permission. An
individual is their personal organization's Administrator and always holds it.
Anyone else reads one line instead of the form: *Your role does not allow adding
or removing addresses. You can still view them and use them at checkout.* A
refused field is named with its own sentence, for example *Enter the street and
number.*

## Anonymization

`addressServicePort.anonymizeForOrganization(organizationId)` blanks every live
address of the organization (`-` for the recipient, street, city and postal
code; no phone; not default; the country kept), soft-deletes it and writes one
`address.anonymized` audit entry per address, with no actor. `customers`'
retention sweep calls it when it scrubs an individual's personal organization.
Orders keep their own address snapshots.

## Entities

`Address` — partial unique index `(organization_id, kind) WHERE
is_default = true` enforces "at most one default per kind" at the DB level.

## Extension points

- **Country-specific validation** — `address-service.ts#createAddress`
  delegates per-country format checks; add validators here when new markets
  go live.
- **Snapshot on order** — Orders embed an `AddressSnapshot` value object so
  later edits to the source address don't mutate historical orders.
