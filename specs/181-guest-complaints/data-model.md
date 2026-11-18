# Data model: Complaints from guests without a customer account

**Feature**: `specs/181-guest-complaints/` | **Date**: 2026-11-16 | **Plan**: [plan.md](./plan.md)

Every table here belongs to `returns` (`packages/modules/returns/src/backend/entities/`). There is
**one migration**, scaffolded with `pnpm --filter backend run migration:new -- --module returns
--name returns_guest_complaints` and registered with `composer:generate`. It is named by purpose,
never by number (`specs/conventions/module-migrations.md`), and it depends on 180's
`returns_off_platform_complaints` migration. SQL names are snake_case; entity properties are
camelCase.

## 1. `return_cases` (`ReturnCase`, `@OrgScoped`, unchanged classification)

| Column | Change / type | Null | Notes |
| --- | --- | --- | --- |
| `customer_account_id` | **drop `not null`** | yes | `null` = **guest case** (research R-2). Entity: `customerAccountId: string \| null`. |
| `guest_session_id` | `uuid` | yes | The verification/session row that filed the case (R-4). It scopes the idempotency key. There is no FK, because the session row is purged after 7 days (FR-026). Set only on guest cases. |
| `contact_verified_at` | `timestamptz` | yes | When the contact address was verified: the session's `redeemed_at` (FR-063). Guest cases only. |
| `tracking_version` | `integer` | yes | `1` at filing, `+1` per *Send a new tracking link* (R-5). `null` on customer cases. |
| `closed_at` | existing, **now written** | yes | Set by the transition service on entry into any `isTerminal` status, for every case (R-9). Not back-filled: only guest cases read it, and none exist before this migration. |
| `contact`, `return_address`, `personal_data_erased_at` | existing (180) | | A guest case always has `contact.email` = the verified address until erased. |

Constraints and indexes added:

- `check ("customer_account_id" is not null or "organization_id" is null)` (`return_cases_guest_no_org_check`): a guest case never carries an organization. It is validated when created, and every existing row satisfies it (R-1, R-2).
- `check ("customer_account_id" is not null or ("guest_session_id" is not null and "tracking_version" is not null and "order_id" is null and "kind" = 'complaint'))` (`return_cases_guest_shape_check`): G1 and FR-034 in the database.
- `check ("customer_account_id" is null or ("guest_session_id" is null and "tracking_version" is null))` (`return_cases_customer_shape_check`).
- `unique ("guest_session_id", "submission_key") where "customer_account_id" is null and "submission_key" is not null` (`return_cases_guest_submission_key_unique`, R-4).
- `index ("closed_at") where "customer_account_id" is null and "personal_data_erased_at" is null` (`return_cases_guest_retention_idx`): the erasure sweep.
- `index (lower("contact"->>'email')) where "contact" is not null` (`return_cases_contact_email_idx`): admin search by contact e-mail (R-10), customer off-platform cases included.

Derived on read, never stored:

- `guest = customerAccountId === null`.
- `offPlatform = orderId === null` (180). A guest case is always off-platform.
- `trackingLinkValidUntil = personalDataErasedAt ? null : closedAt ? closedAt + 90 days : null`, where `null` with an open case means "while open".
- `guestDataErasureDueAt = closedAt + clamp(returns.guest_data_retention_days, 30, 3650) days`.

## 2. `return_case_comments` (`ReturnCaseComment`, `@GlobalEntity`, reached through its case)

| Column | Change / type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `author_guest` | `boolean` | no | `false` | A comment posted through the tracking link (FR-042). The DTO's `authorKind` becomes `admin \| customer \| guest`. Guest comments are always customer-visible and never `notify_customer`. |

Check `return_case_comments_guest_author_check`: `"author_guest" = false or ("author_admin_user_id" is null and "author_customer_account_id" is null and "is_customer_visible" = true)`.
Comments are **kept** on erasure (G10).

## 3. `return_case_attachments` (`ReturnCaseAttachment`, `@OrgScoped`, nullable `organization_id`: G11, already in 180)

| Column | Change / type | Null | Notes |
| --- | --- | --- | --- |
| `guest_session_id` | `uuid` | yes | The uploading guest session, for a pending guest upload and kept after claiming (R-4). |
| `uploaded_by_guest` | `boolean`, default `false` | no | Set for files a guest added, whether before filing or through the tracking link. The admin detail labels the uploader. |

