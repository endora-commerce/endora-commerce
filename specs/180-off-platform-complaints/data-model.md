# Data model: Return-case notifications and complaints without a platform order

**Feature**: `specs/180-off-platform-complaints/` | **Date**: 2026-11-13 | **Plan**: [plan.md](./plan.md)

Every table here is owned by `returns` (`packages/modules/returns/src/backend/entities/`).
Migrations are scaffolded with `pnpm --filter backend run migration:new` and registered by
`composer:generate`; they are named below by purpose, never by number or timestamp
(`specs/conventions/module-migrations.md`). Column names are snake_case in SQL and camelCase on
the entity.

## 1. Changes in phase A

### 1.1 `return_cases` (`ReturnCase`, `@OrgScoped`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `authorized_by_admin_user_id` | `uuid` | yes | — | The administrator whose action moved the case into `authorized` (R2, FR-A40). Written in the same flush as `authorized_at`, by whichever path entered the status (research R-7.3). No FK: `admin_users` owns the table. Index: none (displayed, never filtered or sorted). |

Invariant: `authorized_by_admin_user_id is not null ⇒ authorized_at is not null`. Not a database
constraint, because the backfill leaves legitimately unknown rows as `null`.

### 1.2 `return_statuses` (`ReturnStatus`, `@GlobalEntity`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `notify_customer_on_entry` | `boolean` | no | `false` | FR-A30. Ignored for `authorized` and `rejected`, which send their dedicated e-mail (research R-7); the write refuses `true` on those two with `VALIDATION_FAILED` detail `dedicated_email_status`. |

### 1.3 Migration A — *returns: authorizer and status notifications*

1. `alter table "return_cases" add column "authorized_by_admin_user_id" uuid null;`
2. `alter table "return_statuses" add column "notify_customer_on_entry" boolean not null default false;`
3. Backfill (research R-8), reading the kernel-owned `audit_log_entries`, writing only
   `return_cases`:

   ```sql
   update "return_cases" rc
      set "authorized_by_admin_user_id" = (
        select e."actor_admin_user_id"
          from "audit_log_entries" e
         where e."object_type" = 'return_case'
           and e."object_id" = rc."id"::text
           and e."action" = 'return.status_changed'
           and e."state_after"->>'statusCode' = 'authorized'
           and e."actor_admin_user_id" is not null
         order by e."acted_at" desc
         limit 1
      )
    where rc."authorized_at" is not null
      and rc."authorized_by_admin_user_id" is null;
   ```

   Column names verified against `packages/platform/src/migrations/20260424T165847_core_foundation_init.ts`
   (`object_id varchar(120)`, `acted_at`, `state_after jsonb`, `actor_admin_user_id`). `down` drops
   both columns.

No queue state is persisted: the `returns-notifications` jobs live in Redis (research R-2).

## 2. Changes in phase B

### 2.1 `return_cases`

