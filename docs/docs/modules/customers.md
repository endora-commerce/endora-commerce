---
title: customers
description: Customer lifecycle over `customer_accounts` — company and personal Organizations, sales-rep assignment and the admin customer surface
---

# `customers`

Customer (Klienci) lifecycle business logic layered on top of the
`customer_accounts` data module (feature 040). **Every customer belongs to an
Organization** — a company for B2B, a single-member *personal* organization for
an individual (feature 051), and `customer_accounts.organization_id` is
`NOT NULL` (D-178). "Standalone" throughout this page means *outside a company
organization*, never *without one*: such a customer is their own tenant, and the
organization-scoped features a company offers (shared addresses, invitations,
credit limit, a sales-rep assignment) are simply absent for them rather than
switched off by a special case.

## Capabilities

**Storefront (self-service)**

- Standalone registration, gated by the
  `customers.allow_registration_without_organization` setting. On success the
  account and its personal organization are written in one transaction and the
  new account is logged in automatically.
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
  guard refuses blocking or deleting the last organization administrator.
- Impersonation; audited as `impersonation.start` / `impersonation.end`.
- Admin-triggered password reset (emails a set-password link).
- NIP/VAT validation (VIES / Biała lista port).
- Organization assign, and detach-from-organization, which moves the customer to
  their own personal organization rather than leaving them without one (D-178).
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
| `GET /api/v1/me/customer` | customer | Own profile |
| `POST /api/v1/me/customer/change-password` | customer | Change password |
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

- `060_customer_accounts_lifecycle` — adds `customer_group_id`, block state
  (`blocked_at`, `block_reason`, `block_source`, `blocked_by_*`), and
  deletion/anonymization state (`deletion_requested_by_admin_user_id`,
  `anonymized_at`) to `customer_accounts`.
- `061_customer_addresses_init` — the `customer_addresses` table (one default
  per `(customer, kind)`).

Default payment/delivery preferences reuse the `quick_order_default_preferences`
table; no new table is introduced for them.
