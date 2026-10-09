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

**One exception, added on 2026-10-05**: User Story 15 (custom fields) adds one column to
`crm_opportunities` in a second migration of its own, because it came into scope while the
init migration was being implemented. It adds no entity, and it is the only story that
regenerates the migration registry, so the no-collision property holds. No other table changes
for the stories added that day: webhooks deliver existing events, and the Order / Quote
Request panel reads `crm_opportunity_links`.

**As built, the module has two migrations** in `packages/modules/crm/src/migrations/`:
`20261005T132439_crm_init.ts` — the thirteen tables, the sequence, the seeded workflow — and
`20261005T215329_crm_opportunity_custom_field_values.ts`, which adds
`crm_opportunities.custom_field_values jsonb not null default '{}'` and nothing else. Both
are in `backend/src/db/migrations-registry.generated.ts`; the names carry the timestamps
`migration:new` wrote and were not chosen.

**A further migration, `20261008T135701_crm_opportunity_events.ts`, is built (2026-10-08,
User Stories 21 and 22)** — the module's fourth, after
`20261007T180600_crm_opportunity_reference_admin_user.ts`: one new
table, `crm_opportunity_events`, with its entity class — § *`crm_opportunity_events`*
below. It was scaffolded with `pnpm --filter backend run migration:new -- --module crm --name
opportunity_events`; no number or timestamp is chosen here. It is the only migration and the
only entity of Phases 24 – 27, both in the backend track, so one branch regenerates the two
registries and nothing collides.

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
| `crm_opportunity_events` | `CrmOpportunityEvent` | transitive, same parent *(planned — US21)* |
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
| `custom_field_values` | jsonb, not null, default `{}` | **added by US15 in a second migration** (`migration:new -- --module crm --name opportunity_custom_field_values`), not by the init migration; the value bag of the platform's custom-fields layer for host type `opportunity`. Validated through `customFieldValueService.validateAndMerge` inside the Opportunity's own create/update Command; inherits the row's tenant scope |
| `created_at`, `updated_at` | timestamptz | `created_at` indexed |

Effective value (API field `value`, and every SQL aggregate):
`CASE value_mode WHEN 'manual' THEN manual_value ELSE computed_value END`.

**That rule is written in exactly one file**, `src/backend/domain/effective-value.ts`, in both
forms: `effectiveOpportunityValue(row)` over a loaded row and
`effectiveOpportunityValueSql(alias)` as a SQL expression. The detail, the list's
`sort=value`, the board's column totals and the five analytics statements all read it from
there, and `effective-value.test.ts` scans the module's sources so that no other file spells
it out (research N-I2). Two readings worth knowing: a manual Opportunity nobody has valued is
`null` (skipped by `sum`, not ranked); a computed Opportunity with nothing counting is `0.00`
(it is in the average and at the bottom of a ranking). `computed_value` is maintained only
while the mode is `computed`, and a recalculation does not bump `version` (research N-E4).

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

As built: the `pending` rows are written inside the transition's own Command, in the same
transaction as the status change (research N-16); a forward row left `pending` for more than
a minute is shown as `failed` — the wire schema has no `pending` outcome (N-19); and a
reverse-direction row may also be `failed`, written when an Order-caused move fails for a
reason other than a workflow refusal, before the error is rethrown (N-R5). A reverse row is
never in the unresolved list: retry and dismiss mean "ask the Order again", which has no
reverse reading.

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
| `target_type` | varchar(16) | `product` \| `order` \| `admin_user` (the third since `20261007T180600_crm_opportunity_reference_admin_user`, User Story 18) |
| `target_id` | uuid | by value; index `(target_type, target_id)` |

Derived data: replaced wholesale for a source whenever that source's text is saved.

### `crm_opportunity_events` *(planned — User Stories 21 and 22; research N-CAL1, N-CAL5, N-CAL8)*

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `opportunity_id` | uuid, not null | FK → `crm_opportunities(id)` **on delete cascade**; never changes after insert |
| `name` | varchar(200), not null | 1 … 200 chars, trimmed |
| `description` | text, nullable | plain text, ≤ 5 000 chars; **no reference tokens** — it is not a source of `crm_opportunity_references` |
| `all_day` | boolean, not null, default false | |
| `starts_at` | timestamptz, not null | the instant the Event starts; for an all-day Event, local midnight of its date in `time_zone` |
| `ends_at` | timestamptz, not null | exclusive end; check `ends_at > starts_at`; for an all-day Event, the next local midnight |
| `time_zone` | varchar(64), not null | the IANA zone the Event was planned in (the author's browser's). Decides the all-day date and how the bell and the e-mail word the time; **never** used to draw the calendar |
| `remind_at` | timestamptz, nullable | `null` = no reminder. There is no separate flag: a reminder exists exactly when this is set |
| `reminder_handled_at` | timestamptz, nullable | when the sweep claimed the reminder; `null` = still to do. This is the "sent marker" and the at-most-once latch |
| `reminder_outcome` | varchar(16), nullable | `null` while not handled; then `sending` (claimed, delivery not yet recorded) → `bell` \| `bell_email` \| `email` \| `no_recipient` \| `undeliverable`; or `missed`; or `interrupted`. Check constraint on the set |
| `created_by_admin_user_id` | uuid, nullable | no FK (as every admin-user reference of this module); the fallback recipient of FR-138 |
| `created_at`, `updated_at` | timestamptz | |

