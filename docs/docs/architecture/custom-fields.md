---
title: Custom fields for core entities
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
QuoteRequest, Opportunity, and Product**. Two of them **follow an owner module**:
QuoteRequest follows `quote_requests` and Opportunity follows `crm`. While the
owner is not present, the type is left out of the admin surface and the
definitions API entirely — not listed, created or edited — and its definitions,
options and stored values are kept, to return unchanged with the module. Each
host entity carries an additive JSONB value
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
  are not answered to a customer or to an integration. For the same reason a
  key that still has stored values cannot be **re-created as `customer`**: the
  request is refused with `409`. Create the field as `internal`, review what the
  records hold, then change the audience.
- **A change of audience can take up to 5 seconds to reach every reply.**
  Definitions are cached per API process for 5 seconds. The process that
  handled the change applies it at once and tells the others; a process that
  misses that message goes on answering the previous audience until its cached
  copy expires. After moving a field to `internal`, allow 5 seconds before
  relying on it.
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

## List filters (`listFilter`)

`listFilter` is a definition attribute the generic core **does** interpret —
one of two, with `carryTo` below — which is why it is a column beside `required`
rather than a flag in `config`. A
definition with it on is offered as a filter on its host's admin list, and the
generic layer is what turns a request's filters into SQL — every host list would
otherwise grow its own copy of the same six predicates.

- **Which types may carry it is the registry's to say.** Each entity type's
  registry entry declares `listFilter`; today `order`, `quote_request` and
  `opportunity` do. Setting it on any other type is refused, and the
  `entity-types` endpoint publishes the flag so the admin offers the option only
  where it applies. Turning it on or off changes no stored value.
- **The port.** `custom_fields` publishes `CustomFieldListFilterPort`:
  `listFilterable(entityType)` answers the definitions a list offers, and
  `condition(entityType, filters)` turns the whole request's filters into **one**
  condition — `select t."id" from "<host table>" t where …`, every key and value
  bound — or throws, naming every key that is not offered. The host list wraps
  that condition as `id in (…)` in each statement it runs (rows, total, counts),
  so the filter narrows the whole result, not a page, and runs inside the host's
  own tenant and visibility scope.
- **It reuses the storage binding.** The condition probes the same per-entity
  `{ table, column }` binding as the change guards above, so a host is filterable
  with no host-specific code in the generic module.
- **Semantics.** `contains` (case-insensitive), `in` (any of the options; for a
  multiselect, any held option), `is`, and inclusive `min`/`max` and
  `from`/`to`. A record without a value never matches. Values within one field
  are ORed; fields, and the list's own filters, are ANDed. At most 10 fields and
  100 `in` values per request.
