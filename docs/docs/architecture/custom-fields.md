---
title: Custom Fields for Core Entities
---

# Custom Fields

Operators can add fields to core entities **at deployment time — as data, never a
schema migration or code deploy** (Constitution Principle XIV, feature `055`).
The Custom Fields Layer is a generic, **entity-agnostic** module that reuses the
*design* of the catalog's `product_attributes` (typed definitions, option lists,
per-locale labels) as a cross-cutting capability — without embedding any
host-specific concern in its core, and without touching `product_attributes`,
which stays the untouched source of truth for products.

## Supported host entities

Custom fields are available on **Category, Order, Organization, CustomerAccount,
and QuoteRequest**. Each host entity carries an additive JSONB
`customFieldValues` bag (`{ [definitionKey]: value }`); the host owns that column
and its writes. Product keeps its own `product_attributes` mechanism — the two
converge only via an adapter, never a rewrite.

## How it works

- **Definitions are data.** A field is a row in `custom_field_definitions`
  (`@GlobalEntity`): an `entityType`, a `key`, a localized `label` (with default
  fallback), a `valueType`, a `required` flag, and — for select types — a list of
  `custom_field_options` rows. Adding, editing, or removing a field is a data
  change through the admin surface; **no migration, no deploy**.
- **Six value types**: `text`, `number`, `boolean`, `date`, `select`
  (one option), `multiselect` (many options).
- **Validated on every write.** When a host record is created or edited, the
  generic layer validates the incoming bag against the definitions and **rejects
  per field** on any violation (wrong type, missing required, unknown option,
  out of range) with a field-specific error. The host then persists the values
  in its own `customFieldValues` column.
- **Read alongside native fields.** Values are returned wherever the record is
  read (admin detail + the relevant API responses).

## Division of responsibility

The generic layer owns **definitions + validation**; the host owns **persistence
+ audit**:

- The custom-fields module never writes into a host table and never audits a host
  write. The host persists its own record and (per Principle XIII) audits its own
  write, calling the generic layer only to validate values and read definitions —
  so module boundaries (Principle I) stay intact and there is no double-auditing.
- Definition / option mutations are themselves sensitive writes and run through
  the **Command Bus** (Principle XIII); the module registers its permissions
  (`custom_fields:read`, `custom_fields:write`) and participates in module
  lifecycle.

## Tenant scope (inherited)

Custom-field **values** live in host columns, so they inherit the host record's
tenant scope for free (Principle XI): values on an org-owned Order / Organization
/ Customer / QuoteRequest are confined to the same tenant as the host record —
the generic layer adds no new scoping path. **Definitions** belong to the
platform (or, if scoped, to an organization) consistently with how the host
entity is scoped.

## Host-capability flags (extension point)

A field may carry an **opaque** `config` object — host-capability flags such as
"filterable" or "search-indexed". The generic core **stores but never reads it
for meaning**: the *host* module interprets the flag through its own documented
extension point (e.g. Category filtering picks up a `filterable` flag; Product
capabilities stay on `product_attributes`). This keeps catalog-only concerns out
of the generic core — the exact rot Principle XIV exists to prevent, where
`product_attributes` accreted `isVariantAxis` / `isPromoRule` / `filterPosition`
until it was no longer reusable.

## Data retention

Deleting a field definition does **not** purge stored values: stale values are
retained dormant (not surfaced, not read) rather than eagerly deleted, so a
mis-deletion is recoverable and host writes never cascade into data loss.

## Adding a custom field

Define it from the admin custom-field surface for the target entity type
(key + localized label + value type + required + options). It then renders on
every record of that type and its value round-trips through the host's
create/edit/read paths — no code change. See the feature quickstart
(`specs/055-custom-fields-layer/quickstart.md`) for the full walkthrough.