| Column | Change / type | Null | Notes |
| --- | --- | --- | --- |
| `order_id` | **drop `not null`** | yes | `null` = off-platform (R5). Index kept. |
| `purchase_proof_number` | `varchar(100)` | yes | FR-B13; set only when `order_id is null`. |
| `purchase_date` | `date` | yes | FR-B13; **required** when `order_id is null`, not in the future (validated in the service against the channel's `returns.time_zone` day). |
| `contact` | `jsonb` | yes | `{ name, email, phone }` as submitted (FR-B16); `null` on order cases and after erasure. |
| `return_address` | `jsonb` | yes | `{ name, company?, street, postalCode, city, countryCode, phone? }` as submitted; `null` on order cases and after erasure. |
| `accepted_clauses` | `jsonb` | no, default `'[]'` | `[{ clauseId, revision, mode, language, label, text, linkUrl }]` — every clause **shown**, `must_accept` (ticked) and `inform_only` alike, as shown (FR-B31, D-1). Any case kind. |
| `clauses_accepted_at` | `timestamptz` | yes | The submission time; set when `accepted_clauses` is non-empty. |
| `resolution_note` | `text` | yes | The operator's note of a `settled_outside` settlement (FR-B33a), 1–2 000 characters. |
| `resolution_type` | widen the domain | yes | Adds `settled_outside` (15 characters; the column is `varchar(16)`). |
| `submission_key` | `uuid` | yes | Idempotency key of the storefront post (research R-18). |
| `personal_data_erased_at` | `timestamptz` | yes | Stamp of `return_case.erase_personal_data` (research R-15). |

Constraints and indexes:

- `check ("order_id" is not null or "kind" = 'complaint')` — R3, FR-B11.
- `check ("order_id" is not null or "purchase_date" is not null)` — FR-B13.
- `check ("resolution_type" <> 'settled_outside' or ("order_id" is null and "resolution_note" is not null))` — FR-B33a.
- `unique ("customer_account_id", "submission_key") where "submission_key" is not null`.
- `index ("organization_id") where "order_id" is null` is **not** added: the list filter
  `order_id is null` runs within the tenant filter on a table of modest size; revisit with a
  measurement, not by default.

`organization_id` stays nullable in the column (F7), but every row this feature writes has it set:
the no-order path takes it from `ReturnCustomerContext` and refuses without one (Principle XI).
Tightening the column for legacy rows is not this feature's change.

### 2.2 `return_case_items` (`ReturnCaseItem`, `@GlobalEntity`, reached through its case)

| Column | Change / type | Notes |
| --- | --- | --- |
| `order_item_id` | **drop `not null`** | `null` on a no-order line. |
| `product_id` | **drop `not null`** | `null` for a free-text model (FR-B12). |
| `product_name` | unchanged (`varchar(512)`) | Catalog name at submission (FR-B14) or the free-text model (≤ 255 by contract). |
| `serial_number` | `varchar(100)` null | FR-B12; allowed on any complaint line. |

A no-order line has `default_refund_amount = default_discount_amount = approved_refund_amount = 0`;
`description` is required for it (validated in the contract, FR-B12). Check: `product_name <> ''`.

### 2.3 `return_case_attachments` (`ReturnCaseAttachment`) — **reclassified `@OrgScoped`**

| Column | Change / type | Null | Notes |
| --- | --- | --- | --- |
| `return_case_id` | **drop `not null`** | yes | `null` while the upload is pending (research R-12). |
| `asset_id` | **drop `not null`** | yes | Legacy link; no new row sets it. |
| `organization_id` | `uuid` | yes | The tenant column; backfilled from the case for existing rows. Stays nullable (owner ruling 2026-11-16): a legacy row whose case has no organization, and a guest's file (`specs/181-guest-complaints/`), have none — such a row matches no organization-scoped read. |
| `customer_account_id` | `uuid` | yes | The uploader; `null` on legacy rows. |
| `type` | `varchar(24)` | no, default `'other'` | `photo` \| `proof_of_purchase` \| `other` (FR-B20). |
| `filename` | `varchar(255)` | yes | Display name, sanitised. |
| `mime_type` | `varchar(64)` | yes | The sniffed type, never the declared one. |
| `size_bytes` | `integer` | yes | |
| `storage_backend` | `varchar(32)` | yes | `ObjectStore.code` at write time, so reads use `getForBackend` (port contract). |
| `storage_locator` | `varchar(512)` | yes | `returns/<organizationId>/<attachmentId>`. |
| `expires_at` | `timestamptz` | yes | Set while pending (24 h); cleared when claimed. |

Constraints and indexes:

- `check ("asset_id" is not null or "storage_locator" is not null)`.
- `check ("return_case_id" is not null or "expires_at" is not null)` — a row is either attached or pending.
- `index ("expires_at") where "return_case_id" is null` — the maintenance sweep.
- `index ("customer_account_id")` — the erasure.

Reclassifying from `@GlobalEntity` to `@OrgScoped` is required because a pending upload has no
case to inherit a tenant from (Principle XI's total classification); the cross-tenant test for
the entity is part of the WP.

### 2.4 `return_case_clauses` (new, `ReturnCaseClause`, `@GlobalEntity` — platform configuration, like `return_reasons`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | | PK |
| `label` | `jsonb` | no | | `{ <lang>: string }`, ≤ 120 characters each; heading shown above the text. |
| `text` | `jsonb` | no | | `{ <lang>: string }`, ≤ 5 000 characters each; plain text with line breaks, rendered as text. |
| `link_url` | `jsonb` | yes | | `{ <lang>: string }`, optional link to a full terms page, `https:` only, ≤ 2 000 characters (owner ruling). |
| `applies_to` | `varchar(16)` | no | `'both'` | `return` \| `complaint` \| `both` (D-1). |
| `mode` | `varchar(16)` | no | `'must_accept'` | `must_accept` \| `inform_only` (D-1). |
| `sales_channel_id` | `uuid` | yes | | `null` = every channel. No FK (kernel table referenced by value, as `return_cases.sales_channel_id`). |
| `weight` | `integer` | no | `100` | Order on the form. |
| `is_active` | `boolean` | no | `true` | |
| `revision` | `integer` | no | `1` | Incremented by every edit of `label`, `text`, `link_url`, `applies_to` or `mode` (research R-14). |

Checks: `applies_to in ('return','complaint','both')`, `mode in ('must_accept','inform_only')`.
Which clauses a submission shows is research R-14's `clausesFor` — never a `must_accept` clause on a
consumer withdrawal.
| `created_at`, `updated_at` | `timestamptz` | no | | |

Validation: a clause must carry `label` and `text` in the platform's default language; the other
shipped languages fall back to it when shown.

### 2.5 Migration B — *returns: complaints without a platform order*

One migration, in this order: the `return_cases` changes (2.1) with their constraints; the
`return_case_items` changes (2.2); the `return_case_attachments` changes (2.3) — add columns,
backfill `organization_id` from `return_cases` (the column stays nullable); `create table
"return_case_clauses"` (2.4). It references no other module's table. `down` reverses it and
refuses (raises) when off-platform rows exist, because `order_id` cannot become `not null` again
without deleting them.

## 3. State and lifecycle

- **Off-platform** is `orderId === null`, computed on read (DTO `offPlatform: boolean`) and filtered
  as `order_id is null` / `is not null`. Never written.
- **Attachment**: *pending* (`return_case_id null`, `expires_at` set) → *attached* (claimed by
  `return_case.create` or written by `return_case.attachment.add`; `expires_at null`) → *erased*
  (row and bytes deleted by erasure). A pending row past `expires_at` is deleted by the
  maintenance job.
- **Settlement of an off-platform case**: `resolution_type ∈ { replacement, repair, settled_outside }`;
  `settled_outside` requires `resolution_note` and is possible from authorization until the case is
  terminal (D-5, research R-19 — it enters `resolved` without needing a graph edge).
- **Reference**: `rma_number ?? '#' + first 8 hex of id` (research R-20), computed on read, never
  stored.
- **Authorization**: entering `authorized` (any path) sets `rma_number` (if absent), `authorized_at`,
  `authorized_by_admin_user_id` (the acting admin; `null` for a system actor).

## 4. Settings (manifest, `returns` group, all sales-channel scopable)

| Code | Type | Default | MR |
| --- | --- | --- | --- |
| `returns.new_case_recipients` | `string_list` | `[]` | A |
| `returns.off_platform_complaints_enabled` | `boolean` | `false` | B |
| `returns.proof_of_purchase_required` | `boolean` | `false` | B |

## 5. Domain events (in-process)

| Event | Change | MR |
| --- | --- | --- |
| `return.status.*` (`ReturnStatusEvent`) | `orderId: string \| null` (widened) | B |
| `return_case.created.v1` (new, `RETURN_CASE_CREATED_EVENT` in `packages/contracts/src/returns.ts`) | `{ eventId, occurredAt, returnCaseId, organizationId, salesChannelId, kind, offPlatform }` — ids only; emitted by the `return_case.create` Command, dispatched after commit; `returns` itself subscribes to enqueue `case_submitted`. Not offered to outbound webhooks in this feature. | B |
