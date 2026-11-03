# Data model: Organization roles and permissions

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Decisions**: [research.md](./research.md)

Tables are named as they will be in PostgreSQL; entity classes as they will be in MikroORM. No
migration number is assigned anywhere (`specs/conventions/module-migrations.md`); the steps M1–M5
are research R-19's.

## 1. `organization_roles` — new, owned by `organizations`

Entity `OrganizationRole`, `packages/modules/organizations/src/backend/entities/organization-role.entity.ts`.
Tenancy classification: **organization-scoped** (`organization_id`), through the global filter
guard (Principle XI); a request naming another Organization's role id finds nothing (FR-005).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | PK |
| `organization_id` | `uuid` | no | FK → `organizations(id)` `on delete cascade` |
| `kind` | `text` | no | `check (kind in ('administrator','member','custom'))` |
| `name` | `varchar(80)` | yes | `null` for `administrator` / `member` (their label is an i18n key, FR-003); required for `custom` — `check ((kind = 'custom') = (name is not null))` |
| `name_normalized` | `varchar(80)` | yes | `lower(btrim(name))`, written by the Command, never by a client |
| `description` | `varchar(500)` | yes | custom roles only |
| `permissions` | `text[]` | no | default `'{}'`; granted codes, sorted, unique. Always `'{}'` for `administrator` (wildcard, R-3) |
| `member_defaults_offered` | `text[]` | no | default `'{}'`; the per-*Member* first-seen ledger (R-17): member-default codes this *Member* has been offered. Unused for `administrator` and `custom` |
| `version` | `integer` | no | default `1`; optimistic concurrency (R-29) |
| `created_at`, `updated_at` | `timestamptz` | no | |

Constraints and indexes:

- `unique (organization_id, id)` — the target of the composite foreign keys below (FR-005 held
  by the database, not only by the filter).
- `unique (organization_id) where kind = 'administrator'` and `unique (organization_id) where
  kind = 'member'` — exactly one of each (FR-001).
- `unique (organization_id, name_normalized) where kind = 'custom'` — FR-004 uniqueness; the
  Command additionally refuses the predefined labels (R-29).
- At most 50 `custom` rows per Organization — enforced by the create Command (FR-004), not by the
  database.

Invariants the Commands hold:

- `administrator` and `member` rows are created by the `after insert on organizations` trigger
  (R-28) for every new Organization and by M2 for every existing one; neither is ever deleted or
  renamed; the `administrator` row is never updated.
