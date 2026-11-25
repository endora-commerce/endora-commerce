# Data model: Merging duplicate Organizations and duplicate Projects

The schema is described idiom-neutrally: entity work lands after #1866 (MikroORM 7.2.11, D-293.4).
Every migration is scaffolded with `pnpm --filter backend run migration:new` and owned by the module
or platform that owns the table (`specs/conventions/module-migrations.md`). No number is assigned
here.

## 1. Platform (`packages/platform/src/kernel/merge/`, one cross-cutting migration)

### 1.1 `record_merges`: one merge

`@RuleScoped`. It is read only through the host's routes, under the host's reach rule (R-15).

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | the merge id, carried in every audit entry of the merge |
| `host_type` | text | `organization` \| `project` (closed enum in `packages/contracts/src/record-merge.ts`) |
| `survivor_id` | uuid | held by value |
| `loser_id` | uuid | held by value; `<> survivor_id` (CHECK) |
| `state` | text | `running` \| `needs_attention` \| `completed` \| `cancelled` |
| `field_choices` | jsonb | `{ [fieldCode]: 'survivor' \| 'loser' }`, validated by the host's schema |
| `custom_field_choices` | jsonb | `{ [customFieldKey]: 'survivor' \| 'loser' }` |
| `host_context` | jsonb | host-written data for participants, for example the Organization role map `{ [loserRoleId]: survivorRoleId }`; schema owned by the host contract |
| `actor_kind` / `actor_admin_user_id` | text / uuid null | the ambient actor at start (D-293.6) |
| `source` | text null | D-293.6 source code |
| `started_at`, `completed_at`, `cancelled_at`, `needs_attention_at` | timestamptz | — |
| `finalized_at` | timestamptz null | set by the runner once the host's finalize committed, so a resumed merge never calls finalize twice (the host's finalize is idempotent besides) |
| `last_error_code` | text null | code only, with no values (audit-state discipline) |
| `version` | int | optimistic concurrency on resume and cancel |

Indexes:

- `(host_type, survivor_id)`;
- `(host_type, loser_id)`;
- partial `(state) where state in ('running','needs_attention')`.

### 1.2 `record_merge_steps`: one participant's part

| Column | Type | Rules |
| --- | --- | --- |
| `merge_id` | uuid FK → `record_merges.id` | — |
| `module_id` | text | the participant's module |
| `participation_key` | text | the participant's declared key (a module may declare several) |
| `phase` | text | the host's phase enum (R-11) |
| `state` | text | `pending` \| `running` \| `done` \| `failed` \| `deferred` |
| `trailing` | boolean | true for steps that may finish after finalize (R-16) |
| `moved_count` | bigint | total over batches |
| `batch_count` | int | — |
| `attempts` | int | retries of the current batch |
| `deferred_reason` | text null | `module_off` \| `module_unavailable` |
| `last_error_code` / `last_error_message` | text null | the message is redacted, with no record values |
| `started_at`, `finished_at` | timestamptz null | — |

PK `(merge_id, module_id, participation_key)`. Partial index `(module_id) where state = 'deferred'`
for the catch-up sweep (R-10).

### 1.3 `record_merge_locks`: one running merge per record

| Column | Type | Rules |
| --- | --- | --- |
| `host_type` | text | — |
| `record_id` | uuid | survivor or loser |
| `merge_id` | uuid FK | — |

PK `(host_type, record_id)`. Rows for both ids are inserted in the start Command and deleted at
completion or cancel. A conflicting insert is `409 RECORD_MERGE_ALREADY_RUNNING`. This is what makes
two racing starts safe.

### 1.4 Audit entry index

A partial expression index on `audit_log_entries ((state_after->>'mergeId')) where state_after ? 'mergeId'`
supports the merge history drill-down (R-12). No column is added.

### 1.5 In-process state (not persisted)

- **The frozen set**: ids of losers in `running` / `needs_attention` merges, per host type.
- **The archived set**: ids of losers of completed merges.

Both are loaded at boot, refreshed on the `b2b:record-merge:changed` Redis channel, and reloaded
every 5 minutes (R-6).

### 1.6 State machine

```text
           start (locks, freeze)
                 │
                 ▼
            ┌─ running ──── batch fails, retries exhausted ──► needs_attention
            │    │  ▲                                              │
  cancel    │    │  └────────────── resume ────────────────────────┘
 (only while│    │
  all steps │    ▼  every non-trailing step done|deferred, finalize re-count = 0, finalize commits
  pending)  │  completed  (trailing / deferred steps may still run later, under the same merge id)
            ▼
        cancelled (locks released, freeze lifted)
```

## 2. `organizations` (module migration)

### 2.1 `organizations`: new columns

| Column | Type | Rules |
| --- | --- | --- |
| `merged_into_organization_id` | uuid null FK → `organizations.id` | set by `organization.merge.finalize` only |
| `merged_at` | timestamptz null | — |
| `merge_id` | uuid null | — |

Constraints:

- `merged_into_organization_id is null or deleted_at is not null`. An archived loser is always
  soft-deleted (R-7).
