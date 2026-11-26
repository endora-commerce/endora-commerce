# Research: Aggregate ports (186)

Every decision is stated as decision → rationale → alternatives rejected. Measurements are from
`origin/master` `ff7efc3e8` (2026-11-23). D-293 (the owner's OD-2 / OD-3 / OD-4 / OD-10 and the
delivery plan) is in `spec.md` and is not re-opened here.

## R-1 Port name and home; `organizationCommandPort` widened in place

**Decision.** Each aggregate's port is `<aggregate>CommandPort`, declared in the owner's existing
`packages/contracts/src/<module>.ts` file beside its read port, with the `Container name:` marker,
registered by the owner with `ctx.di.providePort`. Names: `organizationCommandPort`,
`customerAccountCommandPort`, `orderCommandPort`, `quoteRequestCommandPort`,
`catalogProductCommandPort` (+ `catalogAttributeCommandPort`), `catalogCategoryCommandPort`,
`opportunityCommandPort`, `projectCommandPort`, `taskCommandPort`. `organizationCommandPort` already
exists (`convertToCompany`, `changeTaxId`, `packages/contracts/src/organizations.ts` line 943) and is
**widened in place**, keeping its name and both methods unchanged.

**Rationale.** `check:port-shape` already holds a published port to the marker and the registration;
the owner file is where every consumer already looks. Widening is additive for callers (a caller of
the two existing methods is untouched). The only implementer of a port is its owner (rung 3: a
deployment cannot provide a claimed name), so an added method breaks no supported role. The paid
modules' test doubles implement other ports (`CatalogProductScopeWritePort`, in full), never
`OrganizationCommandPort` — which is why the catalogue ports are superseded by new ports rather than
widened.

**Rejected.** *A new name (`organizationAggregatePort`) and deprecating `organizationCommandPort`* —
churns the one port that already has the right shape, for a naming symmetry nobody asked for.
*Ports on each module's `./ports` subpath* — D-171 permits it, but every aggregate's read port and
records are in `@endora-commerce/contracts`, and splitting one aggregate's surface across two packages
is the thing this feature removes.

## R-2 Command readiness — what is a Command today, and the conversions it implies

**Decision.** A port operation exists only over a Command. Where the admin path is not a Command, the
feature converts it (FR-003), on both paths, keeping the audit action string. Readiness, measured
(C = Command; H-in = hand audit inside the write's transaction; H-post = hand audit after the commit;
N = no audit; ? = to confirm in T001–T009):

