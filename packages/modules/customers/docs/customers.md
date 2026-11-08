---
title: Customers
description: Customer lifecycle over `customer_accounts` — company and personal Organizations, sales-rep assignment and the admin customer surface
---

# Customers (`customers`)

Customer (Klienci) lifecycle business logic layered on top of the
`customer_accounts` data module. **Every customer belongs to an
Organization** — a company for B2B, a single-member *personal* organization for
an individual, and `customer_accounts.organization_id` is
`NOT NULL`. "Standalone" throughout this page means *outside a company
organization*, never *without one*: such a customer is their own tenant, and the
organization-scoped features a company offers (invitations, credit limit, a
sales-rep assignment) are simply absent for them rather than
switched off by a special case.

## Capabilities

**Storefront (self-service)**

- Standalone registration, gated per sales channel by the
  `customers.allow_registration_without_organization` setting: the value set
  for the channel the request resolves to applies, then the all-channels value.
  On success the
  account and its personal organization are written in one transaction and the
  new account is logged in automatically. While the setting is off, the
  storefront's `/register-customer` page shows a notice with a link to the
  organization registration instead of the form, so a visitor does not fill
  it in only to be refused.
- A first sign-in through an external identity provider (for example Google)
  creates an account under the same setting, read for the sales channel the
  sign-in was started on. Where the setting is off for that channel, no
  account is created and the visitor is sent back to the sign-in page with a
  prompt to create an account first.
- One address book for every customer: their Organization's. An individual sees
  it as *My addresses* (`/addresses`), a company member as *Organization
  addresses* (`/organization/addresses`). Checkout offers and saves to the same
  book. It is served by `organizations` over `addresses`, not by this module,
  so it keeps working while this module is switched off.
- Default payment method and delivery method. The default addresses are read
  from the Organization book, where they are set.
- Change password; read-only history of own orders and quote requests.

**Admin (oversight)**

- Customer list (search + status/organization/group filters) and a detail view
  showing creation date, customer group, organization, blocked status, and last
  login.
- Block / unblock and soft-delete / restore, with role-based authority: a
  Platform Administrator may act on anyone; otherwise the authorized salesperson
  is the one inherited from the customer's Organization. A personal organization
  never carries a sales-rep assignment, so the unassigned-organization fallback
  leaves a standalone customer open to any salesperson. An org-owner depletion
  guard refuses blocking, deleting or detaching the last active holder of a
  company organization's Administrator role (`409 ORG_OWNER_DEPLETION`);
  blocked administrators do not count. It
  does not apply to a personal organization, whose sole member is its
  Administrator: blocking or deleting that customer is allowed.
- Impersonation; audited as `impersonation.start` / `impersonation.end`. The
  answer names the customer's `organizationRole`, and the impersonation acts
  with exactly that customer's organization permissions.
- Admin-triggered password reset (emails a set-password link).
- NIP/VAT validation (VIES / Biała lista port).
- Organization assign, and detach-from-organization, which moves the customer to
  their own personal organization rather than leaving them without one.
  Direct customer-group assignment (overrides the Organization's group when
  resolving pricing and promotions).
- Read-only orders, quote-requests, and (current + abandoned) carts panels.
- An "online customers" view backed by recent session activity.

## Deletion & anonymization

Deletion is a soft-disable: login is denied, the account is hidden, and sessions
are revoked, while orders, quote requests, and audit history are retained.
Within a configurable retention window (`customers.deletion_retention_days`,
default 365) an authorized actor can restore the account. After the window the
anonymization sweep (`AnonymizationSweepWorker`) irreversibly scrubs personal
data, and restore is no longer possible: from the moment the window elapses,
restore answers `409 CUSTOMER_RESTORE_WINDOW_ELAPSED`, even if the sweep has
not reached the account yet. The account loses its e-mail, name, password and
all custom field values. For an individual, the sweep also scrubs their
personal organization: its name, registered address, legal name,
order-confirmation e-mails and all custom field values are cleared, and its
saved addresses are blanked (`-`, no phone, country kept) and soft-deleted, one
`address.anonymized` audit entry each. This happens even if an operator has
already deleted that organization. Placed orders keep their address snapshots.
The anonymization audit entries record that the data was erased, not the data
itself.