Indexes:

- `(opportunity_id, starts_at)` — the Events tab's list and the detail's count.
- `(starts_at)` — the Calendar's range read (`starts_at < :to and ends_at > :from`; an
  Event is at most 25 hours long, so the planner's scan of `starts_at ∈ [:from − 25 h, :to)`
  is the whole candidate set — the service writes the lower bound explicitly).
- **partial** `(remind_at) where remind_at is not null and reminder_handled_at is null` —
  what the sweep reads every minute; it holds only reminders still to do.

**Tenant classification**: `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`, like
the seven other children. The row carries no tenant column, so:

- on the Opportunity's own paths the rule of this page holds unchanged — load the
  `CrmOpportunity` through the scoped EntityManager (`loadOpportunity`), then the Event by
  `(opportunityId, id)`;
- the Calendar reads Events **across** Opportunities and therefore cannot start from one
  parent. It is one SQL statement that joins `crm_opportunities` and carries the caller's
  reach as a predicate on `crm_opportunities.organization_id`, built from
  `orgConstraintFor()` — the shape `services/analytics-service.ts` already uses for its
  cross-Opportunity reads. There is no path that selects from `crm_opportunity_events`
  without that join, the sweep excepted;
- the reminder sweep runs inside `enterSystemScope('crm: deliver due event reminders', …)`:
  it is platform-wide by design, and it establishes the **recipient's** reach to the
  Opportunity's Organization through `AdminReach` (`services/admin-reach.ts`) before telling
  anybody anything.

**Rules (service, on every write)**:

| Rule | Requirement |
| --- | --- |
| the Opportunity is loaded through the scoped EntityManager first; absent ⇒ 404 `CRM_OPPORTUNITY_NOT_FOUND` | FR-134 |
| `name` 1 … 200 chars after trimming; `description` ≤ 5 000 | FR-130 |
| `time_zone` is a zone the runtime knows (`Intl.DateTimeFormat` accepts it) | FR-131 |
| `ends_at > starts_at`; the local date of `starts_at` and of `ends_at − 1 ms` in `time_zone` are the same day | FR-131 |
| all-day: `starts_at` is a local midnight in `time_zone` and `ends_at` the next one (23, 24 or 25 hours later) | FR-131 |
| `remind_at`, when written or changed, is later than now | FR-137 |
| writing a `remind_at` that differs from the stored one clears `reminder_handled_at` and `reminder_outcome`; writing `null` clears all three | FR-140 |
| `opportunity_id`, `created_by_admin_user_id` are never written after insert | FR-130 |

**Reminder states** (what the API calls `reminder.state` — `contracts/admin-api.md` §12d):

```text
remind_at null ───────────────────────────────►  (no reminder)
remind_at set, handled null, opp open ────────►  scheduled
remind_at set, handled null, opp closed ──────►  paused        (derived on read, not stored)
sweep claims: handled = now, outcome = sending
   ├─ delivered ──► bell | bell_email | email   ►  sent
   ├─ nobody qualifies ──► no_recipient
   ├─ neither channel available ──► undeliverable
   ├─ the bell's write threw ──► released: handled = null, outcome = null (next tick retries)
   ├─ the Event was deleted, or its reminder removed or moved, before its turn ──► withdrawn:
   │     nothing delivered, nothing recorded — the row is its editor's
   └─ unrecorded after 10 min ──► interrupted — a presumption: a pass that is still alive
         records what it did over it; one that died leaves it   (never retried)
found > 24 h after remind_at, handled null ────►  missed
```

**A claim is identified by its stamp** (review of 2026-10-08, research N-CALR2, N-CALR3):
the `reminder_handled_at` the claiming pass wrote. Before a claim is delivered the pass
reads the row again — same stamp, `sending` or `interrupted` — and what
the delivery came to is written only where that still holds. So an edit made between the
claim and its turn wins, and `interrupted` stays only on a claim whose pass never came back.