| Aggregate | C | H-in | H-post | N / ? |
| --- | --- | --- | --- | --- |
| Organization | create, update, set_parent, move, delete, set_custom_field_values, convert_to_company, tax_id.change, set_credit_mode | allow_lists_replace, allow_list_patch (`organization-restriction-service.ts`); sales_rep_assign/unassign (`sales-rep-assignment-service.ts`, measured by T001) | approved, rejected, blocked, unblocked (`organization-moderation-service.ts` `transition`, audit after commit); sales channels (T001: the kernel membership writer, see below) | — |
| CustomerAccount | create, change_role, set_preferred_language, remove_member, promote_organization_admin, set_subtree_rollup, custom_fields.update | block, unblock, soft-delete, restore, group assign, create standalone, anonymise (`customer-account-lifecycle-ports.ts`) | — | update_profile, email_verified (?) |
| Order | custom_fields.update, external_reference.set | status_transition (`order-transition-service.ts`), payment_status_transition (`order-service.ts`) | place_on_behalf (impersonation only) | comments (`order-comment-service.ts`, N); buyer placement (N) |
| QuoteRequest | send_document | create, create_on_behalf, patch_draft, modify, approve, assign, cancel (`rfq-service.ts`, `rfq-admin-service.ts` `#audit`) | — | admin custom-field values (?) |
| Product | create, update, archive, restore, delete, variant create/update/delete, scoped_values.save, scopes.update | — | — | — |
| Category | create, update, delete | — | — | move (?: likely `update` with a parent), inventory thresholds (N here; audited by `inventory`'s caller as `low_stock_threshold.update`) |
| Opportunity | all listed (`crm`: 33 `commandBus.run` sites, 0 hand audits) | — | — | — |
| Project | all listed (`projects`: 38 sites, 0 hand audits) | — | — | archive/restore: no such operation |
| Task | all listed except below | — | — | create many (?) |

**Inventory (T001, Organization, 2026-11-25).** Measured against the table above:
`sales_rep_assign` / `sales_rep_unassign` are **H-in**, not C (`sales-rep-assignment-service.ts`
calls `recordAuditFromContext` on the write's unit of work), so they convert rather than ship as
"port only". The sales-channel `?` resolves to **H-post through the kernel**: the write is
`@endora-commerce/platform`'s `SalesChannelMembershipService.replaceChannelsForEntity`, which commits
its statements, then drops the access cache and records one `sales_channel.membership.changed` entry
per membership through `AuditPort.record` on its own fork — outside any caller's transaction, also
when `organization.create` hands it the Command's `em`. Converting it to
`organization.sales_channels.set` (T028) needs an **owner question**: whether the kernel writer's
per-membership entries stay beside the new one, and the cache drop moving after the commit, both
being changes to `packages/platform` rather than to `organizations`
(`contracts/organization-command-port.md` § *Inventory findings* 1). No operation moves in or out of
FR-020. The other findings (detach, the reject reason, `expectedVersion`, a refusal code) are
interface decisions for T019, listed there.

**Inventory (T003, Order, 2026-11-26).** Measured against the table above
(`contracts/order-command-port.md` § *Inventory findings*): `status_transition` and
`payment_status_transition` are **H-in** as listed; the status entry took its actor from the caller's
`OrderStatusActor`, so as a Command the buyer's own cancellation records `actorCustomerAccountId`
instead of `impersonatedCustomerAccountId` (R-18.2). Comments are **N** for the buyer as well as the
operator; both convert (R-18.4). `custom_fields.update` and `external_reference.set` are C. Placement
(H-post / N) stays out of this change: issue #1887 makes it a Command, and `place` is added then
(R-18.3). One operation moves **out** of the deprecation list, not out of FR-022:
`orderPaymentStatusApplyPort` is the settlement's co-transactional write, not a duplicate of the
operator's `applyPaymentStatus`, and is kept (R-18.1). The questions the inventory raised are R-18.

**Rationale.** The issues' definition of done — "each operation is one audited Command … the admin
routes and the port run the same Commands, so command hooks and the audit trail see one write path" —
cannot be met over a hand-audited write: it fires no hooks and writes no outbox row. Principle XIII
already requires new writes to be Commands, and an H-post write can orphan its audit row. Keeping the
action string keeps the record-history readers (`audit-state.md`) and every saved audit filter working.

**Rejected.** *Publish ports over hand-audited writes now, convert later* — the port would promise
hooks it does not fire, and the conversion would then change a published behaviour. *Leave those
operations out* — that is most of Organization moderation, CustomerAccount and QuoteRequest, which is
the very gap the issues were raised for.

## R-3 One Command factory per operation, called by route and port

**Decision.** Each operation has one Command factory in the owner's `src/backend/commands/`
(`make<Op>Command(deps, input)`), as `organizations` already does (`set-parent.command.ts`,
`create-organization.command.ts`). The admin route and the port implementation both call
`commandBus.run(make…Command(…))`. Side effects the route performs today outside its write (notices,
cache invalidation, reindex) move into the Command's event / after-commit path or into the shared
service the Command calls (FR-013).

**Rationale.** Parity by construction rather than by test; the test then proves it. The side-effect
move is the trap: a route that invalidates a cache after `commandBus.run` returns would leave every port
call stale.

**Rejected.** *The port calls the route's service method* — services in several modules are not
Commands (R-2), and a service method is not what the hooks key on.

## R-4 Actor and source

**Decision.** The actor is ambient (`resolveCommandActor`, `packages/platform/src/commands/actor.ts`).
Under `withSystemScope` it is `system`; under `withSystemScopeActingFor` it is that administrator. No
port takes `actorAdminUserId`: the current lifecycle ports that do (`block`, `unblock`, `softDelete`,
`restore`, `setCustomerGroup`) are deprecated by this feature. The options carry `source?: string` — a
code (`^[a-z][a-z0-9_.-]{0,63}$`), recorded as `source` in the Command's `stateAfter` (a code-shaped
value, `audit-state.md` list 1), `null` when absent; a value outside the grammar is refused
`VALIDATION_FAILED` before the Command runs, because a free value cannot be written into audit state.
The issues' "actor kind `automation`" is this pair — **owner ruling D-293.6 (2026-11-23), as
recommended**. Nothing on the Command Bus, the audit entity or the outbox changes: no migration, no
new `CommandActor['kind']`.

**Rationale.** Principle XIII forbids an actor taken from input; `CommandActor['kind']` is
`'admin' | 'customer' | 'system' | 'api_key'` and is published (`@endora-commerce/platform`), read by
outbox rows (`actorKind`) and, after `specs/189-command-middleware/`, by middleware `meta`. A new kind is
a widening every exhaustive `switch` in a consumer must handle — itself a surface change under OD-4.
The source code answers what "automation" is meant to tell an operator: which integration acted.

**Rejected.** *A new `automation` actor kind* — ruled out by D-293.6 for the reason above. *An
`actor_source` column on the audit entry* — a platform migration and a second home for a fact the
Command's state already carries. *A free-text reason* — values are not allowed in audit state of
tenant-scoped records. *Requiring `source` under a system actor* — would refuse every existing worker
Command and is not what was ruled; a call without it records the system actor alone.

**Consequences for the siblings** (dependencies, not edits made here):
`specs/188-policy-points/` and `specs/191-membership-join-requests/` were written against an
`automation` actor kind and must read it as `system` + `source` — `188`'s auto-approval passes
`source: 'organizations.moderation'` to `approve`, `191`'s background moves a code of its own;
`191`'s interim ("record `system` with the scope reason, switch when 186 lands") becomes the final
design, minus the free-text reason. `specs/189-command-middleware/` needs nothing: `meta` carries
`CommandActor`, whose kinds do not change; exposing `source` in `meta` would be an additive choice of
189's.

## R-5 The shared options type

**Decision.** `packages/contracts/src/aggregate-ports.ts` exports:

```ts
export interface AggregateCommandOptions {
  /** Extension input for command-hook modules on the action, keyed by module id (spec 176, issue #1057). */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** The record version the caller read; a moved-on row is refused 409 VERSION_CONFLICT. */
  readonly expectedVersion?: number;
  /** The calling integration's code, recorded in the audit entry (R-4). */
  readonly source?: string;
}
export type CustomFieldMerge = (current: Record<string, unknown>) => Promise<Record<string, unknown>>;
```

Every operation's last parameter is `options?: AggregateCommandOptions` (or an aggregate-specific
extension of it). `OrganizationCommandPortOptions` becomes an alias of it (additive).
`expectedVersion` is honoured only where the aggregate has a `version` column the admin route checks;
elsewhere the contract says it is ignored.

**Rationale.** One spelling across nine ports; optional *parameters* are fine under D-97.3, which
refuses optional *methods*.

**Rejected.** *Per-port option types* — nine copies that drift.

## R-6 Transactions: a port call is its own Command

