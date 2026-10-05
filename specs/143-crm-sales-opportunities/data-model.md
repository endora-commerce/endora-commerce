# Data Model: CRM — Sales Opportunities

**Feature**: `specs/143-crm-sales-opportunities/` · **Date**: 2026-10-05

All tables are owned by module `crm` and created by **one** init migration scaffolded with
`pnpm --filter backend run migration:new -- --module crm --name init` (no number is assigned —
`specs/conventions/module-migrations.md`). The whole schema lands in the Foundational phase,
before any user story, for one reason: `composer:generate` rewrites
`backend/src/db/migrations-registry.generated.ts` and `entities-registry.generated.ts`, so
stories that each added a migration or an entity in parallel worktrees would collide on
generated files. With the schema and every `@Entity()` class in place first, later stories add
services, routes and pages only.

Conventions: `id uuid` primary key (`randomUUID()`), `created_at` / `updated_at timestamptz`,
camelCase properties mapped to snake_case columns (Principle VI). Money is `numeric(14,2)`
held as a string in TypeScript, as `orders.total` is. Entity classes live in
`packages/modules/crm/src/backend/entities/`, one file per class, kebab-case
`*.entity.ts`. Class names carry the `Crm` prefix because MikroORM refuses two entities with
one class name platform-wide and `@TransitivelyScoped` addresses its parent by class name.

## Overview

```text
                       crm_opportunity_statuses ──< crm_opportunity_status_transitions
                              │ (code, by value)
                              │        crm_order_status_mappings   crm_value_counting_statuses
                              │        (opportunity status ↔ order status, by value)
                              ▼
organizations.id ◄── crm_opportunities ──► sales_channels.id (nullable)
 (FK, restrict)          │   customer_account_id, assigned_admin_user_id (uuid, no FK)
                         │
        ┌────────────────┼──────────────┬───────────────┬──────────────┬─────────────┐
        ▼                ▼              ▼               ▼              ▼             ▼
 crm_opportunity   crm_opportunity  crm_status     crm_opportunity crm_opportunity crm_opportunity
 _links            _status_history  _propagations  _comments       _attachments    _tags ──► crm_tags
 (order |                                                │              │
  quote_request,                                         └──────┬───────┘
  document_id by value)                                         ▼
                                                     crm_opportunity_references
                                                     (product | order, by value)
```

## Tenant classification (Principle XI)

| Entity | Class | Classification |
| --- | --- | --- |
| `crm_opportunities` | `CrmOpportunity` | `@OrgScoped()` — key `organizationId` |
| `crm_opportunity_links` | `CrmOpportunityLink` | `@TransitivelyScoped('CrmOpportunity', 'opportunityId')` |
| `crm_opportunity_status_history` | `CrmOpportunityStatusHistory` | transitive, same parent |
| `crm_status_propagations` | `CrmStatusPropagation` | transitive, same parent |
| `crm_opportunity_comments` | `CrmOpportunityComment` | transitive, same parent |
| `crm_opportunity_attachments` | `CrmOpportunityAttachment` | transitive, same parent |
| `crm_opportunity_tags` | `CrmOpportunityTag` | transitive, same parent |
| `crm_opportunity_references` | `CrmOpportunityReference` | transitive, same parent |
| `crm_opportunity_statuses` | `CrmOpportunityStatus` | `@GlobalEntity()` |
| `crm_opportunity_status_transitions` | `CrmOpportunityStatusTransition` | `@GlobalEntity()` |
| `crm_order_status_mappings` | `CrmOrderStatusMapping` | `@GlobalEntity()` |
| `crm_value_counting_statuses` | `CrmValueCountingStatus` | `@GlobalEntity()` |
| `crm_tags` | `CrmTag` | `@GlobalEntity()` |

Rule for every service: **a child row is never loaded by its own id alone.** Load the
`CrmOpportunity` through the scoped EntityManager (absent ⇒ 404, indistinguishable from
out-of-scope), then the child by `(opportunityId, id)`.

## Tables

