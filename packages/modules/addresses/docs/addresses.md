---
title: Addresses
description: Customer postal addresses with default-per-kind invariant
---

# Addresses (`addresses`)

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

`addressServicePort.anonymizeForOrganization(organizationId)` blanks every
address of the organization, including the ones already deleted (`-` for the
recipient, street, city and postal code; no phone; not default; the country
kept), soft-deletes it (a deleted address keeps its deletion date) and writes one
`address.anonymized` audit entry per address, with no actor. The entry records
only the kind, whether the address was already deleted and when it was blanked.
An address already blanked is skipped, so a second call changes nothing.
`customers`' retention sweep calls it when it scrubs an individual's personal
organization. Orders keep their own address snapshots.

`addressReadPort.listIdsForOrganization(organizationId, { includeDeleted })`
lists the ids of the organization's addresses, the deleted ones too when
`includeDeleted` is `true`.

## Audit log

Creating, updating, deleting and anonymizing an address each write one entry to
the platform audit log, recorded against the address by id. Everybody holding
`audit_log:read` reads that log, whatever organizations they may see, so an
entry records names, not values (issue #470): the kind of address and the names
of the fields that changed (`changedFields`, for example `['phone', 'street']`).
It never holds the recipient, the street, the city, the postal code, the phone
or the organization's id. Entries written before this rule are not rewritten.

## Entities

`Address` — partial unique index `(organization_id, kind) WHERE
is_default = true` enforces "at most one default per kind" at the DB level.

## Extension points

- **Country-specific validation** — `address-service.ts#createAddress`
  delegates per-country format checks; add validators here when new markets
  go live.
- **Snapshot on order** — Orders embed an `AddressSnapshot` value object so
  later edits to the source address don't mutate historical orders.