**The recipient** is an active administrator who holds `crm:read` **and** may reach the
Opportunity's Organization, both asked when the reminder fires (FR-138, research N-CALR1).

**Locking**: the claim is one statement per tick — `select … for update skip locked` over
the partial index, joined to an open Opportunity, then the update — inside one Command.
It locks Event rows only and never an Opportunity or a status row, so it takes no part in
the lock order of § *Locking*. Two worker processes sweeping at once split the rows.

**Deleting and closing**: deleting an Opportunity cascades to its Events (FR-136). Closing
one changes no Event row: the Calendar's and the sweep's joins simply stop matching it, and
match again when it is reopened.

### `crm_opportunity_message_reads` and `crm_message_read_baselines` *(added 2026-10-09 — unread messages; `contracts/admin-api.md` §6)*

`20261009T163307_crm_opportunity_message_reads.ts`.

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `crm_opportunity_message_reads` | `opportunity_id` | uuid | PK part; FK → `crm_opportunities`, `on delete cascade` |
| | `admin_user_id` | uuid | PK part; a value, no foreign key |
| | `last_read_at` | timestamptz | the stored `created_at` of the last message read; only moves forward |
| `crm_message_read_baselines` | `id` | smallint | PK, `check (id = 1)` — one row |
| | `unread_since` | timestamptz | `now()` when the migration ran |

`CrmOpportunityMessageRead` is `@TransitivelyScoped('CrmOpportunity', 'opportunityId')`, the
ninth child; `CrmMessageReadBaseline` is `@GlobalEntity()`. No Command writes either, and
no audit action is added below: a read marker is the reader's view state, not a change to
the Opportunity.

## State transitions

**Opportunity status** — any edge present in `crm_opportunity_status_transitions`. Side
columns: entering a `won`/`lost` status sets `closed_at = now()`, `closed_kind = kind`;
leaving one for an `open` status clears both; moving between two closing statuses updates
both.

**Value mode** — `manual ↔ computed` at any time; switching to `computed` triggers a
recalculation; `manual_value` is kept when switching away so switching back restores it. A
mode switch is part of `PATCH /opportunities/:id` and is audited as `crm.opportunity.update`;
there is no action of its own for it.

## Locking (added by the review fixes — research N-R4, N-R12, N-R13)

`crm_opportunities.status_code` holds a status **by value**, with no foreign key, so nothing
in the schema stops a status being deleted or re-defined under an Opportunity that is on its
way into it. The services close that with row locks, in one order everywhere — **the
Opportunity first, then the status row**; a configuration write takes the status row alone —
so no two of them can deadlock.

| Who | Row | Lock | Where |
| --- | --- | --- | --- |
| a transition | the Opportunity | `for update` | `services/opportunity-transition-service.ts` |
| a transition | the **target** status row | `for share`, held to the commit | same Command, after the Opportunity's lock |
| creating an Opportunity | the **start** status row | `for share`, held to the commit | `services/opportunity-service.ts`, the create Command |
| `PATCH /statuses/:code`, `DELETE /statuses/:code` | that status row | `for update`, **before** the in-use count | `services/workflow-config-service.ts` |
| edit, delete, tag, assign, retry, value recalculation | the Opportunity | `for update` | each service's Command |

What follows from it: a configuration write waits for a move in flight and then counts it
(409 `CRM_STATUS_IN_USE`); a move that waited for a configuration write finds its target gone
or its kind changed, writes nothing, and is evaluated again from the top against the workflow
as it now is (422 for a deleted target; the new `closedKind` for a re-defined one); a
creation whose start status went away answers 409 `VERSION_CONFLICT` to a person and is
retried once, in the start status the workflow has by then, for an automatic creation. For a
move caused by an Order, "a closed Opportunity is never reopened" is re-checked under the
Opportunity's lock on every evaluation. A value recalculation locks the Opportunity alone and
writes `computed_value` alone. A document linked automatically or by `origin` writes a link
row and takes no lock.

## Validation rules (from the requirements)

| Rule | Requirement |
| --- | --- |
| title 1…200 chars; Organization exists and is visible to the caller | FR-001, FR-002, FR-006 |
| contact person, when given, belongs to the Organization | FR-002 |
| assignee, when given, is an active Admin UI user **who can reach the Opportunity's Organization** (422 `CRM_ASSIGNEE_INVALID` otherwise — research N-R2) | FR-040 |
| a linked document exists, is visible to the caller, belongs to the Opportunity's Organization, and is linked nowhere else; the caller holds the document owner's read permission (`orders:read`, `rfqs:handle` — research N-R3, N-R13) | FR-020, FR-079 |
| an attachment is not a file a browser runs (HTML, XHTML, SVG, XML/XSL, JavaScript, by name or by type) and is at most 25 MB (research N-R1, N-F1) | FR-044, FR-080 |
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