### `crm_opportunity_statuses`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `code` | varchar(64), unique | stable identifier, `^[a-z][a-z0-9_]*$`; immutable after create |
| `name` | jsonb | `{ en: 'New', pl: 'Nowa' }` |
| `default_name` | varchar(120) | fallback when the language is missing from `name` |
| `kind` | varchar(8) | `open` \| `won` \| `lost`; check constraint |
| `is_initial` | boolean, default false | **partial unique index** `where is_initial` — at most one |
| `weight` | integer, default 100 | display and board column order |
| `color` | varchar(16), default `#64748b` | `#rrggbb` |
| `created_at`, `updated_at` | timestamptz | |

Rules (service, on every write): exactly one initial status and it is `open`; ≥ 1 `won`,
≥ 1 `lost`; a status referenced by any `crm_opportunities.status_code` cannot be deleted; the
initial status cannot be deleted (move the flag first); deleting a status deletes its
transitions, its mappings and nothing else.

Seeded by the init migration: `new` (initial, open, 10), `qualified` (open, 20), `proposal`
(open, 30), `negotiation` (open, 40), `won` (won, 90), `lost` (lost, 100).

### `crm_opportunity_status_transitions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `from_status_code` | varchar(64), indexed | by value, validated in service |
| `to_status_code` | varchar(64) | |
| `created_at` | timestamptz | |

Unique `(from_status_code, to_status_code)`; `from ≠ to` (check). A closing status **may**
have outgoing transitions.

Seeded: `new→qualified`, `qualified→proposal`, `proposal→negotiation`, `negotiation→won`,
`proposal→won`, each open status `→lost`, `lost→new`.

### `crm_order_status_mappings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `direction` | varchar(24) | `opportunity_to_order` \| `order_to_opportunity` |
| `opportunity_status_code` | varchar(64) | must exist in `crm_opportunity_statuses` |
| `order_status_code` | varchar(64) | an Order status code, **by value**; validated on write through the Orders API the admin uses, re-validated at use by the port (`unknown_status`) |
| `require_all_orders` | boolean, default false | meaningful only for `order_to_opportunity` |
| `created_at`, `updated_at` | timestamptz | |

Two partial unique indexes:
`(opportunity_status_code) where direction = 'opportunity_to_order'` — one Order status per
Opportunity status; `(order_status_code) where direction = 'order_to_opportunity'` — one
Opportunity status per Order status. Nothing seeded.

### `crm_value_counting_statuses`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `document_kind` | varchar(16) | `order` \| `quote_request` |
| `status_code` | varchar(64) | an Order status code, or one of the six `QuoteRequestStatus` values |
| `created_at` | timestamptz | |

Unique `(document_kind, status_code)`. Nothing seeded: with an empty set a computed value is 0
and the configuration screen says why.

### `crm_opportunities`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `number` | varchar(32), unique | `OPP-` + zero-padded value of sequence `crm_opportunity_number_seq`; assigned in the create Command |
| `title` | varchar(200) | required |
| `description` | text, nullable | plain text with reference tokens (research R-21) |
| `organization_id` | uuid, **not null**, indexed | **FK → `organizations(id)` on delete restrict** |
| `customer_account_id` | uuid, nullable | contact person; validated through `customerAccountReadPort` to belong to the Organization; no FK |
| `sales_channel_id` | uuid, nullable, indexed | **FK → `sales_channels(id)` on delete restrict**; `null` = no channel |
| `status_code` | varchar(64), indexed | a `crm_opportunity_statuses.code`, by value |
| `assigned_admin_user_id` | uuid, nullable, indexed | no FK (as `quote_requests.assigned_admin_user_id`) |
| `value_mode` | varchar(8), default `manual` | `manual` \| `computed` |
| `manual_value` | numeric(14,2), nullable | |
| `computed_value` | numeric(14,2), default 0 | maintained by `OpportunityValueService` |
| `currency` | char(3) | ISO 4217; required on create (the form suggests one), copied from the document on automatic creation; immutable |
| `expected_close_date` | date, nullable | |
| `source` | varchar(16), default `manual` | `manual` \| `order` \| `quote_request` |
| `closed_at` | timestamptz, nullable, indexed | set on entering a `won`/`lost` status, cleared on leaving |
| `closed_kind` | varchar(8), nullable | `won` \| `lost` |
| `created_by_admin_user_id` | uuid, nullable | `null` for automatic creation |
| `version` | integer, default 0 | optimistic concurrency on PATCH (`If-Match`), as `quote_requests` |
| `created_at`, `updated_at` | timestamptz | `created_at` indexed |

