# Data model: Membership moves and join requests

One new table, owned by `organizations`. No column is added to `customer_accounts` (OR-1: no new
account state). Written against MikroORM 7.2.11 as the tree is after #1866 (research R-23).

## 1. `organization_join_requests` (owner: `organizations`)

Entity `OrganizationJoinRequest`, `packages/modules/organizations/src/backend/entities/organization-join-request.entity.ts`,
`@OrgScoped()` on `organization_id` (the **target**; research R-13).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK, generated |
| `organization_id` | uuid | no | the target; FK → `organizations(id)`; tenant anchor |
| `customer_account_id` | uuid | no | the registrant; FK → `customer_accounts(id)` (acknowledged edge, R-23) |
| `state` | varchar(32) | no | `awaiting_email_confirmation` \| `pending` \| `approved` \| `rejected` \| `withdrawn` \| `expired` |
| `origin` | varchar(32) | no | `registration` \| `port` (a server-side `requestToJoin`) |
| `routing` | varchar(32) | yes | `organization_administrators` \| `operator`; set at `submit`, never re-read (R-12) |
| `operator_reason` | varchar(32) | yes | `setting` \| `no_active_administrator` \| `target_not_active`; `null` when routed to the company |
| `requested_tax_id` | varchar(32) | no | the tax ID the registrant entered, normalised (D-290 / OD-11); shown back to them, so no registrant read touches the target row |
| `requested_name` | varchar(255) | yes | the company name the registrant typed; free text; erased on anonymisation |
| `note` | varchar(500) | yes | the registrant's note to the deciders; free text; erased on anonymisation |
| `sales_channel_id` | uuid | yes | the channel registered on (the notices' language and links) |
| `language` | varchar(8) | no | the registrant's language at creation (fallback for notices) |
| `decided_at` | timestamptz | yes | set by approve / reject / withdraw / expire |
| `decided_by_kind` | varchar(16) | yes | `organization_administrator` \| `operator` \| `registrant` \| `system` |
| `decided_by_id` | uuid | yes | the deciding customer account or admin user; `null` for `system` |
| `rejection_reason` | varchar(500) | yes | free text; erased on anonymisation |
| `granted_organization_role_id` | uuid | yes | the role given on approval |
| `submitted_at` | timestamptz | yes | when it became `pending` |
| `expires_at` | timestamptz | no | `created_at + expiry_days` (captured at creation) |
| `version` | integer | no | starts at 1; bumped by every transition (R-14) |
| `created_at` | timestamptz | no | |
| `updated_at` | timestamptz | no | |

Indexes:

- `organization_join_requests_open_per_account_uq` — **unique** `(customer_account_id)`
  `where state in ('awaiting_email_confirmation','pending')` (FR-080; violation →
  `409 ORGANIZATION_JOIN_REQUEST_OPEN`);
- `(organization_id, state, created_at)` — the company list, the operator filter and the daily count;
- `(state, expires_at)` — the expiry sweep;
- `(customer_account_id)` — the registrant's read and the anonymisation erase.

Check constraints: `state` and `routing` / `operator_reason` / `decided_by_kind` in their sets;
`routing is not null` when `state <> 'awaiting_email_confirmation'`; `decided_at is not null` iff
`state in ('approved','rejected','withdrawn','expired')`.

Migration: one, `packages/modules/organizations/src/migrations/<timestamp>_organizations_join_requests.ts`,
scaffolded by `pnpm --filter backend run migration:new` and registered by `composer:generate`.
No backfill. `down` drops the table.

### State transitions

```text
                       submit (e-mail confirmed)
awaiting_email_confirmation ─────────────────────▶ pending ──approve──▶ approved
        │                                             │ ├──reject───▶ rejected
        │ withdraw / expire                           │ ├──withdraw─▶ withdrawn
        ▼                                             │ └──expire───▶ expired
  withdrawn / expired                                 
```

| Command | From | To | Who |
| --- | --- | --- | --- |
| `organization.join_request.create` | — | `awaiting_email_confirmation` (or `pending` when the account's e-mail is already confirmed — the port path) | registration (anonymous), server-side caller |
| `organization.join_request.submit` | `awaiting_email_confirmation` | `pending` | the e-mail confirmation (anonymous, token-bearing) |
| `organization.join_request.approve` | `pending` | `approved` | company administrator (routed to them), operator (any), server-side caller |
| `organization.join_request.reject` | `pending` | `rejected` | same as approve |
| `organization.join_request.withdraw` | either open state | `withdrawn` | the registrant; the system on a move by another path (R-19) |
| `organization.join_request.expire` | either open state | `expired` | the sweep (system) |
| `organization.join_request.erase_texts` | any | unchanged | the system, on `customer_account.anonymized.v1` |

Final states are never left. Every transition locks the row `for update`, checks the state and the
caller's `expectedVersion`, and bumps `version`.

### Validation

- `requested_name` ≤ 255, `note` ≤ 500, `rejection_reason` ≤ 500, trimmed; empty → `null`.
- `granted_organization_role_id` must be a role of `organization_id` (`findRole`), else `404`.
- Approve requires: the target `status = 'active'` and not deleted; the account live, not blocked,
  and `organizationId` = its own personal Organization; else `409 ORGANIZATION_JOIN_REQUEST_NOT_APPROVABLE`
  with `details[0].issue` ∈ `target_not_active` \| `account_unavailable` \| `account_moved`.

## 2. Settings (owner: `organizations`, platform-wide)

| Code | Type | Default | Allowed |
| --- | --- | --- | --- |
| `organizations.registration.conflict_policy` | string | `refuse` | `refuse` \| `join_request` |
| `organizations.join_requests.decided_by` | string | `organization_administrators` | `organization_administrators` \| `operator` |
| `organizations.join_requests.expiry_days` | integer | `14` | 1–90 |
| `organizations.join_requests.daily_limit_per_organization` | integer | `20` | 1–1000 |

None holds a secret. Each has `name` / `description` in the manifest and `settings.<code>.*` labels
in the module bundle (en + pl). The storefront registration options are revalidated when
`conflict_policy` changes (`registrationOptionsRevalidation`).

## 3. Policy point (owner: `organizations`)

`organizations.registrationConflict`, combiner `chain`, fail-closed → `refuse`
(`contracts/registration-conflict-policy.md`). No storage.

## 4. The membership move (owner: `customer_accounts`)

No new storage. The write is the existing pair `customer_accounts.organization_id` +
`organization_role_id` (composite FK to `organization_roles(organization_id, id)`), written in one
statement by `customer_account.organization.change` (`contracts/membership-port.md`).

## 5. Changed existing data paths

| Path | Change |
| --- | --- |
| `PersonalOrganizationService.provisionFor` | unchanged by default; gains optional `status` only if Q1 = B (research R-26) |
| `EmailVerificationService.verify` | no longer sets a **personal** Organization's status; runs `organization.join_request.submit` for the account's open request |
| `email_verification_tokens` | reused for the join path's confirmation (same 48 h TTL) |
| `PreparedCustomerAccountCreate` | gains `customerAccountId` (additive, R-10) |

## 6. Audit allowlists

- `ORGANIZATION_JOIN_REQUEST_AUDIT_KEYS` (`organizations`, beside the snapshot helper in
  `services/organization-audit-state.ts`): `state`, `origin`, `routing`, `operatorReason`,
  `customerAccountId`, `organizationRoleId`, `decidedByKind`, `expiresAt`, `version`,
  `changedFields`, `noteLength`, `hasRejectionReason`.
- `customer_accounts`' move entry: `mode`, `source`, `organizationRoleId` (before/after),
  `changedFields: ['organizationId','organizationRoleId']` — through the existing
  `organizationMoveAuditState` plus `mode` and `source`, added to `CUSTOMER_ACCOUNT_AUDIT_KEYS`.

Never recorded: `note`, `requestedName`, `rejectionReason`, any e-mail or name, the target's id on
a request entry, the Organization ids on a move entry (`specs/conventions/audit-state.md` list 2).