**User Stories 21 and 22 add no Setting.** The reminder e-mail is switched off where every
transactional e-mail is, on the e-mail templates screen; the five-minute online window, the
60-second sweep and the 24-hour lateness limit are constants (research N-CAL5, N-CAL6).

No secret is involved, so no `secret` value type. The workflow, the mappings and the counting
statuses are **not** Settings: they are relational configuration with their own screen,
exactly as Order statuses are.

## Audit actions (Principle XIII)

All through `CommandBus.run`. The set below is the one the module emits — every
`'crm.<object>.<verb>'` literal in `src/backend/services/` — and
`src/backend/services/opportunity-history-labels.test.ts` holds it: every audited action has a
label under `auditLog.<action>` in both bundles, and no label names an action no Command
declares.

| Object type | Actions that write an audit entry |
| --- | --- |
| `crm_opportunity` (the Opportunity's id) | `crm.opportunity.create`, `.update`, `.delete`, `.transition`, `.assign`, `.link_add`, `.link_remove`, `.link_sync_set`, `.propagation_retry`, `.propagation_dismiss`, `.propagation_skip`, `.tag_set`, `.note_add`, `.note_update`, `.note_delete`, `.message_add`, `.attachment_add`, `.attachment_remove` |
| `crm_opportunity` — *planned, US21* | `crm.opportunity.event_add`, `.event_update`, `.event_remove` — object id the **Opportunity's**, so they are in its history tab; state carries the Event's id, name, `allDay`, `startsAt`, `endsAt`, `timeZone`, `remindAt` and the description's **length**, never its text (the rule notes already follow — research N-R6) |
| `crm_opportunity_status` | `crm.status.create`, `.update`, `.delete`, `.set_initial`, `.set_transitions` |
| `crm_status_mapping` | `crm.mapping.set` |
| `crm_value_counting` | `crm.value_counting.set` |
| `crm_tag` | `crm.tag.create`, `.update`, `.delete` |

Three more Commands run through the bus and **never** write an audit entry (`skipAudit` on
every path), so they can never appear in a history and carry no label:
`crm.opportunity.propagation_record` (the second half of a transition or a retry that already
has an entry — research N-16), `crm.opportunity.propagation_echo` (marking a forward row as
echoed — N-B3) and `crm.opportunity.value_recalculate` (a derived figure — N-E4).

Corrections to this section's first version, as built:

- **`crm.opportunity.propagation_skip` was missing.** An Order-caused move the Opportunity
  did not follow — refused by the workflow or a guard (`skipped`), or failed for another
  reason (`failed`) — is one Command that writes the reverse-direction propagation row *and*
  an audit entry, because the change history is read from the audit trail and a skipped
  change must be "recorded on the Opportunity with the reason" (research N-B3, N-R5).
- **`crm.opportunity.value_mode_set` was listed and nothing emits it.** A mode switch is a
  field of `PATCH /opportunities/:id` and is audited as `crm.opportunity.update`.
- `PATCH /statuses/:code` with `isInitial: true` alone is audited as `crm.status.set_initial`;
  any other status edit as `crm.status.update` (research N-20).
- A write that changes nothing writes no entry: naming the assignee already there, a note
  saved with the text it has, a tag set equal to the current one.
- **A note's or a message's text is never in an audited state** — the entries carry the
  comment's id, kind, author and the text's length (research N-R6). The Opportunity's own
  entries do carry its title and description, a transition's its optional `reason`, an
  attachment's the file name.

`crm.opportunity.assigned`, `crm.opportunity.message` and `crm.opportunity.mention` are not
audit actions: they are the *kinds* of the three notification-bell entries
(`services/crm-notifier.ts`).

*Planned with US21*: one more Command that never writes an audit entry,
`crm.opportunity.event_reminder` — the sweep's claim and its recording of the outcome are
bookkeeping about a delivery, not a change somebody made to the Opportunity, and a line per
reminder would bury the history (`skipAudit` with that reason at the call site). And one
more bell kind that is not an audit action: `crm.opportunity.event_reminder`. The same
string names both on purpose, as nothing reads one where the other is expected; the
history-labels test holds that the Command has no label.

System-driven writes (subscribers, the recalculation worker) run their Commands inside
`enterSystemScope('<reason>', …)`; `computed_value` maintenance is a derived figure and uses
`skipAudit: true` with the reason stated at the call site.
