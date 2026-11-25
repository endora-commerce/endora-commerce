# Research: Merging duplicate Organizations and duplicate Projects

Decisions, each stated as **decision → rationale → alternatives rejected**. Measured on `master`
`67351db04` unless stated otherwise.

## R-1: Where the merge mechanism lives

**Decision.** The mechanism lives in a platform kernel unit, `packages/platform/src/kernel/merge/`:

- **Hosts** are declared in the owning module's manifest (`merge.hosts`). `organizations` declares
  `organization`, and `projects` declares `project`.
- **Participations** are declared in each holder's manifest (`merge.participates`) and registered
  at composition through `ctx.merge.participate(host, key, participant)`.
- The platform composes them, validates them (R-9), orders them by phase, and runs them (R-2).

**Rationale.**

- There are two hosts in this feature, and the same need will recur (a customer-account merge was
  already raised in the spec's Assumptions).
- The things the mechanism needs are platform things:
  - the effective state of every module, for deferring and catching up (R-10);
  - the composed manifests, for ordering and completeness (R-9);
  - the tenant seams, for the freeze (R-6).
- This is the shape of the other cross-cutting extension points the platform already composes from
  manifests: command hooks (`specs/176-command-hooks-outbox/`) and policy points
  (`specs/188-policy-points/`).

**Alternatives rejected.**

- *A registry port owned by each host* (`organizationMergeParticipantRegistry`,
  `projectMergeParticipantRegistry`). This builds the same runner, state tables and activation
  catch-up twice. `crm` and `tasks` would register into two registries, and the completeness
  check would need to know both.
- *Rung 1: participants subscribe to `organization.merged.v1` and re-point on their own.* It gives
  no preview, no ordering (members before records), no progress, no completeness, and no way to
  know when the merge is done. A failed subscriber leaves records stranded silently.
- *Using a policy point.* Policy participants decide and never write (188 FR-005). A merge
  participant's whole job is to write.

## R-2: Execution model (D-299 / OQ-2)

**Decision.** The merge runs as a forward-only, resumable job:

- The runner is one BullMQ queue, `platform.record-merge`, with one job per merge.
- The job walks the host's phases in order. Within a phase, steps run with bounded parallelism
  (default 4).
- A step loops `applyBatch` until it returns `moved: 0`.
- A failed batch is retried with backoff (5 attempts). After that the merge enters `needs_attention`
  with the step, an error code and a redacted message. The loser stays frozen.
- `resume` re-enqueues the job, and done steps are skipped.
- `cancel` is accepted only while every participant step is `pending` (no participant Command has
  committed). It releases the locks and the freeze.

**Rationale.**

- Each owner's Command is its own transaction. 186's convention item 7 says a port call is its own
  Command transaction, so thirty owners cannot commit atomically through ports.
- Idempotent batches make retry and resume exact (R-3).
- BullMQ is the platform's pattern for long or repeatable work (Principle X), and the outbox drain
  worker is the precedent inside the platform.

**Alternatives rejected.**

- *One transaction across all participants*, using child Commands in `beforeCommit` hooks. It locks
  every participant's table for minutes, cannot batch a large loser, couples all modules into one
  failure, and contradicts 186 item 7.
- *A saga with compensations.* The inverse of a union, a sum or a revocation is not computable once
  the survivor has new activity, and an approximate unmerge is worse than none (D-299).

## R-3: Step idempotence

**Decision.** Every batch Command **consumes loser-side state**. It moves, deletes or marks exactly
the rows that still belong to the loser, in the same transaction as the survivor-side write:

| Disposition | What the batch does in one Command |
| --- | --- |
| re-point | `UPDATE … SET <col> = :survivor WHERE <col> = :loser … LIMIT batch` (owner's own SQL or ORM) |
| union | insert the survivor twin with on-conflict-do-nothing, then delete the loser row |
| survivor wins / fill gaps | *fill gaps*: if the survivor has no row, re-point the loser row. Otherwise (and always for plain *survivor wins*) leave the loser row on the archived loser. The step's remaining count excludes rows it has decided to leave, so a re-run is a no-op |
| sum | add the loser counter to the survivor counter and delete the loser counter row |
| stricter | compute the stricter policy, write it on the survivor, and leave the loser's row |
| kept | nothing |

A re-run therefore finds nothing left to move, and never double-counts.

**Rationale.** This needs no per-merge bookkeeping in the participant's tables, and "remaining =
preview count" holds by construction, which the conformance helper asserts.

**Alternative rejected.** A per-row "processed in merge X" ledger in each participant. It adds 29
tables or columns for what a WHERE clause gives for free.

## R-4: Aggregate ports and the participant's Command

**Decision.**

- A participant's batch runs **one Command of its owner**, defined in the owner's
  `src/backend/commands/`.
- For the aggregates of D-293, the same Command is published as a method on the aggregate port.
  The ports are named in `contracts/participant-dispositions.md`.
- The participant calls the Command directly, since it is the owner's own code. The port method is
  how server code outside the module (a deployment, an integration) does the same thing, as D-293.1
  and FR-062 require.

**Rationale.**

- This keeps the user's instruction: each owner re-parents its records through its own Commands,
  exposed on its aggregate port.
- It lets every step be built **before** its port exists, because only the publication waits for
  #1821 – #1829. The usual parity test of the D-293 convention (port against admin route) becomes
  port against participant here, since a re-parent has no admin route of its own.

**Alternatives rejected.**

- *The participant resolves its own aggregate port and calls it.* A module resolving its own port
  is circular and needless.
- *Do not publish re-parent operations on ports at all.* Server code then could not re-point a
  single owner's records, for example to repair a deferred step by hand, and D-293's
  every-operation-on-the-port rule would be broken.

## R-5: Members

**Decision.**

- Members move through 191's `membershipPort.changeOrganization` with a new mode, `merge`. The
  amendment is in `contracts/membership-merge-mode.md`. This mode:
  - is exempt from the last-administrator refusal (the source is being archived, not depleted);
  - takes the role from the merge's role map, which `organizations` writes into the merge context
    during the `structure` phase;
  - records the merge id;
  - publishes 191's `customer_account.organization_changed.v1` with origin `merge`.
- There is one Command per account (191 FR-005: one audit entry per move). The participant batches
  by account count.

**Rationale.** 191 is the owner's one move operation (D-298). A second member-move path would split
the audit trail and the hooks.

**Alternatives rejected.**

- *Re-point `customer_accounts.organization_id` in a bulk batch.* It bypasses 191's hooks, notice
  and audit.
- *Build on today's operator assign path* (`customerAccountMemberCommandPort`). 191 FR-011 routes
  it through the membership Command anyway, and building on it would be rework.

**Consequence.** MR-E is blocked by #1831.

## R-6: Freezing the loser

**Decision.** A start inserts `record_merge_locks` rows for both ids and adds the loser to the
**frozen set**. The set is held in process and refreshed by Redis pub/sub on
`b2b:record-merge:changed`, following the lifecycle cache pattern of `registry-cache.ts`. A
5-minute TTL reload means a lost message makes the set stale and never empty-by-error. The set is
enforced at three seams, and nowhere per module:

1. **Tenant context resolution** (`packages/platform/src/tenancy/resolve-tenant-context.ts`). A
   customer or bound API-key request whose Organization is frozen is answered
   `409 RECORD_MERGE_IN_PROGRESS` for writes. Reads pass.
2. **The org write guard** (`packages/platform/src/tenancy/org-write-guard.ts`). A create or
   update of an `@OrgScoped` row carrying a frozen Organization is refused, unless the ambient
   scope is the merge's own system scope (`record-merge:<mergeId>`).
3. **The host's own admin routes** on the loser (edit, status, members) refuse.

**Finalize** then asks every present participant's preview for its remaining count again. Any
non-zero count re-queues that step before the archive commits, which sweeps rows a seam did not
catch (for example a `@RuleScoped` table written on an admin path).

**Rationale.** Three seams cover every buyer and integration write and most admin writes with no
edit to thirty modules. The finalize sweep closes the remainder.

**Alternatives rejected.**

- *A check in every participant's write paths.* That is thirty edits, and the next one forgotten.
- *Database triggers on foreign tables.* These write another module's schema, which Principle I
  and `check:module-boundary` forbid.
- *Blocking the loser's members by status.* Moderation status means something else to buyers and
  notices, and the members are moved anyway.

## R-7: The archived loser

**Decision.**

- **Organization:** set `deleted_at`, plus three new columns, `merged_into_organization_id`,
  `merged_at` and `merge_id`. A CHECK requires `merged_into … is null or deleted_at is not null`.
  The 177 rule "a company Organization stores a tax ID" is relaxed for merged rows, so that a tax
  ID can be released under `global` (data-model).
- **Project:** the same three columns. Projects have no soft delete, and `delete` cascades
  (`project-service.ts:679`), so every project list and read filters on
  `merged_into_project_id is null`.

**Rationale.** Soft delete already removes an Organization from every list, picker, tenant
resolution and count, so the pointer adds meaning without a new exclusion everywhere. The pointer
shape copies the address-book retirement precedent (`customer_address.merged_into_address_id`).

**Alternatives rejected.**

- *A new `OrganizationStatus` value, `merged`.* Every status reader (notices, moderation, storefront
  sign-in, reports) would have to learn it, and the status is moderation, not identity.
- *Hard-deleting the loser.* Every `kept` row and every external id would dangle.

## R-8: Old ids after the merge (OQ-6 assumption)

**Decision.**

- **Reads.** `organizationDetailsPort.findById` returns the archived record with `mergedInto`. A
  new `resolveMerged(id)` returns the survivor id or the id itself. Admin routes for the loser
  answer the archived record, and the SPA leads to the survivor.
- **Writes.** Writes refuse with `409 ORGANIZATION_MERGED`, with `details.survivorId`. This is
  enforced by the guard (archived Organizations join the frozen set permanently, held as a separate
  "archived" set) and by the host routes.
- **Storefront.** A session of an archived Organization cannot exist, because members were moved.
- **Projects.** The same applies, with `PROJECT_MERGED`.

**Rationale.** A silent redirect hides a stale integration mapping for ever.

**Alternative rejected.** Transparent write redirect (OQ-6 B). This is still open to the owner and
would change only the guard's answer.

## R-9: Completeness, one analysis on two hosts

**Decision.** The **population** is every persisted entity property, in modules and installed
packages, that:

- is named `organizationId`, `*OrganizationId`, `organizationIds` or `*OrganizationIds`, or
  `projectId` / `*ProjectId` outside `projects`; or
- is declared as a polymorphic reference in a participation (`scope = 'organization'`,
  `contextType = 'project'`, `targetType = 'project'`).

Each must be covered by exactly one participation reference of its own module, with a
disposition. The analysis runs in two places:

- **`check:merge-participation`** (static; `backend/scripts/check-merge-participation.ts`, reading
  sources and installed packages the way `check-entity-tenant-classification.ts` does). It fails on:
  - an uncovered property;
  - a declaration naming a property that does not exist;
  - a participation registered at runtime without a declaration, or declared without registration
    (the latter caught by a composition test);
  - a stale pending-ledger entry.
- **Boot** (runtime twin in `kernel/merge/completeness.ts`, over MikroORM metadata). It computes
  the uncovered set per module. A merge start is refused with
  `409 RECORD_MERGE_PARTICIPATION_INCOMPLETE` naming the modules, but only for modules effectively
  present. The preview shows them.

The ledger `backend/scripts/ledgers/merge-participation-pending.ts` is seeded in MR-A with every
holder of the spec's inventory and shrinks to empty by MR-E. It may never grow
(`check-estate.md` ratchet).

**Rationale.** Without completeness the merge strands records the day a module adds a column. The
runtime twin is what makes partial delivery safe (plan: what ships early).

**Alternatives rejected.**

- *A hand-written list of holders in `organizations`.* This breaks Principle I, and lists go
  stale (D-100).
- *Database foreign keys as the population.* Most references are held by value across modules,
  with no foreign key (Principle I).

## R-10: Modules that are off (D-299 / OQ-4)

**Decision.**

- When the runner reaches a step whose module is not effectively present, it records the step as
  `deferred` (reason `module_off`) and moves on. The preview omits that participant entirely.
- The merge completes with deferred steps.
- Catch-up runs on two paths:
  - (a) the runner subscribes to `b2b:module:state-changed` and enqueues a catch-up job for the
    merges with deferred steps of a module that became present;
  - (b) a repeatable sweep (every 15 minutes) does the same, in case pub/sub was missed.
- A catch-up runs the step under the original merge id and scope. Finalize-only effects (the event)
  are not repeated.
- A deferred step whose module is later hard-uninstalled stays `deferred` (its tables are gone).

**Rationale.** Principle XVII says off behaves as never installed (do not call it, do not show it)
and reactivation restores data with no manual repair.

**Alternatives rejected.**

- *Refusing the merge while a participant is off.* It reveals an off module and lets it block an
  unrelated operation.
- *`organizations` re-pointing the off module's rows.* That breaks Principle I.

## R-11: Phases

**Decision.** Phases are a closed, ordered enum per host type, declared by the host. The host's own
steps are fixed at `structure` and `finalize`.

- **Organization:**
  1. `structure`: host children, roles and role map, invitations, sales reps; kernel channels.
  2. `configuration`: per-Organization settings in other modules.
  3. `addresses`.
  4. `members`.
  5. `records`.
  6. `finalize`: host only (field values, tax ID, archive, event, search).
- **Project:**
  1. `structure`: Organizations, members, viewers.
  2. `records`.
  3. `finalize`.

**Rationale.**

- Members need the role map and addresses before they act in the survivor.
- Configuration before records means repriced carts see the survivor's audiences.
- Finalize must be last so that the archive happens only when nothing references the loser.

**Alternative rejected.** Dependency edges between participants. These would make
`organizations` or the platform aware of participant names, and the five-phase order covers every
case in the inventory.

## R-12: Audit

**Decision.**

- **Host Commands:**
  - `organization.merge.start` (hookable);
  - `organization.merge.cancel`, `organization.merge.resume` and `organization.merge.finalize`;
  - for projects, `projects.project.merge.*`.
- **Participant batch Commands** are named `<owner action prefix>.merge_reassign`, for example
  `order.merge_reassign`. Their `objectType` is the host type and their `objectId` is the survivor.
  `stateAfter` holds `{ mergeId, loserId, moved, ids }`, with ids capped at the batch size. This is
  ids and codes only, per `specs/conventions/audit-state.md`.
- Every merge Command is `reversible: false`.
- A platform migration adds a partial expression index on `(state_after->>'mergeId')` so that the
  history drill-down lists a merge's entries.
- `source` follows D-293.6.

**Rationale.** The same `stateAfter` convention as 186's `source`. There is no new audit column.

**Alternative rejected.** A generic `correlation_id` audit column. That is a wider platform
decision than this feature needs, and the index gives the read.

## R-13: Events and webhooks

**Decision.**

- Exactly one event per completed merge: `organization.merged.v1` or `project.merged.v1`, carrying
  `{ organizationId: survivorId, mergedOrganizationId, mergeId }` (Projects use the same shape with
  project ids). It is dispatched by the finalize Command on commit.
- It is added to the webhook event registry as `ORGANIZATION_WEBHOOK_EVENT_TYPES`, the first
  Organization webhook type, so delivery to Organization-bound subscriptions follows the survivor.
- **No per-record events.** Batch Commands declare no `event`.
- `needs_attention` raises an admin notification through `admin_notifications`, a non-binding
  dependency that degrades to none.

**Rationale.** Re-emitting `order.updated` for 10 000 orders would flood webhooks with changes that
are not business changes.

**Alternative rejected.** Per-record events, flagged `origin: merge`. Every consumer would have to
learn to ignore them.

## R-14: Field choice and custom fields

**Decision.**

- The preview returns the differing fields and custom-field keys. The start body carries
  `fieldChoices` and `customFieldChoices`, each a map from code to `'survivor' | 'loser'`, stored
  on the merge record.
- Finalize applies them as child Commands of `organization.merge.finalize`: `organization.update`,
  `organization.set_custom_field_values` (merge callback, `custom-field-writes.md`) and the tax-ID
  take-over (R-14a).
- Custom-field values are validated at start, against current definitions, and again at finalize.

**R-14a, the tax ID under `global`.** In one Command, set the loser's `tax_id` to null (allowed for
merged rows by the relaxed CHECK), then set the survivor's, and copy the loser's latest validation
outcome. **As implemented (stage 1):** the loser releases its tax ID whenever the survivor takes it,
under both scopes — under `per-tree-root` two merged *roots* are two trees, and the archived loser
keeping the tax ID would hold it in a second tree. The loser keeps its own tax ID when the survivor
keeps its own. The earlier sentence follows, superseded: Under `per-tree-root`, if the loser's tax ID is the tree's, the loser keeps it, because
both are in one tree after the structure phase.

**Alternative rejected.** Applying values at start. The survivor would change before the records
move, and a cancel would then need to undo it.

## R-15: Who may merge

**Decision.**

- New permissions `organizations:merge` and `projects:merge`, registered in the admin permission
  manifest and not granted to the predefined sales-representative role.
- Organization merge also requires `SalesRepAssignmentPort.canSeeOrganization` for both
  Organizations. This is the one reach rule (175), and an unreachable one answers `404`.
- Project merge also requires project visibility and edit on both.
- The merge tables are `@RuleScoped`. They are read only through the host's routes, which apply
  the same rule.

**Alternative rejected.** Reusing `organizations:write`. A merge is irreversible and deserves its
own grant.

## R-16: Batching and performance

**Decision.**

- The default batch is 500 rows, and a participant may lower it (`members`: 50, one Command per
  account).
- Parallelism within a phase is 4.
- `analytics` declares itself `trailing: true`: it runs after finalize and does not block
  completion, and the merge shows *completed, trailing step running*.
- Batches are short transactions, so no lock outlives a batch (SC-002 ≤ 5 s).

**Rationale.** Analytics volume can be orders of magnitude larger than every other table together.

## R-17: Search and caches

**Decision.**

- Each participant refreshes what it owns after each batch: reindex the moved ids, and invalidate
  caches keyed by either Organization through its existing lifecycle pub/sub invalidation (for
  example `price_lists`' price cache for both ids).
- The host removes the loser from `admin_search` and the Organization index at finalize, and
  reindexes the survivor.

**Alternative rejected.** One full reindex at the end. It is too slow, and wrong for owners whose
documents carry Organization facets.

## R-18: Project merge specifics

**Decision.**

- **Survivor's workflow.** The survivor's stages stay. The loser's stages, stage entries, moves,
  value changes, stage tasks and alert deliveries stay on the archived loser.
- **Tasks.** Tasks in the loser's context move through `taskCommandPort.moveContext` (new, #1829),
  with `contextGroupId` cleared.
- **Comments.** Comments move in order. Read state is carried by writing a read marker for each
  member who had read the loser up to its baseline.
- **Links.** A record stays in one project.
- **References.** Rows in `tasks`, `crm` and `projects` that target the loser are re-pointed by
  their owners.
- **Mention tokens.** These are not rewritten. The reference renderer resolves them through
  `projectReadPort.resolveMerged`.

**Alternative rejected.** Merging stages by name. Workflows differ per template, and a wrong
match corrupts stage history.

## R-19: Personal Organizations and tree rules (D-299)

**Decision.**

- **Personal Organizations:** refused, with `ORGANIZATION_MERGE_PERSONAL`.
- **Tree pairs:** allowed when both are roots, or when they have the same root (from `path`).
  Refused when the loser is an ancestor of the survivor (`path` prefix), or when they are non-roots
  of different trees. The code is `ORGANIZATION_MERGE_TREE_INVALID`, with token `ancestor` or
  `different_trees`.
- **Children:** each child moves through the existing `organization.move` Command as a child
  Command, so 177's tree rules run unchanged.

## R-20: In-flight business (OQ-7 assumption)

**Decision.**

- **Refuse, retryable:** the `orders` participant's preview refuses with
  `RECORD_MERGE_BUSY` (409, retryable) while the loser has an `order_placement_intent` that is not
  settled, or a payment in a pending provider state.
  **As implemented (T058):** *a payment in a pending provider state* is read from `orders`' own
  rows (a participant reads no other module's tables): an order of the loser, as buyer or as payer,
  whose payment method snapshot is of kind `gateway`, `awaiting_payment`, placed within the last
  24 hours — an older one is an abandoned attempt whose late settlement still finds the order by
  id. An unsettled intent that appears after the start is left in place, and the step then throws
  `RECORD_MERGE_BUSY`, so the merge waits in *needs attention* instead of archiving it.
- **Move, never refuse:** carts, quotes, returns, payer requests and join requests follow the
  survivor.

## R-21: Dependencies

No new runtime, dev or workspace dependency. The work uses BullMQ, ioredis, Zod and MikroORM, all
present.

## R-22: Delivery split

**Decision.** The split is MR-A to MR-G, as in `plan.md`.

**Rationale.**

- The framework and the host land first.
- Participants without aggregate ports are independent and parallel.
- Aggregate-owner participants build their step now and publish the port method later.
- Members wait for #1831.
- Project merge waits for #1828 and #1829.
- The runtime completeness twin makes every intermediate state safe: the preview works, and the
  start opens itself only when coverage is complete.

**Alternative rejected.** One big MR. It would be blocked by the slowest of nine issues, and
unreviewable.
