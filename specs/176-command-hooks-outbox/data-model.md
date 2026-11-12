# Data model: 176 — command hooks and outbox

## 1. `command_outbox` (new, kernel-owned, `@GlobalEntity()`)

Owner: `@endora-commerce/platform` (`--module core`). The migration is scaffolded with
`pnpm --filter backend run migration:new -- --module core --name command_outbox`, and the generated
registry is regenerated and committed in the same change. No number is assigned.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | the `messageId` and idempotency key |
| `sequence` | `bigint generated always as identity` | claim order, keyset pagination |
| `action` | `text not null` | the hookable action |
| `object_type` | `text not null` | |
| `object_id` | `text not null` | |
| `organization_id` | `uuid null` | routing for the restored tenant context. **No FK**: a kernel table cannot reference a module table (D-52) |
| `hook_module` | `text not null` | module id of the handler |
| `hook_id` | `text not null` | |
| `data` | `jsonb not null default '{}'` | the owner's `outboxData`, list-1 values only |
| `actor_kind` | `text not null` | `admin` \| `customer` \| `system` \| `api_key` |
| `actor_admin_user_id` | `uuid null` | recorded causation |
| `impersonated_customer_account_id` | `uuid null` | |
| `actor_customer_account_id` | `uuid null` | |
| `request_id` | `text null` | |
| `status` | `text not null default 'pending'`, check in (`pending`,`in_flight`,`delivered`,`dead`) | |
| `attempts` | `int not null default 0` | |
| `available_at` | `timestamptz not null default now()` | next eligible time |
| `locked_until` | `timestamptz null` | lease while `in_flight` |
| `last_error_code` | `text null` | a code-shaped string, never a message |
| `last_error_class` | `text null` | the error constructor name |
| `created_at` | `timestamptz not null default now()` | = commit time |
| `delivered_at` | `timestamptz null` | |
| `dead_at` | `timestamptz null` | |

Indexes:
- `command_outbox_due_idx on (available_at, sequence) where status = 'pending'`, for the claim;
- `command_outbox_lease_idx on (locked_until) where status = 'in_flight'`, for reclaiming expired
  leases;
- `command_outbox_status_seq_idx on (status, sequence desc)`, for the admin list;
- `command_outbox_hook_module_idx on (hook_module)`, for `--hard` uninstall;
- `command_outbox_delivered_purge_idx on (delivered_at) where status = 'delivered'`, for retention.

**Tenancy (XI).** The table is platform-global, like `audit_log_entries`. It is read only by the
drain (system scope) and by the platform admin API under platform permissions. Its `data` is
limited to list 1 so that this global read discloses nothing tenant-valued (R-15).
`organization_id` is the routing for the restored context, not a filter.

**Kernel-table rules.** `check:module-boundary` R1/R2 do not apply to kernel tables. A `--hard`
uninstall deletes a module's rows through the platform's own orchestrator step, not through the
module's migration.

## 2. No other schema change

- `audit_log_entries`: unchanged. A hook's noted changes go into the existing `state_after` jsonb
  under `extensions.<moduleId>.changedFields`.
- `organizations`, `customer_accounts`: unchanged. P1 changes only the transaction boundary.

## 3. In-memory structures (platform)

- **`CommandHookRegistry`**, one per composition. It holds:
  - `declarations: Map<action, { owner, objectType, phases }>`, built from `hookableActionsFrom(manifests)`;
  - `hooks: Map<action, Map<phase, OrderedHook[]>>`, sealed after `composeModules` returns;
  - `isPresent(moduleId)`, which delegates to `effectiveState`.
  Presence changes reach it through `effectiveState`, which is already kept fresh on
  `b2b:module:state-changed`. The registry holds no cache, so it needs no Redis invalidation.
- **Hook origin ALS**: `{ moduleId, hookId, action, chain: string[] }`. `chain` drives the cycle and
  depth guard (FR-022).

## 4. State transitions (outbox row)

```text
pending --claim--> in_flight --ok--> delivered --7d--> (purged)
   ^                   |  \--error, attempts<10--> pending (backoff)
   |                   |   \--error, attempts=10 or PermanentOutboxFailure--> dead
   |                   \--handler module absent--> pending (attempt restored)
   |                   \--lease expired--> pending
   +--command_outbox.retry (operator)-- dead --90d--> (purged)
```