**Decision.** A port call opens its own Command transaction on the owner's EntityManager. A caller
must call it after its own commit, never inside `em.transactional` (precedent: `orderTransitionPort`'s
contract, issue #200, `check:transaction-context`). Code that needs to write atomically with another
module's Command uses a `beforeCommit` command hook on that Command, which writes the hook module's own
tables on the hook's `em`.

**Rationale.** A nested call on another pooled connection commits independently; the caller's rollback
cannot reach it.

**Rejected.** *An `em` parameter on each operation* — hands one module's transaction to another, which
D-169 permits only for install surfaces where no container exists.

## R-7 No permission in the port

**Decision.** Ports check no permission (the existing `OrganizationCommandPort` wording); the contract
says the caller is the gate and the port is never resolved for a customer-facing route.

**Rationale.** A server-side caller has no admin permission set; admin routes keep their
`requireAdmin(...)` gate in front of the same Command.

**Rejected.** *Passing a permission context* — re-introduces an actor parameter (R-4).

## R-8 Custom-field values and records

**Decision.** Every port has `setCustomFieldValues(id, merge, options?)` in the shape of
`organizationCustomFieldWritePort` (`custom-field-writes.md` § *Server-side writes*): the owner loads,
calls `merge(current)`, stores the result, one Command, `changedCustomFields` in the entry; the caller
validates inside `merge` through `CustomFieldValuePort.validateAndMerge`. For Product the bag is
`attribute_values`, the binding's `valueColumn`. `OpportunityRecord`, `ProjectRecord` and `TaskRecord`
gain `customFieldValues: Record<string, unknown>`; the other six records already carry them.
`OrderRecord` gains `payer: OrderPayer | null` (`orderPayerSchema`, `specs/182-related-payers/`).

**Rationale.** One method name makes the derived check of R-14 possible and matches the binding
registry, which already treats Product's attribute values as its custom-field bag. The values live on
the same row, so a record carrying them costs no query.

**Rejected.** *`setAttributeValues` on Product* — a second name for one concept. *An opt-in include* —
that mechanism is `specs/187-side-table-extensions/`'s, for data in other modules' tables.

## R-9 Operations deliberately left out

**Decision.** Not offered, and each contract says so: Order *reorder* (writes a basket — the carts
aggregate) and *clone to quote* (creates a QuoteRequest — `quoteRequestCommandPort.create` is the
server-side path); Order *bulk status* (a caller loops `applyStatus`, which is one Command per order
anyway); QuoteRequest *resubmit*, *accept/reject revision*, *convert to order* (the buyer's own
decisions; no server-side caller acts for the buyer in them); Project *archive/restore* (no such
operation exists); CustomerAccount *set organization*, *detach to personal*, *attach to organization*
(membership, `specs/191-membership-join-requests/`); Organization *invitations*, *roles* and *members*
(their own aggregates or the membership port).

**Rationale.** OD-2 publishes the aggregate's lifecycle; operations that belong to another aggregate,
or to a buyer's own session, would widen the port beyond its aggregate.

**Rejected.** *Copying the issue lists verbatim* — #1823 names `cloneToQuote` and `reorder`, #1828
names `archive` / `restore`; the first two belong elsewhere and the last two do not exist.

## R-10 Narrow-port disposition

**Decision.** A narrow port, or a method of one, is deprecated when every operation it offers has the
same-semantics operation on the aggregate port; its implementation then delegates. Reads move to read
ports. Capability ports with semantics the aggregate port does not have stay. Full table:
`data-model.md` § *Port disposition*.

**Rationale.** OD-4 needs a removal list that is decided once, not per reviewer.

**Rejected.** *Deprecating every capability port* — `catalogBulkImportPort` (report-shaped bulk),
`orderStatusAnnouncePort`, `orderQuoteSourcePort` and `customerAccountRoleCommandPort` (a child-Command
factory for `organizations`' own Commands) answer different questions.

## R-11 The contract surface: kinds, tiers, directions

**Decision.** One classification, by **kind**; entries are derived per kind from the tree, never
listed (D-100). Tiers: **frozen** (no change at all), **stable** (incompatible change only after one
deprecation release), **additive-only** (only compatible additions, in the kind's direction; never a
removal, deprecated or not — a removal is a new versioned name). Directions: **read** (a consumer reads
it: HEAD must be assignable to base), **write** (a consumer writes it: base must be assignable to HEAD),
**call** (a method: base parameters assignable to HEAD parameters, HEAD return assignable to base
return). Full table: `contracts/contract-surface.md`. Kinds owned by sibling specs (policy points,
command middleware, `extends`) are rows those specs fill when they land.

**Rationale.** #1820 item 4 asks for a categorised list; deriving each kind from the marker that
already makes a thing published (`Container name:`, `HookableActionRef`, `CUSTOM_FIELD_HOST_BINDINGS`)
means a new entry is covered by existing, with no list to update.

**Rejected.** *A hand-maintained list of entries* — a derived fact written down. *A per-entry `@surface`
tag* — YAGNI; nothing needs an entry tier different from its kind's.

## R-12 The existing `check:release-intent` is extended with the contract-surface comparison

**Decision.** `check:release-intent` exists — `backend/package.json` `"check:release-intent": "tsx
scripts/check-release-intent.ts"`, run by `quality.yml` (`quality`: default mode; `release-changeset`:
`--since`) and `publish.yml` — so #1820's premise that it does not is out of date (D-293.8) and nothing
is built beside it. Three things are added to it, all specified in
`contracts/release-intent-contract-surface.md`:

1. **The port contract surface** — #1820's "`@api` ports" is the population `check:port-shape`
   already derives from the `Container name:` marker (no `@api` tag is introduced); the private
   `modulePortsPopulation()` of `backend/scripts/check-port-shape.ts` moves to
   `backend/scripts/lib/port-population.ts` so both checks, and both trees of the comparison, use one
   derivation. Then the other 186-owned kinds of `contracts/contract-surface.md`.
2. **The deprecation-release rule** — a stable entry may be removed or fail its direction only if the
   base tag carried a parseable `@deprecated`; a marker new at HEAD must name a version above the base.
3. **The D-293.7 ledger** — R-13.

Where and how:

- **Mode**: inside `--since`, which already reads git and runs in `release-changeset` — a job that
  checks out with `fetch-depth: 0` and so already has the tags. The script's own header gives the rule
  ("this mode needs a git diff, so it runs in `release:changeset` … rather than in `quality`"). The
  default mode, `--print-publish-scope` and `--publish-registry` are unchanged; a new
  `--contract-base <ref>` overrides the base, and alone runs only the comparison (local runs, T104,
  T106).
- **Base**: the highest `v*` tag reachable from HEAD (`git describe --tags --abbrev=0 --match
  'v[0-9]*'`); unresolvable, an empty population on either side, or a probe that compiled nothing →
  exit 2, inside the analysis.
- **Compatibility**: a generated probe imports base and HEAD declarations under two names and asserts
  per entry, by direction, `[A] extends [B]`, using `Parameters<>` / `ReturnType<>` for methods (method
  syntax is bivariant otherwise); the TypeScript compiler API (already a dependency) type-checks it and
  maps diagnostics back to entries. Both trees resolve against HEAD's `node_modules`, so a dependency's
  own type change (MikroORM 7) is not a finding.
- **Code home**: `backend/scripts/lib/contract-surface.ts` — a pure analysis — beside the script's
  other `lib/` readers; findings join `ReleaseIntentFindingKind` with the `contract-` prefix.
- **Name**: *contract surface*, because `PublishedSurface` in the same script is D-162's file set and
  `backend/test/unit/kernel/published-surface.test.ts` is the platform-barrel test.
- **Estate**: the entry is already `repository-only`; its reason gains one sentence. **Read size**: the
  record runs the default mode, which the comparison does not enter, so nothing is re-recorded.
- **Output**: `[release-intent] contract-base=<tag> entries=<head>/<base> … violations=<n>`, zeros
  printed.

**Rationale.** The owner named the instrument and it already owns the release-time questions and the
one git input (`--since`) in CI; extending it keeps one gate, one exit-code grammar and one job, and
needs no workflow change because the job already has the tags. A compile probe judges compatibility as
a consumer's compiler would, which a text diff cannot (a widened union, an added optional parameter).

**Rejected.** *A new `check:contract-surface` script* — a second gate for a question the owner assigned
to this one, and a second job that would need full history. *Running it in the default mode and giving
`quality` `fetch-depth: 0`* (the first draft's T041) — the script's rule puts git-reading analyses in
`--since`, and a full clone in the widest job costs every pull request for no extra coverage.
*Hosting the analysis in `packages/cli/src/rules/`* (the first draft) — the check is `repository-only`,
so a published package would carry code no instance runs. *API Extractor* — a new dependency and a
`.d.ts` roll-up model that does not know the `Container name:` population. *A committed surface
snapshot* — a generated artefact to keep fresh, the trap `AGENTS.md` lists. *Diffing npm tarballs* —
network in CI. *A textual signature diff* — false positives on formatting, and blind to whether a
change narrows or widens. *An `@api` JSDoc tag* — a second declaration of what `Container name:`
already declares.

## R-13 Sanctioned breaks (owner ruling D-293.7, 2026-11-23)

**Decision.** A deliberate break skips the deprecation release when it is ledgered.
`backend/scripts/ledgers/contract-surface-breaks.ts` holds `SANCTIONED_CONTRACT_BREAKS`, keyed by
contract-surface entry id, each entry `{ base, finding, ruling, upgradeNote, why }`
(`data-model.md`; `contracts/release-intent-contract-surface.md` §5):

- **Live** when `base` equals the run's base: the matching finding (same id **and** kind — one entry
  licenses one kind of break) is printed as `ruled` with its D-number and does not fail.
- **Announced**: the `upgradeNote` anchor resolves to a `{#…}` heading in both
  `docs/docs/upgrading-an-instance.md` and its Polish translation, and each section names the entry's
  symbol and the D-number; otherwise `contract-break-unannounced`.
- **Two-way**: a live entry matching no finding is `stale-contract-break`.
- **Spent** when `base` is older than the run's base: printed, and refused only on a branch the
  existing D-212 classification calls `release` (`spent-contract-break`), so the next release pull
  request removes it.
- `contract-break-malformed` for a bad D-number, base or empty field. The D-number's existence is not
  checked — rulings below the pre-migration floor are in withheld records.

**Rationale.** A security fix may not wait a release; a recorded ruling with an announced upgrade path
beats a disabled check. Binding an entry to its base release gives it a natural end, and charging the
clean-up to the release pull request — the one branch whose author owns the release checklist — keeps
the first pull request after a tag from going red for a change its author did not make, the
derived-ledger trap `AGENTS.md` lists. Requiring the upgrade note to name the symbol and the ruling in
both languages makes the note, not the ledger, the thing an upgrader reads.

**Rejected.** *An environment variable, flag or pull-request label that skips the comparison* —
invisible in the diff, and it would skip every finding, not one. *An entry with no base* — never
expires, and a ledger nobody has to empty accumulates. *Failing spent entries on every branch* —
reds whichever unrelated pull request lands first after the tag. *Emptying the ledger in the release
pull request itself* — that pull request is still compared with the previous tag, so it still needs
the entries. *Licensing every finding on an entry id* — a ruled removal would also license an
unrelated narrowing of the same entry.

## R-14 One instrument for "every extensible host has its port"

**Decision.** Each `CUSTOM_FIELD_HOST_BINDINGS` entry gains `aggregatePort: '<containerName>'`;
`check:port-shape` gains a signal: the named port is published (marker), registered by the binding's
`ownerModuleId`, and declares `setCustomFieldValues`. Until each story lands, its host sits in a
two-way ledger in the check, drained by that story.

**Rationale.** OD-3's "one decision" made literal: adding a host means naming its port in the same row.
Port names cannot be derived mechanically from entity types (`category` → `catalogCategoryCommandPort`).

**Rejected.** *A `Kind:` marker on every port of the nine owners, refusing a second write port* — about
fifty doc blocks for a self-declaration a reviewer judges anyway; the convention plus SC-005 is the
ratchet.

## R-15 Sequencing against MikroORM 7 and the siblings

**Decision.** Contracts (interfaces, options, records, deprecations in JSDoc), conventions, docs and the
release-intent comparison may merge before #1866. Command conversions, port implementations and route
moves land after #1866 merges (entity freeze). Organization lands first and `approve` first within it
(`specs/188-policy-points/` depends on it; `specs/191-membership-join-requests/` on the Organization
port). `specs/187-side-table-extensions/` adds read-port includes host by host; its write side is
command hooks, so no write-port change is owed to it.

**Rationale.** D-293.4; the conversions touch services the codemod and the decorator switch also touch.

**Rejected.** *Implementing before #1866* — every conversion would be rebased through the freeze.

## R-16 US1 (Organization, #1821): rulings on the T001 inventory findings (2026-11-25)

The T001 inventory (`contracts/organization-command-port.md` § *Inventory findings*, PR #1923)
raised eight questions and a delivery split. Each is ruled here. **None needs the owner**: none is a
business call, and none reverses a decision `spec.md` records. Item 5 narrows the wording of FR-008
without changing its intent, and says so. Code references are to `origin/master` `d97b9dd0a`.

### R-16.1 Sales channels: the kernel writer enlists in the caller's transaction; both records are kept

**Finding, confirmed as a defect that exists today.** `SalesChannelMembershipService`
(`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`) accepts
`options.em` and runs its bridge statements on it. Its audit entries still go through
`AuditPort.record`, which forks and commits on its own. Its access-cache drop
(`afterChannelsChanged` → `invalidateAfterWrite`) also runs before the caller has committed, and
that breaks the contract of `SalesChannelAccessCacheInvalidation.invalidateAfterWrite`, which says
"on behalf of a write that has **already committed**". It can be reached today without any of this
feature's code:

- `organization.create` (`commands/create-organization.command.ts`) is hookable. A `beforeCommit`
  veto rolls the create back after the bind, and leaves committed `sales_channel.membership.changed`
  entries for an Organization that does not exist.
- `organization.register` (`commands/register-organization.command.ts`) binds and then runs the
  account child Command. If the child fails, the result is the same.
- Personal-organisation provisioning (`services/personal-organization-service.ts`) and
  `price_lists` (`price-book-service.ts`, three sites) pass `em` too, and leave the same orphaned
  entries on rollback.
- A customer request that lands between the early drop and the commit re-caches the old set,
  which then lasts for the Redis TTL (5 min) and the LRU window (30 s).

Events are not affected on a Command path: `emitMembershipChanged` runs inside the bus's
`EventBus.run` scope, so the events are buffered and dropped on rollback.

**Decision.**

1. **Fix it in `packages/platform`, now, in its own pull request** (it is not a Command conversion,
   so R-15's sequencing does not hold it). When `options.em` is given, the writer *enlists*:
   - each membership entry is recorded with `AuditPort.recordWithin(options.em, …)`, so it commits
     or rolls back with the caller;
   - the access-cache drop is deferred until the enclosing scope has succeeded. `EventBus` gains an
     additive deferral, for example `afterScope(fn)`. Inside a `run` scope it queues `fn`. When the
     scope's function resolves, the queued functions run and are awaited **before** the buffered
     events dispatch, which keeps D-93's "drop before the event". On a throw they are dropped.
     Outside any scope `fn` runs and is awaited immediately. Because the Command Bus wraps
     `transactional` in `events.run`, "scope succeeded" means "committed" for every Command, child
     Commands included.
   - Without `options.em` nothing changes: the writer's own transaction has already committed when
     it audits and drops.
   - The JSDoc of `MembershipMutationOptions.em` is rewritten. It currently says the audit row and
     the drop "follow the statements as they do without it", which is the defect. The
     `sales_channels` doc and `SALES_CHANNEL_AUDIT_ACTIONS`' header (`packages/contracts/src/sales-channels.ts`)
     say `MEMBERSHIP_CHANGED` is co-transactional when the caller passes `em`. The change needs a
     `@endora-commerce/platform` changeset (minor, for the additive `EventBus` member) and tests
     for each of the three facts: an entry is gone on rollback, the drop happens after commit, and
     the drop happens before the event.
2. **`organization.sales_channels.set` keeps the per-membership entries beside its own entry.** The
   Command runs `replaceChannelsForEntity(…, { em: ctx.em, actorAdminUserId: ctx.actor.actorAdminUserId })`
   and records one entry of its own: object type `organization`, `before`/`after`
   `{ salesChannelIds }` (ids, `audit-state.md` list 1). `skipAudit` applies when the writer answers
   `changed: false`. The writer then adds its `sales_channel.membership.changed` entries, one per
   membership, in the same transaction.

**Rationale.** The writer is the platform's single mutator for all of the bridge types, and "every
add and remove is audited" is its invariant. A per-caller opt-out would make that audit optional,
which is what Principle XIII exists to prevent, and would cut the membership trail for one entity
type only. FR-003 asks for audit history to read continuously, and the membership trail is history
that operators already read. The two records answer different readers. The Organization's record
history reads object type `organization`, and the membership trail reads
`sales_channel_membership`. `organization.create` already writes this pair: its `after` carries
`salesChannelIds`, and the writer adds the membership entries. The objection in
`specs/154-sales-channel-access/` R-10, "wrapping a replace in a Command would record the same
change twice under two object types", was written before D-293. FR-002 and FR-003 now require the
operation to be a Command, so command hooks and the port see it. The remaining cost is one extra
entry, at a different granularity, and that is accepted.

**Rejected.**
- *Writing the new Command's entry alone, through an `audit: false` option on the writer*: this
  makes membership auditing opt-out, and leaves the channel-side trail missing Organization changes
  from 0.113.0 onwards.
- *Membership changes as child Commands*: the writer is not a Command, and N child Commands record
  the same N entries at more cost.
- *The caller drops the cache after `commandBus.run` returns*: every caller that passes `em` (create,
  register, provisioning, the new Command, and child runs such as `specs/188-policy-points/`'s) would
  have to remember to do it, and a child run has no "after" of its own.
- *Dropping the cache from a subscriber of `sales_channels.membership_changed`*: the cache's own
  header rejects this, because handler failures are swallowed and an unscoped emit is not awaited.
- *Leaving the defect for T028 to work around*: create and register keep it whatever T028 does.

### R-16.2 `setCustomFieldValues` runs `organization.set_custom_field_values`; `organization.admin_patch` stays off the port

**Decision.** As proposed. Parity for `setCustomFieldValues` (T023) is measured against
`organizationCustomFieldWritePort.setCustomFieldValues`, and parity for `update` is measured against
`organizationWritePort.update`. Both are the deprecated ports that T025 holds to delegation.
`organization.admin_patch` remains the route's own Command, for the combined edit (issue #470
O-2), and is not a port method.

**Rationale.** Convention item 2a.2 binds a method to "the one your admin route **for that
operation** runs". The admin PATCH is a different operation: columns and the custom-field bag in
one write. No admin route sets the bag on its own. FR-012 fixes the method's shape to the existing
merge-callback port, and that port already runs `set_custom_field_values`, which is declared
hookable in `manifest.ts`. A port method for `admin_patch` would give two methods for one column
write.

**Consequence.** A hook author who needs every custom-field change has to register on both
`admin_patch` and `set_custom_field_values`, which is already true today. T033's *Server-side
writes* section states it.

**Rejected.** *Pointing the port at `admin_patch`*: the port's `update` already covers the columns,
and the deprecated custom-field port could no longer delegate to a method with identical entries.

### R-16.3 Detach: `setParent` takes `{ parentId: string | null }`

**Decision.** Widen the input type to `string | null`. `null` detaches to a root and records
`organization.set_parent`, as the route `POST …/:id/parent` already does.

**Rationale.** The port offers the route's operation (2a.2), and the route's operation is "place in
the tree", which includes "at the root". R-9 already keeps `move` inside this method for the same
reason. An integration that mirrors an ERP hierarchy needs to reverse an assignment. The method is
not published yet, so this costs no deprecation.

**Rejected.** *Listing detach under Not offered*: it would leave an ERP no way to undo its own
`setParent`.

### R-16.4 `reject` takes `{ reason: string; notifyCustomerEmail?: boolean }`; `block` takes `{ reason?: string | null }`

**Decision.** The input types are the admin bodies' contract types without `version`, which moves
to `options.expectedVersion`. This is what the contract's "Input types reuse the admin bodies'
contract types" already requires.

- `reject` takes `reason: string`. It is required and is refused `VALIDATION_FAILED` when empty or
  longer than 2000 characters, as the route and the service refuse it.
- `notifyCustomerEmail` is an input member, defaulting to `true`.
- `block` keeps the route's optional, nullable reason.

**Rationale.** FR-013 says the side effects of the route follow the port call. The route lets its
caller choose whether the rejection notice is sent. A port without that choice cannot perform the
route's operation when the choice is `false`. For example, an ERP that sends its own rejection
letter would have the customer e-mailed twice.

**Consequence for T026.** `specs/188-policy-points/` runs `approve` as a **child** Command and
requires "the approval e-mail is sent as today" (188 FR-037). A child has no "after the
`commandBus.run` call" of its own, so the notice cannot stay in the route or port wrapper. It moves
to a module-owned subscriber of `organization.status_changed.v1`, which the bus dispatches once, on
commit, for parent and child runs alike. Sending stays best effort, in a system scope, as in
`notifyCustomer` today. The reject choice travels on that event as an additive payload member,
`notifyCustomer: boolean`.

**Rejected.**
- *Omitting `notifyCustomerEmail`*: the notice would always be sent, and the port would not have
  parity for the route's `false` case.
- *`reason: string | null` on `reject`*: the type would allow a call that the Command always
  refuses.

### R-16.5 An unknown sales channel on `create` is refused with `422 UNKNOWN_SALES_CHANNEL`

**Decision.** As proposed. The port's `create` answers the code that the deprecated
`organizationWritePort.create` answers today. The admin route keeps `VALIDATION_FAILED`. Both
answers come from the one shared guard, `assertSalesChannelsExist`
(`services/organization-write-guards.ts`), with the same status, message and `details` paths. Only
the `code` argument differs, so `create` parity compares everything except the code.

**Rationale.** The guard's header records why the code differs: a server caller can distinguish
the refusal from malformed input without reading `details`. The published JSDoc of
`organizationWritePort` (`packages/contracts/src/organizations.ts`) lists
`422 UNKNOWN_SALES_CHANNEL` as part of its contract. US1 scenario 4 and T025 require the deprecated
port to behave "exactly as before" once it delegates, which is only true if the port keeps this
code. A consumer that moves from the old port to the new one must not see its refusal code change.

**Effect on FR-008.** This narrows FR-008's wording ("the same typed refusals the admin route
answers") for the one refusal where a server-side port already publishes a more specific code. The
intent is unchanged: one guard, one refusal, one status. T019 records this in the method's JSDoc.

**Rejected.**
- *`VALIDATION_FAILED` on the port*: it changes the behaviour of the deprecated port in the release
  that only deprecates it.
- *Changing the admin route to `UNKNOWN_SALES_CHANNEL`*: it changes a published admin API refusal
  that this feature does not need to change.

### R-16.6 `expectedVersion`: optional on the port, and honoured where the route checks it

**Decision.** Accepted, within R-5's rule.
- Where the admin route checks `expectedVersion` (`update`, the four moderation methods,
  `setRestrictions`, `patchRestriction`), the port honours it: a stale version is refused
  `409 VERSION_CONFLICT` with `currentVersion`.
- When it is absent, the Command writes over the version it reads. The row's optimistic lock still
  applies, and `OptimisticLockError` is mapped to `VERSION_CONFLICT` as the moderation service
  does now. The status guard still applies, so approving an Organization that is already active is
  refused whatever the version.
- On every other method the JSDoc says the option is ignored, as R-5 already requires.
- The admin routes keep `version` required in their bodies.

**Rationale.** FR-006 requires the port to *accept* the version "where the admin route offers that
concurrency rule". It does not require callers to send it. A worker that reacts to an event has no
version that it read, and `handleNewlyRegistered` today reads the version only to pass it straight
back. The status guard, not the version, is what makes a repeated moderation call safe.

**Rejected.** *Requiring it on those methods*: it makes every worker read before it writes, for
protection the status guard already gives.

### R-16.7 Sales-rep assignment becomes a Command; this is in US1's scope

**Decision.** Confirmed. `assign` and `unassign` in `services/sales-rep-assignment-service.ts`
become Commands that keep their action strings, `organization.sales_rep_assign` and
`organization.sales_rep_unassign`. An idempotent repeat answers `skipAudit`, which matches today's
"audits nothing". The `recordAuditFromContext` calls are removed in the same change. Both the
routes and the port run the new factories. The D-260 refusal of scoped administrators stays in the
route, because it is the caller's gate (FR-009). T029's route list already names
`routes.sales-reps.ts`.

**Rationale.** FR-003 makes conversion a precondition for any in-scope operation that is not a
Command, and US1 lists sales representatives among those operations. The R-2 row marked "C" was a
measurement error, which T001 corrected. Correcting it does not change the scope.

### R-16.8 The four moderation actions are not declared hookable in US1

**Decision.** `organization.approved`, `.rejected`, `.blocked` and `.unblocked` become Commands
with no `hookData` and no `outboxData`, and are not added to `hookableActions`.

**Rationale.**
- The manifest's own rule (`manifest.ts`, the `hookableActions` comment) is that "a declaration is
  a public contract, so each is added when something needs it".
- `specs/188-policy-points/` needs three things from this feature (188 `plan.md` § *Coordination*,
  `spec.md` § *Assumptions*): `approve` runnable as a child, with a source code recorded, and the
  port running the same Command. 188 needs no hook on moderation.
- Declaring the actions later is additive (`contracts/contract-surface.md`, hookable actions).
- US1 scenario 3 is already met by the six actions that are declared.

**Rejected.** *Declaring them now "for symmetry"*: it publishes four hook-data shapes that nobody
consumes, and every one of them would then be a frozen or stable entry.

### R-16.9 Delivery: US1 is split into three pull requests

**Decision.**

| PR | Content | Closes |
| --- | --- | --- |
| **P0**: platform fix | R-16.1 item 1: the writer enlists when given `em`; `EventBus` deferral; tests; `@endora-commerce/platform` changeset. Independent of the rest, and may start now | its own issue (to be filed as a `bug`) |
| **US1a**: the port | T019 (interface **without** `setSalesChannels`), T020, T021, T022 (restriction Commands only), T023–T025, T026 (**first**, then notify 188), T027, sales-rep conversion (R-16.7), T029–T031, T033 | part of #1821 |
| **US1b**: sales channels | T028 on P0, `setSalesChannels` added to the interface (additive, unreleased), its T022 and T023 cases, the route `PUT …/:id/sales-channels` moved onto the Command, and T032 if it is still owed | #1821 |

**Rationale.**
- `approve` unblocks 188, and it should not wait for a platform fix.
- #1821's definition of done and US1's story both include sales channels, so the issue closes with
  US1b and not before.
- A method cannot be declared without being implemented over a Command (R-2), so `setSalesChannels`
  enters the interface with its Command.
- None of the deprecations in US1a depends on `setSalesChannels`, so US1b can slip a release
  without holding US1a back.

**Rejected.**
- *Closing #1821 with US1a*: it closes the issue with one of its operations still missing.
- *One pull request*: it puts 188's dependency behind the platform fix.
- *Folding P0 into US1b*: it leaves the create and registration defect open until the port work is
  done.

## R-18 US4 (Order, #1823): decisions on the T003 inventory findings (2026-11-26)

The T003 inventory (`contracts/order-command-port.md` § *Inventory findings*) raised the questions
below, which R-16, R-17 and the precedents do not answer in terms. The implementing session had no
channel to the architect, so each was recorded as proposed with the alternative rejected; the
architect's ruling (2026-11-26) closes each item. None is a business call, irreversible, or touches tenant isolation. Code
references are to `origin/master` `934991c5b`.

### R-18.1 `orderPaymentStatusApplyPort` is kept, not deprecated

**Finding.** `data-model.md` § *Port disposition* deprecates `orderPaymentStatusApplyPort` in favour of
`orderCommandPort.applyPaymentStatus`. The two are not the same operation: the apply port writes on the
**caller's** `EntityManager`, inside `payments`' settlement transaction, because `payments_order_fk`
holds the payment row and `orders.payment_status` together (D-169); it judges the move for the
`settlement` actor (which admits `failed`); it answers a refused move as a value so the payment row
still commits; and it records no entry of its own (the lifecycle move after the commit does).

**Proposed.** Keep it, as a capability port with semantics the aggregate port does not have
(convention item 2a.9). `applyPaymentStatus` is the operator's change, as the admin route makes it: its
own transaction, the operator's edges, one `order.payment_status_transition` entry. `data-model.md` §
*Port disposition* is amended.

**Rejected.** *Deprecate it and delegate* — a port call opens its own transaction (R-6), so the
settlement would commit the payment row and the order's money axis separately, the failure
`payments_order_fk` exists to prevent. *An `em` parameter on `applyPaymentStatus`* — R-6 rejects it.

**Ruling (architect, 2026-11-26):** Confirmed. R-6 refuses an `em` parameter and `payments_order_fk` (D-169) needs the payment row and the money axis in one transaction, so this is semantics the aggregate port does not have — `module-composition.md` item 2a.9 admits exactly that capability port. Not deprecated; the `data-model.md` amendment stands.

### R-18.2 The status Command records the ambient actor; the deprecated port's `actor.source` becomes `source`

**Proposed.** `order.status_transition` runs on the Command Bus, so its entry names the ambient actor,
for every caller. The deprecated `orderTransitionPort.applyStatus` delegates to
`orderCommandPort.applyStatus(orderId, { to, reason }, { source: actor.source })`: the input `actor` is
no longer the entry's (R-17.7's rule: an actor is never input), and its `source` (`payment`, `shipment`)
is recorded as the entry's `source`. The actor the `order.status.*` events carry is derived from the
ambient context (`ambientOrderStatusActor`), with `source` when it is one the event vocabulary names.
Consequence: a buyer's own cancellation is recorded in `actorCustomerAccountId` (the bus's column for a
customer acting for itself) rather than in `impersonatedCustomerAccountId`; the cancellability predicate
(`domain/status-authorship.ts`, issue #284) counts that column as a named actor. And a hold the
settlement ingress wrote is no longer recognisable by its missing actor alone — an operator recording a
decline through `POST /api/v1/payments/receive` is now the ambient administrator — so the predicate also
reads `stateAfter.source === 'payment'` as the ingress (the fact its header said it lacked). Its answers
are therefore unchanged, and entries written before 0.113.0 read as before.

**Rejected.** *Keep the hand audit for the deprecated port's callers* — two write paths for one
action, the defect FR-002 removes. *Map a customer actor into `impersonatedCustomerAccountId`* — records
an impersonation that did not happen.

**Ruling (architect, 2026-11-26):** Confirmed. An actor is never input (R-4, R-17.7, Principle XIII), and recording the buyer in `impersonatedCustomerAccountId` was a misattribution the bus now corrects; `audit_logs`' viewer and recent-activity feed already render `actorCustomerAccountId` (spec 170), and no other reader of `order.status_transition` entries reads the actor columns. The predicate keeps its answers: an operator's decline through `POST /api/v1/payments/receive` carries `source: 'payment'` and reads as the ingress, so it does not block the buyer's cancel; a shipment move under an ambient administrator now reads `named_actor`, which fails closed and is excluded by the `statusOnFailure` comparison anyway. Owed in this pull request: the header of `domain/status-authorship.ts` still says `source` "is not read here" and that the two ingresses "record identically" — rewrite it to the new rule. `source` is trusted because only in-process port callers set it and no route reads it from a request body (R-7); keep it that way.

### R-18.3 `place` stays out of this change; #1887 owns placement as a Command

**Proposed.** #1823 lists `place` and the payer; #1887 states that placement is not a Command and makes
it one (`order.place`, with hook data), and that #1823's `place` then runs it. A port method may only sit
over a Command (R-2), so `place` is added with #1887 (US11, T097–T101), additively (R-1), and
`orderPlacementPort` is deprecated then. What the payer needs from this change is on the read side:
`OrderRecord.payer` (R-18.7).

**Rejected.** *Publish `place` over the current placement* — the port would promise hooks and an audit
entry the buyer's placement does not write.

**Ruling (architect, 2026-11-26):** Confirmed. R-2: a port method sits over a Command, and placement is not one until #1887; `place` is added additively there (R-1).

### R-18.4 Comments are the `order.comment.add` Command for the operator and the buyer

**Proposed.** One factory, `makeOrderCommentAddCommand`, for `POST /api/v1/admin/orders/:id/comments`,
`orderCommandPort.addComment` and the buyer's `POST /api/v1/orders/:id/comments` (through the module's
own service — a customer session never resolves the port, R-17.5). The entry records `commentId`,
`isCustomerVisible` and `notifyCustomer`; never the body. The notice stays after the commit, in the
service, for route and port alike. Both `command-coverage-ignore` markers go.

**Rejected.** *The operator's comment only* — one entity with two write paths, and an ignore marker
whose reason ("not audited domain state") the other path would contradict. *Recording the body* — free
text in a global audit table (`audit-state.md` list 1).

**Ruling (architect, 2026-11-26):** Confirmed. One entity, one write path (R-3); the body is free text and stays out of audit state (`audit-state.md` list 1). The buyer's path keeps its existing ownership check before the Command runs (Principle XI); the ambient customer is the entry's `actorCustomerAccountId`.

### R-18.5 The buyer's cancellation runs the module-internal outcome helper, not the port

**Proposed.** `CustomerOrderCancellationService` resolved `orderTransitionPort` and so would have moved
to `orderCommandPort`; R-17.5 forbids a customer-session route the aggregate port. It runs
`applyStatusAsOutcome` (`services/order-status-outcome.ts`), the function the port's `applyStatus` runs,
over the same transition engine — the same Command, outcome and follow-ups. `payments`' buyer payment
retry reads terminality from `orderReadPort.isTerminal`, a read port, which a customer route may use.

**Rejected.** *Resolve the port from the buyer's route* — R-7, R-17.5.

**Ruling (architect, 2026-11-26):** Confirmed. R-7 and R-17.5 decide it: a customer session never resolves the aggregate port; running the same module-internal helper keeps one Command and one outcome.

### R-18.6 `withCallerOptions` is copied a second time, into `orders`

**Proposed.** R-17.6 says the helper moves to `@endora-commerce/platform/commands` when a third module
needs it; `orders` is that module (with `organizations` and the unmerged `customer_accounts` copy).
`packages/platform/src/commands/` is held by another session (spec 189, middleware) and may not be
edited from here, so `orders` copies the twenty lines; the move is owed as a follow-up once that
surface is free, and takes all three copies with it. Follow-up: refs #1961.

**Rejected.** *Import `organizations`' copy* — another module's internals (Principle I).

**Ruling (architect, 2026-11-26):** Confirmed as a bounded exception to R-17.6's trigger. `packages/platform/src/commands/` is held for spec 189, so the third copy is accepted; a follow-up issue is filed before merge, labelled for spec 189's surface, and moves all three copies (`organizations`, `customer_accounts`, `orders`) in one change once that surface is free. The copy must stay byte-identical in behaviour to `organizations`' (no local drift).

### R-18.7 `OrderRecord.payer` is optional on the type

**Proposed.** `payer?: OrderPayer | null`, always filled by `orders` from the stored payer (the admin
serialiser's shape), as `payerOrganizationId?` already is on the same record, so a record built by a
consumer's test double before 0.113.0 still compiles. `data-model.md` wrote it required.

**Rejected.** *Required* — every hand-built `OrderRecord` outside this repository stops compiling in the
release that only adds the field; the read direction gains nothing from the `?`'s absence.

**Ruling (architect, 2026-11-26):** Confirmed. `OrderRecord` is a read-direction type: either form is compatible for a reader (`contract-surface.md` § Directions), and the optional form also keeps hand-built doubles compiling; `orders` always fills it. `data-model.md` is amended to the optional form.

### R-18.8 Published refusal codes are kept on the port; `expectedVersion` and `extensions`

**Proposed.** `setExternalReference` answers a malformed value `400 VALIDATION_FAILED`, as the published
`orderExternalReferencePort.set` does (R-16.5's precedent), not the convention's 422;
`setCustomFieldValues` answers an unknown order `404 NOT_FOUND`, as its route does. The other methods'
input refusals are `422 VALIDATION_FAILED`. `expectedVersion` is ignored by every method (no `version`
column, R-5). `extensions` reach the bus, which refuses every key (`422 COMMAND_EXTENSION_UNCLAIMED`)
until an Order action is declared hookable; declaring them is #1887's (placement) or a later need's
(R-16.8's rule).

**Rejected.** *Unifying on 422* — changes a published refusal in the release that only deprecates its
port.

**Ruling (architect, 2026-11-26):** Confirmed. R-16.5 keeps a published refusal code over the convention's; R-5 and R-16.6 ignore `expectedVersion` where the row has no version; R-16.8 leaves hookability to the first need, so the bus's `COMMAND_EXTENSION_UNCLAIMED` is the right answer meanwhile. The port's JSDoc says `expectedVersion` is ignored, so a caller is not misled.

### R-18.9 `isTerminal` is a required method of `OrderReadPort`

**Proposed.** The read moves to `orderReadPort` as the disposition table says, as a required method
(D-97.3 refuses optional ones). The only implementer is the owner (R-1); four in-repository test doubles
gained the method; `../paid-modules` holds no full double of the read port.

**Rejected.** *Keep it on the deprecated port only* — a read on a write port is what R-10 removes.

**Ruling (architect, 2026-11-26):** Confirmed; not a contract-surface break. A port method's direction is `call` (`contract-surface.md` § Kinds): adding a method is compatible for every caller, and the only implementer is the owner (R-1). `../paid-modules` was read (2026-11-26): paypal, stripe, autopay, tpay, payu, inpost, dhl_parcel only call the port; their doubles (`inpost` `adapter-renderers.test.ts`, `generate-and-poll.test.ts`; `tpay` `notification-payload-projection.test.ts`) are partial objects cast `as unknown as OrderReadPort` or untyped, so none stops compiling. `check:port-shape` refuses the optional form (D-97.3).