- The 177 "company Organization stores a tax ID" constraint is relaxed to
  `is_personal or tax_id is not null or merged_into_organization_id is not null`. This lets a merged
  loser release its tax ID under `global` (R-14a).
- The tax-ID uniqueness rules of 177 are unchanged and still count soft-deleted rows.

Index `(merged_into_organization_id)` serves "merged from" on the survivor.

### 2.2 Records owned by `organizations` that a merge changes

| Table | Effect |
| --- | --- |
| `organizations` (children) | `parent_id` / `path` through `organization.move` per child (structure) |
| `organization_roles` | the loser's custom roles: matched by name to the survivor's roles, or copied. The role map goes into `record_merges.host_context` |
| `organization_invitations` | pending invitations: `organization_id` re-pointed, `organization_role_id` mapped |
| `organization_sales_rep_assignments` | union |
| `organization_payment_methods`, `organization_delivery_methods`, `organization_warehouses` | survivor wins (the loser's rows stay on the archived loser) |
| `organization_tax_id_validations` | kept. The latest outcome is copied onto the survivor when its tax ID is chosen |
| `organization_join_requests` (if 191 WP-2 is on `master`) | pending requests whose target or placement is the loser: re-pointed to the survivor |

## 3. `projects` (module migration, MR-G)

| Column on `projects` | Type | Rules |
| --- | --- | --- |
| `merged_into_project_id` | uuid null FK → `projects.id` | set by `projects.project.merge.finalize` |
| `merged_at` | timestamptz null | — |
| `merge_id` | uuid null | — |

Every list, count, search and read-port query adds `merged_into_project_id is null`, except
`findById`, which returns the archived record with its pointer. Projects keep their `state` (they
have no soft delete). A merged project is read-only through the guard on its own routes and port.

## 4. Participants: no schema change

Every participant moves its rows with the columns it already has (R-3). There is no new column in
any participant table.

## 5. Contract types (`packages/contracts/src/record-merge.ts`, summary)

```ts
export const RECORD_MERGE_HOST_TYPES = ['organization', 'project'] as const;
export const ORGANIZATION_MERGE_PHASES = ['structure', 'configuration', 'addresses', 'members', 'records', 'finalize'] as const;
export const PROJECT_MERGE_PHASES = ['structure', 'records', 'finalize'] as const;
export const RECORD_MERGE_STATES = ['running', 'needs_attention', 'completed', 'cancelled'] as const;
export const RECORD_MERGE_STEP_STATES = ['pending', 'running', 'done', 'failed', 'deferred'] as const;
export const MERGE_DISPOSITIONS = ['re_point', 'union', 'survivor_wins', 'survivor_wins_fill_gaps', 'sum', 'stricter', 'kept'] as const;
```

The full shapes are in `contracts/merge-mechanism.md` and `contracts/merge-participant.md`.

## 6. Error codes (all in `packages/contracts`, en + pl translations)

| Code | HTTP | When |
| --- | --- | --- |
| `RECORD_MERGE_SAME_RECORD` | 422 | survivor = loser |
| `RECORD_MERGE_RECORD_UNAVAILABLE` | 409 | either is deleted or already merged, or the survivor is rejected |
| `RECORD_MERGE_ALREADY_RUNNING` | 409 | a lock exists for either id |
| `RECORD_MERGE_PARTICIPATION_INCOMPLETE` | 409 | a present module holds an undeclared reference (R-9); `details.modules` |
| `RECORD_MERGE_PARTICIPANT_CONFLICT` | 409 | a participant reports a conflict with `resolution: 'unresolvable'` (`MERGE_CONFLICT_UNRESOLVABLE`); `details.module`, `details.conflict` |
| `RECORD_MERGE_BUSY` | 409 (retryable) | in-flight placement or payment (R-20). Added to `ERROR_CODES` with the `orders` participant that raises it (T058), not before: `check:error-translations` refuses a declared code nothing raises |
| `RECORD_MERGE_IN_PROGRESS` | 409 | a write naming a frozen record |
| `RECORD_MERGE_NOT_CANCELLABLE` | 409 | a participant step has committed |
| `RECORD_MERGE_NOT_RESUMABLE` | 409 | the state is not `needs_attention` |
| `RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED` | 422 | the start body lacks the irreversible acknowledgement |
| `RECORD_MERGE_RESIDUE` | — (recorded on the merge) | finalize's re-count still found rows naming the loser after three sweeps (`merge-mechanism.md` §3) |
| `ORGANIZATION_MERGE_PERSONAL` | 409 | either is personal (D-299) |
| `ORGANIZATION_MERGE_TREE_INVALID` | 409 | token `ancestor` \| `different_trees` (D-299) |
| `ORGANIZATION_MERGED` | 409 | a write naming an archived Organization; `details.survivorId` |
| `PROJECT_MERGED` | 409 | a write naming an archived Project; `details.survivorId` |

Reach failures answer the platform's `404 NOT_FOUND`, indistinguishable from absence.