- **A refusal is never silent.** A key that is unknown, of another type or not
  offered is refused with `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it,
  rather than ignored — an ignored filter shows an operator more records than
  they asked for, without saying so. For the same reason an operator that does
  not apply to the field's type (`contains` on a Yes/No field, say) is refused
  with `400` `VALIDATION_FAILED`, and a date or number range compares only a
  stored date or number, so a value stored under an earlier type neither
  matches nor fails the list.
- **No storefront surface.** No custom-field filter reaches a storefront or
  API-key endpoint.

### Why the CRM board keeps its own predicates

The Opportunity board filters by what its **cards** show — built-in fields and
custom fields alike, the contact person included — and ignores a field the card
no longer shows, so an old link keeps opening. That rule is the board's, not a
definition's, and it covers fields the generic layer knows nothing about. So the
board keeps its own predicates, and only the Opportunities **list** follows
`listFilter`: its `custom:` references go through the port, refused when not
offered, while the board — and the list request that continues one of its
columns (`cardValues=true`) — keep the card rule.

## Value carry-over (`carryTo`)

`carryTo` is the second definition attribute the generic core interprets. A Quote Request, Order or
Opportunity definition lists in it the entity types its values are carried to when a record of one
of those types is created from, or joined to, a record of this one — always into the definition
with the **same key** on the target, and only into an empty value. The operator's side of it is on
the `custom_fields` module page; this section is how it is built.

- **Storage.** `custom_field_definitions.carry_to`, a `jsonb` array of entity types, at most two,
  no duplicates, default `[]` — one column whatever pairs the registry later allows. A pair is
  derived from it and never stored as its own row, which is why deleting a target definition leaves
  the source's option as configured.
- **Which pairs exist is the registry's to say.** Each entry of `custom-field-registry.ts` may
  declare `carryTargets`: `quote_request` → `order`, `opportunity`; `order` → `opportunity`;
  `opportunity` → `quote_request`, `order`. Nothing else is offered. `GET …/entity-types` serves the
  list filtered to targets whose owner module is present, and `GET …/definitions` strips from
  `carryTo` every target whose owner is absent. A `PATCH` merges those hidden entries back, so a
  save while `crm` is off never drops a retained "carry to Opportunity".
- **One compatibility rule, three callers.** `assessCustomFieldCarry(source, target)` in
  `@endora-commerce/contracts` is pure — no I/O — and answers every reason in a fixed order:
  `target_missing`, `value_type_mismatch` (no widening), `options_missing` (choice fields: source
  option **values** absent on the target), `audience_mismatch` (an `internal` source into a
  `customer` target). The definition Commands use it to refuse turning a carry on
  (`422 CUSTOM_FIELD_CARRY_INCOMPATIBLE`, with `pair_unsupported` and `target_unavailable` added by
  the Command itself); the admin screen uses it, over its own definitions list, for the
  *Incompatible* mark and the warnings before a change; and the carry port uses it at conversion.
  Only a newly added target is judged, so an edit never fails because a carry drifted earlier.

### The carry port: `custom_fields` computes, the target's owner writes

`custom_fields` publishes `customFieldCarryPort` (`CustomFieldCarryPort`, in
`packages/contracts/src/custom-fields.ts`). Its one method, `plan({ sourceType, targetType,
sourceValues, targetValues })`, answers `{ values, carried, skipped }`: the target's bag with the
carried values merged in, the keys it carried, and every key it skipped with its reason. It writes
nothing, audits nothing and emits nothing — Principle XIV's division of responsibility holds:

- either type's owner module absent → an empty plan: nothing carried, nothing recorded, nothing
  queued for later;
- only source definitions whose `carryTo` names the target and whose value is non-empty are
  considered; a dormant value (its definition deleted) is ignored;
- a non-empty target value is kept and neither counted nor recorded;
- a missing target definition, a type mismatch or an audience mismatch skips the key with that
  reason; otherwise the value is coerced by the **target** definition, and a value it refuses — an
  option the target lacks, among others — is skipped as `value_invalid`. Options are therefore
  judged per value at conversion, whatever the definitions table showed;
- unrelated `required` target definitions are never consulted, so a host must not run
  `validateAndMerge` over the merged bag;
- every skip carries `label`, a copy of the **source** definition's `labelDefault` and per-locale
  labels as they read at that moment, so a history entry names the field in the reader's language
  without reading the definitions — and without `custom_fields:read`. Writers store a skip through
  `customFieldCarrySkipRecord`, which keeps `key`, `reason` and `label` and drops anything else.

`custom_fields` is not deactivatable, so its callers resolve the port lazily and need no presence
decision.

**The caller is always the target's owner**, with the target's current bag, inside the write that
creates or links the record:

| Pair | Caller | Where the values and the skip entry are written |
| --- | --- | --- |
| Quote Request → Order | `orders` | in the placement transaction, on the `Order` row and in one comment with `system_note` set |
| Quote Request → Opportunity, Order → Opportunity | `crm` | in the `crm.opportunity.create` or `crm.opportunity.link_add` Command; the skips go into its audit entry as `after.customFieldCarry` |
| Opportunity → Quote Request | `quote_requests` | in its own `quote_request.custom_fields.carry` Command; the skips as one admin-only `custom-field-carry-skipped` event |
| Opportunity → Order | `orders` | in its own `order.custom_fields.carry` Command; the skips as one system note |

So no module reads another's table: the source values arrive through the read ports and events the
caller already used, and the target's owner keeps its record, its write and its audit.

### Receiver ports: Opportunity → Order / Quote Request

An order or quote request created from an opportunity is linked to it afterwards, by `crm`'s
subscriber, after the document's creation has committed. When that origin link is made — and only
then, so the rule that decides the link decides the carry — `crm` pushes the opportunity's values to
the document's owner through `CustomFieldCarryReceiverPort.receiveCarriedValues`, published as
`orderCustomFieldCarryPort` by `orders` and `quoteRequestCustomFieldCarryPort` by `quote_requests`:

- one Command of the owner, in `crm`'s system scope, so the carried values are attributed to the
  **system** while the document's creation stays attributed to the administrator who created it;
- `not-found` both for a record that does not exist and for one of another organization — one
  answer, so nothing leaks; `applied` otherwise, even when nothing was carried;
- fill-empty makes a second call carry nothing more; a call that carries and skips nothing writes
  nothing and is not audited;
- `crm` asks whether `quote_requests` is present before resolving its receiver, and `orders` is a
  binding dependency of `crm` already.

A manual link on the opportunity's *Links* tab passes no carry, and neither does Order → Quote
Request (a customer's *clone to quote*): neither is a conversion this feature carries over.

## Data retention

Deleting a field definition does **not** purge stored values: stale values are
retained dormant (not surfaced, not read) rather than eagerly deleted, so a
mis-deletion is recoverable and host writes never cascade into data loss.

## Adding a custom field

Define it from the admin custom-field surface for the target entity type
(key + localized label + value type + required + audience + options). It then renders on
every record of that type and its value round-trips through the host's
create/edit/read paths — no code change.