Reasons that operators wrote about the customer are erased too: the account's
block reason and, for an individual, the block and rejection reasons on their
personal organization. A company organization keeps its reasons. The block or
rejection itself stays, so the customer screens still show the status and its
date, without a reason. The anonymization audit entries record only that a
reason existed. Audit entries written earlier, such as the entry for the block
itself, keep the values they recorded, the reason included, until earlier
entries are redacted on anonymization
([#844](https://github.com/endora-commerce/endora-commerce/issues/844)).

The sweep runs once a day, in the worker process and only while this module is
on, so an account is anonymized up to a day after its window elapses. While the
module is off no run happens; the accounts that came due meanwhile are
anonymized by the first run after it is switched back on. A run first checks
whether any account is due or any earlier scrub is left to finish, and when
none is it does nothing and writes no audit entry. If that check cannot be
answered, the run goes ahead. Two runs that overlap anonymize an account once.

The sweep scrubs the personal organization and its addresses first and the
account last. If a run is interrupted, the account is picked up again on the
next run, which completes the remaining steps without repeating the audit
entries of the steps already done. An account that cannot be anonymized does
not hold up the others: the run anonymizes the rest and then reports the failed
account ids.

The same holds when what the sweep erases grows. Anything a run under an earlier
release left on an anonymized account or on its personal organization, such as
custom field values, a legal name, order-confirmation e-mails or a block or
rejection reason, is erased by the next run, whatever the retention window is
set to now. That run records one more audit entry for each record it changes,
keeps the original anonymization date, and does not announce the anonymization
again, so what other modules do on anonymization, such as Forms erasing the
customer's entries, does not run a second time.

## The personal address book is retired

Until release 1 of this change, this module kept a second, *personal* address
book (`customer_addresses`). No order could be placed to one of its addresses.
It is retired for everyone, in two releases:

- **Release 1 (this one).** Every former personal-book endpoint answers
  `410 Gone` with `CUSTOMER_ADDRESS_BOOK_RETIRED`, in Polish or English. A
  one-time background job, run by the worker process while this module is on,
  processes the remaining rows:
  - an individual's rows are **moved** into their personal organization's book.
    An address the book already holds is not copied twice, and an existing
    default stays the default. Each row is audited `customer_address.merge`;
  - every other row (a company member's, an individual's whose personal
    organization was already anonymized, or an account whose organization cannot
    be found) is **erased**: blanked, soft-deleted and audited
    `customer_address.erased`;
  - a row the address book refuses — for example a country that is no longer
    active — stays, marked with the reason (`customer_address.merge_refused`).
    Only the operator sees it, on the customer's *Addresses* card.
- **Release 2.** The table and the remaining code are removed. The upgrade
  refuses while any row is left.

The upgrade note *Personal address book retired (release 1 of 2)* covers the
operator's side.

## Public surface

Admin routes are gated by `customers:read` (reads), `customers:manage`
(mutations), and `customers:impersonate` (impersonation).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/customers/register` | anon | Standalone registration (setting-gated) |
| `GET /api/v1/storefront/settings/customer-registration` | anon | Whether standalone registration is offered (`allowRegistrationWithoutOrganization`) |
| `GET /api/v1/me/customer` | customer | Own profile, with `organizationRole` and the effective `permissions` |
| `POST /api/v1/me/customer/change-password` | customer | Change password. A successful change signs the account out of every other session (the one the request was made from is kept), retires its outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET/POST /api/v1/me/customer/addresses` · `PATCH/DELETE .../:id` · `PUT .../:id/default` | customer | Retired: `410 CUSTOMER_ADDRESS_BOOK_RETIRED`. Use `/api/v1/organizations/mine/addresses` |
| `GET /api/v1/me/customer/defaults` | customer | Default payment/delivery method, and the Organization book's default addresses |
| `PUT /api/v1/me/customer/defaults` | customer | Set the default payment/delivery method. A body naming `billingAddressId` or `shippingAddressId` answers `410 CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `GET /api/v1/me/customer/orders` | customer | Own order history |
| `GET /api/v1/me/customer/quote-requests` | customer | Own RFQ history |
| `GET /api/v1/admin/customers` | admin | List (authority-scoped) |
| `GET /api/v1/admin/customers/:id` | admin | Detail |
| `POST /api/v1/admin/customers/:id/block` · `/unblock` | admin | Block / unblock |
| `DELETE /api/v1/admin/customers/:id` · `POST .../restore` | admin | Soft-delete / restore |
| `POST /api/v1/admin/customers/:id/impersonate` | admin | Start impersonation |
| `POST /api/v1/admin/customers/:id/password-reset` | admin | Email a set-password link |
| `POST/DELETE /api/v1/admin/customers/:id/organization` | admin | Assign / unassign organization |
| `PUT /api/v1/admin/customers/:id/customer-group` | admin | Set / clear customer group |
| `GET /api/v1/admin/customers/:id/addresses` | admin | Read-only: `{ organization, personal }` — the Organization book, and the personal-book rows the retirement job refused, each with `mergeRefusal` |
| `POST /api/v1/admin/customers/:id/addresses` | admin | Retired: `410 CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `POST /api/v1/admin/customers/:id/vat-validate` | admin | Validate a NIP/VAT number |
| `GET /api/v1/admin/customers/:id/orders` · `/quote-requests` · `/carts` | admin | Read-only history panels |
| `GET /api/v1/admin/customers/online` | admin | Currently-online customers |

## Settings

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `customers.allow_registration_without_organization` | boolean | `false` | Gate standalone registration, per sales channel |
| `customers.deletion_retention_days` | number | `365` | Restore window before permanent anonymization |
| `customers.presence_freshness_minutes` | number | `10` | "Online" threshold |

## Schema

- `20260611T140403_customer_accounts_lifecycle.ts` (owned by `customer_accounts`) — adds `customer_group_id`, block state
  (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`), and
  deletion/anonymization state (`deletion_requested_by_admin_user_id`,
  `anonymized_at`) to `customer_accounts`.
- `20260611T140404_customers_customer_addresses_init.ts` — the `customer_addresses` table (one default
  per `(customer, kind)`), the retired personal address book.
- `20261105T180317_customers_address_book_retirement.ts` — the retirement job's provenance columns
  (`merged_into_address_id`, `merged_at`, `merge_refusal`) and an index over the rows it has yet to
  process. Release 2 drops the table.

Default payment/delivery preferences reuse the `quick_order_default_preferences`
table; no new table is introduced for them.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds customers. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| E-mail | yes |
| Name | yes |

A result shows the name, the e-mail, the organization and whether the account is blocked, and opens the customer. Deleted and anonymized accounts are not found. Customers appear for a role holding `customers:read`, and a sales representative sees the customers their Customers list shows them.
