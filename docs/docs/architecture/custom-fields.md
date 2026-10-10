---
title: Custom Fields for Core Entities
---

# Custom Fields

Operators can add fields to core entities **at deployment time — as data, never a
schema migration or code deploy**.
The Custom Fields Layer is a generic, **entity-agnostic** module that reuses the
*design* of the catalog's `product_attributes` (typed definitions, option lists,
per-locale labels) as a cross-cutting capability — without embedding any
host-specific concern in its core.

## Supported host entities

Custom fields are available on **Category, Order, Organization, CustomerAccount,
QuoteRequest, and Product**. Each host entity carries an additive JSONB value
bag (`{ [definitionKey]: value }`); the host owns that column and its writes.
For most hosts the bag is the `customFieldValues` column; the product host binds
to the pre-existing `products.attribute_values` column instead (see the value-probe
binding below). Product attributes converged onto this layer as an **adapter**, not a
rewrite: the generic layer owns each attribute's identity
(key, per-locale labels, value type, required, options), while the catalog keeps
its behaviour flags on its own 1:1 extension table (`product_attributes`) and
remains the only write surface (see "Host-managed entity types" below).

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
  read — to an administrator always, and to anyone else only when the field's
  **audience** says so (next section).

## Audience: who reads a field's values

Every definition declares who its stored values are answered to:

| Audience | Who reads the values |
|---|---|
| `internal` | Administrators only. The values never leave the admin API. |
| `customer` | Administrators, **and** the non-admin replies of the host: the customer's own storefront replies and the external (API-key) replies. |

- **A new field is `internal`** unless its author chooses otherwise — in the
  definition form ("Who can see the value") or with `audience` on
  `POST /api/v1/admin/custom-fields/definitions`. A note, a credit assessment or a risk
  flag modelled as a custom field therefore stays inside the admin panel until
  somebody opens it deliberately. The audience of an existing field is changed
  on the same screen, or with `PATCH …/definitions/:id`; it takes effect on the
  next read and rewrites no stored value.
- **Upgrading changes nothing by itself.** Definitions that existed before the
  attribute did were migrated to `customer`, because their values were already
  being answered to customers. Review them after upgrading and move to
  `internal` whatever was never meant to be shown.
- **Where it applies today.** Two hosts answer custom-field values to a
  non-administrator: **Order** (the customer's order replies under
  `/api/v1/orders` and the external replies under `/api/v1/external/orders`)
  and **Quote Request** (the customer's quote detail under
  `/api/v1/quote-requests/:id`). Category, Organization, CustomerAccount and
  Opportunity values are answered on admin routes only. In every case the
  `customFieldValues` object keeps its shape and simply carries fewer keys.
- **A value without a definition is treated as internal.** After a field is
  deleted its stored values stay on the records (see *Data retention*), and they
  are not answered to a customer or to an integration.
- **Product attributes are not governed by it.** The `product` type is
  host-managed: whether a shopper sees an attribute is decided by the catalog's
  own attribute flags.
- **For a host module.** Pass the stored bag through
  `CustomFieldValuePort.projectForCustomer(entityType, bag)` in the one
  serialiser that answers a non-administrator, and never emit the raw column
  there. It reads the per-entity definitions cache, so calling it once per row
  of a list costs no query per row. No route lets a non-administrator *write*
  custom-field values.

## Division of responsibility

The generic layer owns **definitions + validation**; the host owns **persistence
+ audit**:

- The custom-fields module never writes into a host table and never audits a host
  write. The host persists its own record and audits its own
  write, calling the generic layer only to validate values and read definitions —
  so module boundaries stay intact and there is no double-auditing.
- Definition / option mutations are themselves sensitive writes and run through
  the **Command Bus**; the module registers its permissions
  (`custom_fields:read`, `custom_fields:write`) and participates in module
  lifecycle.

## Host-managed entity types (`managedBy`)

The entity registry (`custom-field-registry.ts`) supports a **generic**
`managedBy` capability on a host entry: `{ moduleId, labelKey, route }`. When
set, that host's definitions are authored by the named module through its own
surface, and the generic admin surface becomes **read-only** for that entity
type: `POST` / `PATCH` / `DELETE` on `/api/v1/admin/custom-fields/definitions*`
are refused with `409 host_managed`, and the admin Custom Fields page renders
the entity read-only with a notice linking to the managing surface. The refusal
is registry-driven — the generic core checks only for the marker's presence,
never which module manages (no host identifier in core logic).

The product host is the first user: `managedBy` points at the catalog module's
`/catalog/attributes` page, which stays the single write surface for product
attributes.

## Value-probe binding (`{table, column}`)

The generic layer's change guards (`hasStoredValues`, `isOptionInUse` — backing
`value_type_locked` and `option_in_use` refusals) probe the host's value bag with
read-only JSONB introspection. The probe target is a per-entity **storage
binding** `{ table, column }`: most hosts bind to their `custom_field_values`
column, while the product host binds to `products.attribute_values`. The binding
is purely storage metadata — no host logic lives in the generic module.

## Transactional apply seam (host commands)

Host modules that manage their entity's definitions (per `managedBy`) mutate
them through the exported `CustomFieldDefinitionApplyApi`
(`applyCreate` / `applyUpdate` / `applyDelete` + the option variants). Each
apply function runs on a **caller-provided EntityManager**, enforces the generic
invariants (duplicate key, options rules, value-type lock, option-in-use), and
performs **no audit and no cache publish** — the calling host command owns the
transaction, writes the single audit row, and publishes the definitions-cache
invalidation after commit. This keeps `custom_fields` the sole writer of its
tables while letting a host command keep its definition + its own
rows consistent atomically (the Command Bus does not nest).

## Convergence note: product attributes

Convergence happens as an **adapter**, not a rewrite: product attributes became
Custom Field definitions on the `product` host, with the catalog keeping a 1:1
extension row (`product_attributes`) for its behaviour flags and presentation
refinements. The generic core gained only the three entity-agnostic seams
described above (the `product` registry entry with `managedBy`, the
`{table, column}` probe binding, and the apply seam) — zero catalog logic. See
the [catalog module page](../modules/catalog.md#attributes-as-custom-field-extensions)
for the catalog-side view and the migration outcome.

## Tenant scope (inherited)

Custom-field **values** live in host columns, so they inherit the host record's
tenant scope for free: values on an org-owned Order / Organization
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
of the generic core — the exact rot this separation exists to prevent, where
`product_attributes` accreted `isVariantAxis` / `isPromoRule` / `filterPosition`
until it was no longer reusable.

## Data retention

Deleting a field definition does **not** purge stored values: stale values are
retained dormant (not surfaced, not read) rather than eagerly deleted, so a
mis-deletion is recoverable and host writes never cascade into data loss.

## Adding a custom field

Define it from the admin custom-field surface for the target entity type
(key + localized label + value type + required + audience + options). It then renders on
every record of that type and its value round-trips through the host's
create/edit/read paths — no code change.
