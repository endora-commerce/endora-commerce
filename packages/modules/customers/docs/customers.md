---
title: customers
description: Customer lifecycle over `customer_accounts` — company and personal Organizations, sales-rep assignment and the admin customer surface
---

# `customers`

Customer (Klienci) lifecycle business logic layered on top of the
`customer_accounts` data module. **Every customer belongs to an
Organization** — a company for B2B, a single-member *personal* organization for
an individual, and `customer_accounts.organization_id` is
`NOT NULL`. "Standalone" throughout this page means *outside a company
organization*, never *without one*: such a customer is their own tenant, and the
organization-scoped features a company offers (shared addresses, invitations,
credit limit, a sales-rep assignment) are simply absent for them rather than
switched off by a special case.

## Capabilities

**Storefront (self-service)**

- Standalone registration, gated by the
  `customers.allow_registration_without_organization` setting. On success the
  account and its personal organization are written in one transaction and the
  new account is logged in automatically. While the setting is off, the
  storefront's `/register-customer` page shows a notice with a link to the
  organization registration instead of the form, so a visitor does not fill
  it in only to be refused.
- A personal address book (billing/delivery), one default per kind, plus the
  ability to select the Organization's shared addresses (org-bound customers).
- Default payment method, delivery method, and default addresses.
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
data, and restore is no longer possible.

## Public surface

Admin routes are gated by `customers:read` (reads), `customers:manage`
(mutations), and `customers:impersonate` (impersonation).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/customers/register` | anon | Standalone registration (setting-gated) |
| `GET /api/v1/storefront/settings/customer-registration` | anon | Whether standalone registration is offered (`allowRegistrationWithoutOrganization`) |
| `GET /api/v1/me/customer` | customer | Own profile, with `organizationRole` and the effective `permissions` |
| `POST /api/v1/me/customer/change-password` | customer | Change password. A successful change signs the account out of every other session (the one the request was made from is kept), retires its outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET /api/v1/me/customer/addresses` | customer | Personal + org-shared addresses |
| `POST/PATCH/DELETE /api/v1/me/customer/addresses[/:id]` | customer | Manage personal addresses |
| `PUT /api/v1/me/customer/addresses/:id/default` | customer | Set a default address |
| `GET/PUT /api/v1/me/customer/defaults` | customer | Default payment/delivery method + addresses |
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
| `GET/POST/PATCH/DELETE /api/v1/admin/customers/:id/addresses[/:addressId]` | admin | Manage addresses |
| `POST /api/v1/admin/customers/:id/vat-validate` | admin | Validate a NIP/VAT number |
| `GET /api/v1/admin/customers/:id/orders` · `/quote-requests` · `/carts` | admin | Read-only history panels |
| `GET /api/v1/admin/customers/online` | admin | Currently-online customers |

## Settings

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `customers.allow_registration_without_organization` | boolean | `false` | Gate standalone registration |
| `customers.deletion_retention_days` | number | `365` | Restore window before permanent anonymization |
| `customers.presence_freshness_minutes` | number | `10` | "Online" threshold |

## Schema

- `20260611T140403_customer_accounts_lifecycle.ts` (owned by `customer_accounts`) — adds `customer_group_id`, block state
  (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`), and
  deletion/anonymization state (`deletion_requested_by_admin_user_id`,
  `anonymized_at`) to `customer_accounts`.
- `20260611T140404_customers_customer_addresses_init.ts` — the `customer_addresses` table (one default
  per `(customer, kind)`).

Default payment/delivery preferences reuse the `quick_order_default_preferences`
table; no new table is introduced for them.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds customers. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| E-mail | yes |
| Name | yes |

A result shows the name, the e-mail, the organization and whether the account is blocked, and opens the customer. Deleted and anonymized accounts are not found. Customers appear for a role holding `customers:read`, and a sales representative sees the customers their Customers list shows them.