Effective value (API field `value`, and every SQL aggregate):
`CASE value_mode WHEN 'manual' THEN manual_value ELSE computed_value END`.

Additional indexes: `(organization_id, status_code)`; `(assigned_admin_user_id, status_code)`;
`(closed_kind, closed_at)`.

### `crm_opportunity_links`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid, indexed | FK → `crm_opportunities(id)` on delete cascade |
| `document_kind` | varchar(16) | `order` \| `quote_request` |
| `document_id` | uuid | the Order's or Quote Request's id, **by value** — polymorphic, so no FK; integrity is the owner's read port at link time |
| `sync_status` | boolean, default true | status following on/off; ignored for quote requests |
| `link_source` | varchar(24) | `manual` \| `auto` \| `created_from_opportunity` \| `quote_conversion` |
| `linked_by_admin_user_id` | uuid, nullable | |
| `created_at` | timestamptz | |

**Unique `(document_kind, document_id)`** — a document belongs to at most one Opportunity, and
the constraint is what makes automatic creation idempotent under event redelivery.

### `crm_opportunity_status_history`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid | FK cascade; index `(opportunity_id, changed_at)` |
| `from_status_code` | varchar(64), nullable | `null` for the creation entry |
| `to_status_code` | varchar(64), indexed | |
| `changed_at` | timestamptz, indexed | |
| `actor_admin_user_id` | uuid, nullable | |
| `cause` | varchar(16) | `manual` \| `order_status` \| `system` \| `created` |
| `cause_order_id` | uuid, nullable | set when `cause = 'order_status'` |
| `reason` | text, nullable | |

Append-only. One row is written at creation (`from = null`, `cause = 'created'`) so "time in
the start status" is measurable. It is the analytics source; the *history tab* reads the audit
log (research R-16).

### `crm_status_propagations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid | FK cascade; index `(opportunity_id, created_at)` |
| `order_id` | uuid | by value; index `(order_id, direction, outcome)` |
| `direction` | varchar(24) | `opportunity_to_order` \| `order_to_opportunity` |
| `opportunity_status_code` | varchar(64) | the Opportunity status involved |
| `order_status_code` | varchar(64) | the Order status requested (forward) or observed (reverse) |
| `outcome` | varchar(16) | `pending` \| `applied` \| `already_there` \| `not_found` \| `unknown_status` \| `not_permitted` \| `vetoed` \| `skipped` \| `failed` |
| `detail` | text, nullable | the port's `detail`, or CRM's reason for `skipped` |
| `echoed` | boolean, default false | forward rows: the resulting `order.status_changed.v1` has been seen and suppressed |
| `dismissed_at` | timestamptz, nullable | a user acknowledged a refusal |
| `status_history_id` | uuid, nullable | the transition that caused it |
| `created_at`, `resolved_at` | timestamptz | |

State: `pending → applied | already_there | not_found | unknown_status | not_permitted |
vetoed | failed`; *Retry* inserts a new row and sets `dismissed_at` on the old one. `skipped`
is reverse-direction only (the Opportunity graph refused, a guard vetoed, or the "all Orders"
rule is not yet met — the last is **not** recorded, to avoid a row per Order event).
"Unresolved" for the UI = forward rows with a refusing outcome and `dismissed_at is null`.

### `crm_tags`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | varchar(64) | unique on `lower(name)` |
| `color` | varchar(16), default `#64748b` | |
| `created_at`, `updated_at` | timestamptz | |

### `crm_opportunity_tags`

`opportunity_id` (FK cascade) + `tag_id` (FK → `crm_tags(id)` on delete cascade), composite
primary key, `created_at`. Index on `tag_id`.