- Check `return_case_attachments_owner_check`: `"return_case_id" is not null or "customer_account_id" is not null or "guest_session_id" is not null`. A pending row always has an owner. Existing 180 pending rows carry `customer_account_id`.
- Index `("guest_session_id") where "return_case_id" is null`: claiming at submission.
- Storage locator for guest files: `returns/guest/<attachmentId>` (no organization segment). 180's `returns/<organizationId>/<attachmentId>` is unchanged for customers.

## 4. `return_guest_verifications` (new, `ReturnGuestVerification`, **`@GlobalEntity`**: research R-1)

One row per link requested. The same row becomes the guest session when the link is redeemed.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | | PK. The verification link is `seal('returns.guest-verify.v1', id)` (R-3, R-5). Never stored. |
| `sales_channel_id` | `uuid` | no | | The request's resolved channel. The session is valid on this channel only. No FK (kernel table, as `return_cases.sales_channel_id`). |
| `email` | `varchar(254)` | no | | As typed, trimmed. Deleted with the row after 7 days (FR-026). |
| `email_hash` | `char(64)` | no | | SHA-256 hex of the lower-cased address: per-address throttle and supersession (R-3, R-8). |
| `language` | `varchar(16)` | no | | Request language, kept for the storefront's copy. E-mails use the channel language (R-7). |
| `link_expires_at` | `timestamptz` | no | | `created_at + 60 min`. Set to `now` when superseded by a newer request (FR-022). |
| `redeemed_at` | `timestamptz` | yes | | One-time: set once, never reset. |
| `session_token_hash` | `char(64)` | yes | | SHA-256 hex of the session token. Only the hash is stored (R-4). |
| `session_expires_at` | `timestamptz` | yes | | `redeemed_at + 24 h`. |
| `ended_at` | `timestamptz` | yes | | The visitor left (FR-023). |
| `created_at` | `timestamptz` | no | `now()` | |

Constraints and indexes:

- `unique ("session_token_hash") where "session_token_hash" is not null`.
- `index ("email_hash", "sales_channel_id", "created_at")`: throttle counts and supersession.
- `index ("created_at")`: the 7-day purge.
- `check ("redeemed_at" is null) = ("session_token_hash" is null)`.

A case keeps `guest_session_id` after the row is purged. Nothing reads the session through the case
afterwards: idempotency only matters while the session lives.

## 5. Settings (manifest `returns` group)

| Code | `valueType` | Default | Scope | Notes |
| --- | --- | --- | --- | --- |
| `returns.guest_complaints_enabled` | `boolean` | `false` | global + sales channel | Effective only with `returns.off_platform_complaints_enabled` on the same channel (G7, R-12). |
| `returns.guest_data_retention_days` | `number` | `90` | read globally | Clamped to 30–3 650 when read (R-9). The description states the range. |

## 6. State and lifecycle

**Verification / session** (`return_guest_verifications`):

```
requested ──(60 min | superseded)──► link expired
    │
    └─(POST redeem, once)──► session live ──(24 h | leave)──► session ended
                                   all rows deleted 7 days after created_at
```

**Guest case**:

```
filed (tracking_version = 1, link valid)
  ├─ operator reissues link ──► tracking_version + 1 (old link refused)
  ├─ operator erases (any status) ──► personal_data_erased_at set; link refused; no further e-mail
  └─ enters terminal status ──► closed_at set; page read-only
        ├─ closed_at + 90 d ──► link refused
        └─ closed_at + retention ──► maintenance erases (as above)
```

**Pending guest upload**: `guest_session_id` set, `expires_at = +24 h` → claimed by
`return_case.create` (`return_case_id` set, `expires_at` null), or deleted by 180's expiry sweep.

## 7. Migration *returns: guest complaints*: order of statements

1. `return_cases`:
   - `alter column "customer_account_id" drop not null`;
   - add `guest_session_id`, `contact_verified_at`, `tracking_version`;
   - add the three checks and the three indexes of §1.
2. `return_case_comments`: add `author_guest` and its check.
3. `return_case_attachments`: add `guest_session_id`, `uploaded_by_guest`, the owner check and the index.
4. `create table "return_guest_verifications"` with §4's constraints.

`down` raises when a guest case exists (`customer_account_id is null`), because the column cannot
become `not null` again without deleting cases. Otherwise it drops everything above in reverse
order. The migration references no other module's table.