- *Member*'s effective set is `(permissions ∪ (vocabularyMemberDefaults ∖ member_defaults_offered))
  ∩ present` (R-17); a save sets `member_defaults_offered ∪= vocabularyMemberDefaults`.
- On every save, `permissions` = (submitted ∩ **present** codes) ∪ (previous ∩ vocabulary ∖
  present), where *previous* is the stored set — for *Member*, the stored set plus its unoffered
  defaults — a grant of a switched-off module's code survives untouched (FR-025, US 8); a code no
  longer in the vocabulary is dropped (spec *Edge Cases*). Submitted codes outside the vocabulary
  are refused `422 ORGANIZATION_PERMISSION_UNKNOWN`.
- A save whose resulting `name`, `description` and `permissions` equal the stored ones is
  `skipAudit` and does not bump `version` (FR-065).

### State of a role

```
custom:        created ──(update)*──▶ deleted (with replacement when held, FR-024)
member:        created by seeder/M2 ──(update permissions)*        never deleted
administrator: created by seeder/M2                                 never changed
```

## 2. `customer_accounts.organization_role_id` — new column, owned by `customer_accounts`

Entity property `CustomerAccount.organizationRoleId` replaces `role`
(`packages/modules/customer_accounts/src/backend/entities/customer-account.entity.ts:100`).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `organization_role_id` | `uuid` | no | composite FK `(organization_id, organization_role_id)` → `organization_roles (organization_id, id)`, `on delete restrict`; index `(organization_id, organization_role_id)` |

- The FK into `organizations`' table is legal because `customer_accounts` already depends on
  `organizations` (`test/unit/db/fk-dependency-drift.test.ts` stays green without a manifest change).
- `on delete restrict` is what makes FR-024 structural: a role cannot be deleted while an account
  — deleted and blocked ones included — still references it. The delete Command reassigns first.
- Moving an account to another Organization (`customers`' org assignment, detach to a personal
  Organization) sets the role in the same write; the composite FK refuses a role of the old
  Organization.
- **Default.** A `before insert` trigger (M3, R-28) fills a missing `organization_role_id` with the
  Organization's role of kind `administrator` when `new.role = 'organization_admin'`, else `member`;
  M5 redefines it to `member` only. Production writes always pass the id; the write port's input
  requires it.
- `role` (`varchar(32)`, indexed) is kept, `@deprecated`, until WP-12's M5 drops it; between WP-02b
  and WP-12 every assignment dual-writes both (R-23).

## 3. `organization_invitations.organization_role_id` — new column, owned by `organizations`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `organization_role_id` | `uuid` | no | composite FK `(organization_id, organization_role_id)` → `organization_roles (organization_id, id)`, `on delete restrict` |

Every invitation — pending, expired, revoked, accepted (FR-070) — is backfilled by M2. Accepting an
invitation creates the account with that role id. Deleting a role moves pending invitations to the
replacement in the same Command (FR-024); expired and accepted ones are moved too, because the FK
does not distinguish them. `role` is dropped by M4.

## 4. `audit_log_entries.actor_customer_account_id` — new column, owned by the platform

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `actor_customer_account_id` | `uuid` | yes | the customer who acted for themselves (R-21); `null` for operator, system, API-key and impersonation actors (the last keep `actor_admin_user_id` + `impersonated_customer_account_id`) |

## 5. Columns removed (WP-12)

| Table | Column | Step | Read last by |
| --- | --- | --- | --- |
| `organizations` | `requires_cart_approval` | M4 | M2 (FR-071), then nothing |
| `organization_invitations` | `role` | M4 | nothing after WP-03 |
| `customer_accounts` | `role` (+ index) | M5 | nothing after Wave 2 |

## 6. Organization permission — a declaration, not a row

Declared in a module's `manifest.ts` under the new optional field `organizationPermissions`
([`contracts/organization-permissions-manifest.md`](./contracts/organization-permissions-manifest.md)):

| Field | Type | Rule |
| --- | --- | --- |
| `code` | `string` | `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`; the segment before the dot **is the declaring module's id** (R-2) |
| `label` | `string` (1–160) | English fallback |
| `description` | `string` (1–500) | English fallback, one sentence |
| `memberDefault` | `boolean` | FR-021 |

Translations live in the declaring module's `i18n/{en,pl}.json` under
`organizationPermissions.<code>.label` and `organizationPermissions.<code>.description`.

Derived sets (all computed in memory from the composed manifests, never stored):

- **Vocabulary** — every code declared by a composed module, present or not.
- **Present** — codes whose declaring module is effectively present (both axes,
  `effectiveState.isPresent`).
- **Effective permissions of a subject** — `administrator` kind: every present code; `member`:
  R-17's formula; `custom`: the role's `permissions` ∩ present.

### The codes this feature declares

| Code | Owner | Phase | Member-default | Gates |
| --- | --- | --- | --- | --- |
| `carts.create` | `carts` | P2 | yes | cart mutations and builders (FR-030) |
| `carts.approve` | `carts` | P2 | no | org carts list/read/approve/reject (FR-032, FR-033) |
| `carts.order_without_approval` | `carts` | P2 | yes, except FR-071 | approval requirement (FR-031) |
| `quote_requests.create` | `quote_requests` | P2 | yes | every RFQ creation path (FR-040) |
| `shopping_lists.create` | `shopping_lists` | P2 | yes | list writes, save-to-list (FR-047) |
| `shopping_lists.convert` | `shopping_lists` | P2 | yes | list → cart / RFQ (FR-048, with the target's code) |
| `quick_order.one_click` | `quick_order` | P2 | yes, except FR-071 | one-click (FR-050, with `carts.order_without_approval`) |
| `orders.view_organization` | `orders` | P2 | no | colleagues' orders and every action reading one (FR-049) |
| `addresses.manage` | `addresses` | P2 | yes | org address create/update/delete (FR-014a) |
| `quote_requests.approve` | `quote_requests` | **P3** | no | internal RFQ approval and org-wide RFQ visibility (FR-041, FR-043) |
| `quote_requests.send_without_approval` | `quote_requests` | **P3** | yes | bypass of internal approval (FR-042) |

### Reserved administrator capabilities — not codes

Member and invitation management, role management, the MFA policy, Organization-scoped one-click
defaults (FR-010–FR-012), and — until P3 — Organization-wide RFQ visibility (R-30). Each is asked as
`organizationPermissionPort.isAdministrator(subject)`.

## 7. Events emitted on commit

| Event | Emitted by | Payload | Consumers |
| --- | --- | --- | --- |
| `organization_role.permissions_changed.v1` | `organization_role.update` | `{ organizationId, roleId, added: string[], removed: string[] }` | `carts` (FR-034), cache drop |
| `customer_account.organization_role_changed.v1` | `customer_account.change_role` (also as a child of `organization_role.delete`) | `{ organizationId, customerAccountId, fromRoleId, toRoleId }` | `carts` (FR-034) |

Both are in-process `EventBus` events, buffered by the Command and dispatched once on commit
(Principle XIII). The cross-process cache drop is the separate Redis publish of R-16.

## 8. P3 additions (outline; detailed in P3's own plan pass)

- `quote_requests.status` gains `'Awaiting internal approval'` (and the published
  `QuoteRequestStatus` union with it). Not in `OPEN_QUOTE_REQUEST_STATUSES` for the seller side; a
  seller-side list, count and read filter excludes it (FR-042).
- `quote_requests` gains `internal_approval_requested_at`, `internal_approved_at`,
  `internal_approved_by_customer_account_id`, `internal_rejected_at`, `internal_rejection_reason`
  (all nullable), and history kinds `internal_approval_requested`, `internal_approved`,
  `internal_rejected` (FR-045).
- Rejection returns the request to the requester's draft-for-resubmission state, which an edit of a
  request awaiting approval also does (FR-044, #649's rule).