### `crm_opportunity_comments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid | FK cascade; index `(opportunity_id, kind, created_at)` |
| `kind` | varchar(8) | `note` \| `message` |
| `author_admin_user_id` | uuid | |
| `body` | text | plain text with reference tokens; 1…10 000 chars |
| `edited_at` | timestamptz, nullable | notes only |
| `deleted_at` | timestamptz, nullable | notes only; soft delete so history stays truthful |
| `created_at` | timestamptz | |

### `crm_opportunity_attachments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid, indexed | FK cascade |
| `asset_id` | uuid, indexed | an `assets_library` asset, by value; protected through `assetReferenceRegistry` |
| `file_name` | varchar(255) | snapshot of the asset's name at attach time |
| `uploaded_by_admin_user_id` | uuid | |
| `created_at` | timestamptz | |

Unique `(opportunity_id, asset_id)`.

### `crm_opportunity_references`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid, indexed | FK cascade |
| `source_kind` | varchar(16) | `description` \| `comment` |
| `source_id` | uuid, nullable | the comment id; `null` for the description |
| `target_type` | varchar(16) | `product` \| `order` |
| `target_id` | uuid | by value; index `(target_type, target_id)` |

Derived data: replaced wholesale for a source whenever that source's text is saved.

## State transitions

**Opportunity status** — any edge present in `crm_opportunity_status_transitions`. Side
columns: entering a `won`/`lost` status sets `closed_at = now()`, `closed_kind = kind`;
leaving one for an `open` status clears both; moving between two closing statuses updates
both.

**Value mode** — `manual ↔ computed` at any time; switching to `computed` triggers a
recalculation; `manual_value` is kept when switching away so switching back restores it.

## Validation rules (from the requirements)

| Rule | Requirement |
| --- | --- |
| title 1…200 chars; Organization exists and is visible to the caller | FR-001, FR-002, FR-006 |
| contact person, when given, belongs to the Organization | FR-002 |
| assignee, when given, is an active Admin UI user | FR-040 |
| a linked document exists, is visible to the caller, belongs to the Opportunity's Organization, and is linked nowhere else | FR-020 |
| a transition is in the graph and no guard vetoes it | FR-013, FR-015 |
| a mapping names an existing Opportunity status; at most one per key per direction | FR-021, FR-024 |
| a tag name is unique case-insensitively, 1…64 chars | FR-050 |
| a note/message body is 1…10 000 chars; only the author edits or deletes a note; a message is immutable | FR-042, FR-043 |
| reference tokens name a UUID; unknown or invisible targets are stored and rendered "unavailable" | FR-045 |

## Module settings (Settings module, declared in the manifest)

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `crm.enabled` | boolean | `true` | the activation control (`activation.settingCode`) |
| `crm.auto_create_from_orders` | boolean | `false` | FR-060 — declared in the Foundational phase (the off-state proof needs a non-activation setting), behaviour in US9 |
| `crm.auto_create_from_quote_requests` | boolean | `false` | FR-060 |

No secret is involved, so no `secret` value type. The workflow, the mappings and the counting
statuses are **not** Settings: they are relational configuration with their own screen,
exactly as Order statuses are.

## Audit actions (Principle XIII)

All through `CommandBus.run`. Object type `crm_opportunity` with the Opportunity's id for
everything about one Opportunity: `crm.opportunity.create`, `.update`, `.delete`,
`.transition`, `.assign`, `.value_mode_set`, `.link_add`, `.link_remove`, `.link_sync_set`,
`.propagation_retry`, `.propagation_dismiss`, `.tag_set`, `.note_add`, `.note_update`,
`.note_delete`, `.message_add`, `.attachment_add`, `.attachment_remove`.
Object type `crm_opportunity_status`: `crm.status.create`, `.update`, `.delete`,
`.set_initial`, `.set_transitions`. Object type `crm_status_mapping`: `crm.mapping.set`.
Object type `crm_value_counting`: `crm.value_counting.set`. Object type `crm_tag`:
`crm.tag.create`, `.update`, `.delete`.

System-driven writes (subscribers, the recalculation worker) run their Commands inside
`enterSystemScope('<reason>', …)`; `computed_value` maintenance is a derived figure and uses
`skipAudit: true` with the reason stated at the call site.
