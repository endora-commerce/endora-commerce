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
| CustomerAccount | create, change_role, set_preferred_language, remove_member, promote_organization_admin, set_subtree_rollup, custom_fields.update | create standalone, anonymise (`customer-account-lifecycle-ports.ts`); update_profile, email_verified (`customer-account-ports.ts`, measured by T002) | block, unblock, soft-delete, restore, group assign (`customer-account-lifecycle-ports.ts`, `AuditPort.record` after the flush — measured by T002) | — |
| Order | custom_fields.update, external_reference.set | status_transition (`order-transition-service.ts`), payment_status_transition (`order-service.ts`) | place_on_behalf (impersonation only) | comments (`order-comment-service.ts`, N); buyer placement (N) |
| QuoteRequest | send_document | create, create_on_behalf, patch_draft, modify, approve, assign, cancel (`rfq-service.ts`, `rfq-admin-service.ts` `#audit`) | — | admin custom-field values (?) |
| Product | create, update, archive, restore, delete, variant create/update/delete, scoped_values.save, scopes.update | — | — | — |
| Category | create, update, delete | — | — | move (?: likely `update` with a parent), inventory thresholds (N here; audited by `inventory`'s caller as `low_stock_threshold.update`) |
| Opportunity | all listed (`crm`: 33 `commandBus.run` sites, 0 hand audits) | — | — | — |
| Project | all listed (`projects`: 38 sites, 0 hand audits; confirmed by T006) | — | — | archive/restore: no such operation |
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

**Inventory (T002, CustomerAccount, 2026-11-26).** Measured against the table above
(`contracts/customer-account-command-port.md` § *Inventory findings*): block, unblock, soft-delete,
restore and the group assignment are **H-post**, not H-in — the lifecycle service flushes and then
records through `AuditPort.record`, on its own fork; the create-standalone and anonymisation writes
are H-in. The two `?` resolve to **H-in**: `update_profile` and `email_verified` are recorded by hand
on the write's unit of work in `CustomerAccountMemberWriteService`. All seven convert. Two side
effects of the admin routes are not the port's but `customers'`, around the port call — the session
revocation after a block or deletion, and the last-administrator guard before it — so a port call
would skip them; both move into the Commands (R-17.1, R-17.2). No operation moves in or out of
FR-021. The questions the inventory raised are R-17.

**Inventory (T006, Project, 2026-11-26).** Measured against the table above: every operation of
FR-027 is **C** — 38 top-level `commandBus.run` sites and the per-Organization children, no hand
audit anywhere in the module — so nothing converts. No operation moves in or out of FR-027. The
questions the inventory raised (an administrator on two rows, `expectedVersion` over two tokens, the
multi-Command `PATCH` and Organization set, the answer shape) are R-22, and the findings are in
`contracts/project-command-port.md` § *Inventory findings*.

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

## R-17 US3 (CustomerAccount, #1822): decisions on the T002 inventory findings (2026-11-26)

The T002 inventory (`contracts/customer-account-command-port.md` § *Inventory findings*) raised six
questions R-16 and the Organization precedent do not answer in terms. The implementing session
proposed each; **all six are ruled below (architect, 2026-11-26), each as proposed.** None is a business
call or reverses a recorded decision, so none was escalated to the owner. Code references are to `origin/master` `71035e51d`.

### R-17.1 The session revocation of a block and a deletion moves into the Command, after its commit

**Finding.** `customerAccountLifecycleWritePort.block` and `.softDelete` only write and audit;
`customers`' `CustomerModerationService.block` and `CustomerDeletionService.softDelete` call
`authSessionPort.destroyAllForCustomer` after the port returns.

**Decision.** `customer_account.blocked` and `customer_account.deleted` defer
`authSessionPort.destroyAllForCustomer(id)` to their commit through `EventBus.afterScope` (issue
#1926, R-16.1), handed to the factories as `afterCommit`. `customers` no longer calls it. A
session-store failure after the commit is logged and does not fail the call — `afterScope` isolates a
deferred function as it isolates an event handler — where it used to answer `500` after a committed
block. An idempotent block (already blocked) ends no session, as before.

**Rationale.** FR-013: the route's side effects follow the port call, and US3 scenario "a worker
blocks an account; its sessions end" is the reason the issue names the revocation. An after-commit
path keeps "a block that rolls back ends nobody's session", which a call inside `run` would break, and
works for a child run, which a port-wrapper call after `commandBus.run` would not (R-16.4's argument).

**Rejected.** *The port calls the revocation after `commandBus.run` returns* — a child run has no
"after"; and the route and the port would then each have to remember it. *A subscriber of a new
`customer_account.blocked.v1` event* — a new published event for one in-module consumer, and handler
failures are swallowed with no ordering guarantee against the response.

**Ruling (architect, 2026-11-26): confirmed.** R-16.1's `afterScope` is the sanctioned after-commit
path, and the "block stays, failure logged" outcome is no weaker than today's, where a `500` also
followed a committed block. It is not a session-security regression: a session whose account is not
active binds no customer actor (`packages/modules/auth/src/backend/plugin.ts`, the `account?.active`
check), so a surviving session row is answered `401` by `requireCustomer`. That check is the guarantee;
the revocation is hygiene, and must stay so — do not relax the bind check on the strength of this one.

### R-17.2 The last-administrator guard of a block and a deletion moves into the Command, under the holders' lock

**Finding.** `customers`' `OrganizationDepletionGuard` refuses `409 ORG_OWNER_DEPLETION` before the
port call, over an unlocked count; a port call skips it, and two concurrent blocks of a company's two
administrators can both pass.

**Decision.** `customer_account.blocked` and `customer_account.deleted` run
`refuseDepletingCompanyOrganization` (`commands/customer-account-role-rules.ts`): when the account
holds its Organization's *Administrator* and the Organization is not personal
(`organizationDetailsPort.findById(…).isPersonal`, resolved per call), lock the active holders
(`lockActiveHolders`, the R-29 lock of `change_role` / `remove_member`) and refuse when no other would
remain. Same code and messages as `customers` answered. `customers` drops the guard for block and
delete; it keeps it for `unassign`, the Membership move (191). The order of the route's refusals is
unchanged: the authority check (`403`), then the idempotent shortcut, then the guard.

**Rationale.** FR-008 — the port answers the route's refusals — and the invariant "a company
Organization keeps an administrator" is the aggregate's, as `CANNOT_DEMOTE_LAST_ADMIN` already is in
`change_role`. Moving it under the lock also closes the race.

**Rejected.** *Leave it in `customers`* — the port would block the last administrator, which no admin
path can. *Both places* — two statements of one rule.

**Ruling (architect, 2026-11-26): confirmed.** The invariant is the aggregate's (FR-008, the
`CANNOT_DEMOTE_LAST_ADMIN` precedent), and locking the holders closes a race the route-side guard had.
The Organization is the account's own, read by id, so no cross-tenant read is introduced (Principle XI).

### R-17.3 The restore window stays the caller's

**Decision.** `customers.deletion_retention_days` is `customers`' setting, and `customers` depends on
`customer_accounts`, not the reverse. `restore` refuses only an anonymised account (the owner's own
`409 CUSTOMER_RESTORE_WINDOW_ELAPSED`); the admin route keeps refusing a restore past the window before
the sweep has reached the account. The contract names it among the route's gates.

**Rejected.** *Reading the setting in `customer_accounts`* — a dependency edge the wrong way round.

**Ruling (architect, 2026-11-26): confirmed.** The dependency direction decides it (Principle I), and
R-7 already makes the caller the gate. A server-side caller restoring through the port owns the window
check, as the contract states.

### R-17.4 `setPreferredLanguage`: the caller's `source` is the state's `source`; the buyer's own port is kept

**Findings.** `customer_account.set_preferred_language` already records `source: 'self_service' |
'sign_in'` — the key R-4 records a caller's code under. Its only route is the buyer's own page, which is
customer-facing.

**Decision.**

- The port's `setPreferredLanguage` overwrites, as `self_service` does, and records the caller's
  `source` code, or `null` when it passes none (R-4's "null when absent"). The Command's input source
  widens to `CustomerPreferredLanguageSource | null` internally; the published type is unchanged.
- `customerAccountPreferencePort.setPreferredLanguage` is **not deprecated**, against `data-model.md`'s
  row: it is the buyer's own write (the customer-facing route R-7 keeps the aggregate port away from),
  in the same position as `captureIfUnset`. It now runs `customerAccountCommandPort.setPreferredLanguage`
  with the code `self_service`, so there is one write and its entry is unchanged. `data-model.md`
  § *Port disposition* is amended.

**Rejected.** *Deprecating it and moving the self route onto the aggregate port* — contradicts R-7,
and leaves the buyer's route on a port whose contract says "never for a customer-facing route".
*A new published `CustomerPreferredLanguageSource` member* — a widening for no reader.

**Ruling (architect, 2026-11-26): confirmed.** R-7 decides it: the buyer's own route may not resolve
the aggregate port, so the port it does resolve cannot be deprecated without leaving it nowhere. The
`data-model.md` § *Port disposition* amendment stands.

### R-17.5 The storefront member routes stay on the kept ports; the operator's member panel moves

**Finding.** T052 names `organizations/routes.members.ts`, which is the storefront member area
(`requireCustomer` and the Organization-administrator gate). The operator's member panel is in
`organizations/routes.admin.ts`.

**Decision.** The operator's routes — create, role, roll-up, profile, removal and the
recover-admin-access promotion — call `customerAccountCommandPort`. `routes.members.ts` keeps
`customerAccountRoleCommandPort.changeRole` and `customerRolePort.removeMember`, both kept by the
disposition table, which build the same Commands. The rule applied, for this and R-17.4: a route under
a customer session does not resolve the aggregate port; a server-side flow that has verified its own
gate (a token: e-mail verification, invitation accept) may.

**Rejected.** *Moving the storefront routes too* — R-7.

**Ruling (architect, 2026-11-26): confirmed.** R-7 again; T052's file reference was a slip, and the
rule stated above (customer session → never the aggregate port; a token-verified server-side flow → may)
is adopted as the reading of R-7 for the remaining US stories.

### R-17.6 `withCallerOptions` is copied into `customer_accounts`, not shared

**Decision.** `commands/caller-options.ts` is a copy of `organizations`' twenty lines. A module's
`commands/` is its own (Principle I), and a shared helper is a new name on
`@endora-commerce/platform/commands`, a hotspot this change does not touch; with a third owner the
helper should move there.

**Ruling (architect, 2026-11-26): confirmed.** Principle I and YAGNI; the move to
`@endora-commerce/platform/commands` is owed when a third module needs the helper, not before.

### R-17.7 The smaller choices

**Ruling (architect, 2026-11-26): confirmed, all three.**

- *The deprecated methods ignore `actorAdminUserId` and `audit`.* R-4 and Principle XIII decide it: an
  actor is never taken from input, and the bus stamps the request metadata. The one caller this changes
  is the paid `comarch_xl` module, which passes the nil UUID as `actorAdminUserId` to
  `setCustomerGroup`; its entries used to record a fabricated administrator and now record `system`,
  which is the truth. When it moves onto `customerAccountCommandPort` (inventory finding 10) it passes
  `source: 'comarch_xl'` (R-4) so the entries name the integration again.
- *`expectedVersion` is ignored.* R-5 and R-16.6 decide it: no `version` column, and `expectedUpdatedAt`
  stays the member routes' own gate.
- *Parity without an admin route is measured against the deprecated or buyer ports.* R-16.2's
  precedent (`setCustomFieldValues` against `organizationCustomFieldWritePort`).


## R-22 US7 (Project, #1828): decisions on the T006 inventory findings (2026-11-26)

The T006 inventory (`contracts/project-command-port.md` § *Inventory findings*) raised the questions
below, which R-16, R-17, R-18 and the precedents do not answer in terms. The implementing session had
no channel to the architect, so each was recorded as proposed with the alternative rejected; **all eight
are ruled below (architect, 2026-11-26), each confirmed**, R-22.3 and R-22.5 with a contract text change
owed. None needed the owner. None is irreversible, and none touches tenant isolation: every write still starts from
`ProjectAccess.loadVisible` under the ambient context and locks the Project in its Command. Code
references are to `origin/master` `d936722d5`.

### R-22.1 The port runs the route's service methods, which build the Commands

**Proposed.** `projects` has no `commands/` directory: each Command is built inline in the service
method its route calls (`ProjectService`, `MoveService`, `LinkService`, `ProjectCommentService`), and
that method also does what the route does around the Command — the workflow check, the completion gate
and the stage guards before it; Stage Tasks, mentions, a message's Members and a deleted Project's
Tasks after it. Each such method is split into the write (`createProject`, `updateProject`,
`applyOrganizations`, `applyMembers`, `moveProject`, `closeProject`, `reopenProject`, `link`, `write`,
plus `delete` / `remove` as they were) and the route's wrapper, which only renders the reader-language
answer. The port calls the write; the caller's `source` and `extensions` reach the Command through the
copied `withCallerOptions` (R-18.6), applied inside the service. This is convention item 2a.2's "the
one your admin route runs", reached the way `organizationCommandPort` reaches moderation and
restrictions — through the route's own runner.

**Rejected.** *Moving each Command into a `commands/*.command.ts` factory first* — some 1,500 lines
moved with no behavioural difference, and a conflict with #1950 (open), which edits the same
services and adds its own merge refusal to `lockProject`; through the services, a port call inherits
that refusal without either change knowing of the other. *A port over its own copies of the
Commands* — two write paths, the defect FR-002 removes.

**Ruling (architect, 2026-11-26): confirmed.** R-3 rejected *the port calls the route's service method* because services elsewhere are not Commands; R-2 measured every Project operation as C, so the premise does not hold here, and parity is still by construction: the route's wrapper and the port call one write method, and the wrapper only renders. The fourth `withCallerOptions` copy is behaviourally identical to `organizations'` and falls under R-18.6's bounded exception; #1961 must list `projects` beside the other three before merge. #1950's inheritance holds: every method but `create` (which locks no existing row) reaches `lockProject` (`link-service.ts`, `comment-service.ts`, `move-service.ts`, `project-service.ts`).

### R-22.2 `create` and `addComment` need an administrator behind the call

**Finding.** `projects.created_by_admin_user_id` and `project_comments.author_admin_user_id` are
`not null`: a Project is somebody's, and a comment has an author. The create Command refused a call
with no administrator with a plain `Error` inside its transaction (a 500); the comment service already
refused it `403 FORBIDDEN` before anything was read.

**Proposed.** Both are refused `403 FORBIDDEN` before anything is read when no administrator is behind
the call — the comment route's refusal, now also `createProject`'s first statement. A worker runs them
under `withSystemScopeActingFor(adminUserId, reason)` (the administrator who queued the work), which
the platform already offers; every other method runs under `withSystemScope` with the `system` actor.
The JSDoc says so on both methods and on the port. The investor case of #1828 needs neither.

**Rejected.** *Making the two columns nullable* — a migration and a widening every reader of
`ProjectComment.author` and of the creator would have to handle (`ProjectCommentSchema.author` is not
nullable), to let a write record nobody. *An `actorAdminUserId` input* — R-4: the actor is never input.
*Keeping the 500* — a refusal of the caller's context is not a server fault.

**Ruling (architect, 2026-11-26): confirmed.** R-4 and Principle XIII decide it: the actor is ambient and never input, and a `not null` author column cannot be satisfied by the `system` actor without fabricating an administrator. A `403` before any read is the comment route's existing refusal and is not a server fault. `withSystemScopeActingFor` also applies that administrator's Organization reach to the create, so no tenant widening (Principle XI).

### R-22.3 `expectedVersion` is the token the route checks; the record carries both

**Finding.** A Project has two optimistic-concurrency tokens (issue #449): `version` (its fields, state
and Stage — `PATCH`, `move`, `close`, `reopen` require it) and `configurationVersion` (its sets —
`PUT …/organizations` and `…/members` accept it, optionally). `ProjectRecord` carried neither, so a
caller could not pass back what it read.

**Proposed.** `options.expectedVersion` names the token the operation's route checks: `version` on
`update`, `setCustomFieldValues`, `moveToStage`, `close` and `reopen`; `configurationVersion` on
`setOrganizations` and `setMembers`; ignored by `link`, `unlink`, `addComment` and `delete`, whose
routes check none (R-5). A stale token is the route's **`409 PROJECT_CHANGED`**, not `VERSION_CONFLICT`
(convention item 5: refusals are the route's; R-16.5's precedent for a published code). Absent, it is
the version the method's own `loadVisible` read — the Command writes over that, under the Project's row
lock, and a change that landed in between is still refused rather than overwritten. `ProjectRecord`
gains `version` and `configurationVersion`, required, filled by the owner from the row.

**Rejected.** *Ignoring `expectedVersion` on the two sets and keeping `configurationVersion` as an
input member* — two spellings of "the version I read" on one port. *Requiring it* — R-16.6.
*Answering `VERSION_CONFLICT`* — the admin client already handles `PROJECT_CHANGED`; one refusal, one
code.

**Ruling (architect, 2026-11-26): confirmed, with one contract text change.** Convention item 5, R-16.5 and R-18.8 decide the code: the refusal is the route's published `409 PROJECT_CHANGED`. Absent, the token read by `loadVisible` is held, which is R-16.6's "writes over the version it reads, the row's lock still applies". Owed: `AggregateCommandOptions.expectedVersion`'s JSDoc (`packages/contracts/src/aggregate-ports.ts`) says `409 VERSION_CONFLICT` unconditionally; reword it to "refused `409` with the code the owner's admin route answers — `VERSION_CONFLICT` unless the port's JSDoc names its own". Both tokens stay **required** on `ProjectRecord`: a port's record is reached in the `call` direction, where a wider return is compatible (`contract-surface.md` § Directions), the owner is its only implementer (R-1), and `../paid-modules` holds no reference to `ProjectRecord` or `projectReadPort` (read 2026-11-26). R-18.7's optional form does not transfer: under `exactOptionalPropertyTypes` an optional token cannot be passed back as `expectedVersion`, which is its purpose.

**Addendum (#1986): the two sets hold the token they read; their admin routes keep their answer.** As merged in #1974, `setOrganizations` and `setMembers` with no `expectedVersion` passed `undefined` to `lockProjectForConfiguration`, which checks nothing: the Organizations diff, computed from a read outside the Command, was applied under the lock regardless, so a caller who read {X} and asked for {X, Y} after another set {Z} landed {Y, Z}, a set nobody asked for (the Members' archived-Role check reads outside the lock the same way). The port now passes `'read'` (`ConfigurationToken`, `project-service.ts`): the `configuration_version` its own `loadVisible` read, held to the lock, so that change is refused `409 PROJECT_CHANGED` and the stored set stays the other caller's — this ruling's text, now kept. The admin `PUT …/organizations` and `PUT …/members` still pass `undefined` when the body carries no `configurationVersion`, and the admin client sends none on either: refusing there would turn a published `200` into a `409` for a client the route has always accepted, which is a route change this follow-up does not make (#1828 shipped the port saying no admin route changes). They keep "last writer wins on the diff", pinned by a contract test; making the client send its token is the route's own change. `setCustomFieldValues` is unaffected: its `merge` runs on the bag read under the lock, so absent it needs no token. An `update` with an empty patch runs no Command, so — like a `setOrganizations` that changes nothing (R-22.5) — an unclaimed `extensions` key is not refused on it; the bus checks claims per Command against a hook registry the owner cannot read (`./composition` is the root's), and a probe Command would run the action's hooks and enqueue its `afterCommit` rows for a write that changes nothing. Both exceptions are named in `ProjectCommandPort`'s JSDoc.

### R-22.4 `update` is `projects.project.update` only

**Proposed.** The admin `PATCH` runs up to four Commands. The port's `update` takes the four fields of
the first (title, description, value, start date) and runs it alone; the values are
`setCustomFieldValues` (the second); visibility and listed people (`.visibility_set`,
`.viewers_set`) are not offered, as the contract's first draft already listed them as configuration.

**Rejected.** *The whole `PATCH` body* — one method of up to four Commands, of which only two are
hookable: `extensions` would reach some of them and be silently dropped by the others, and a caller
could not tell which write a refusal stopped (the second commits after the first, finding 3).

**Ruling (architect, 2026-11-26): confirmed.** Convention item 2a.2 and R-16.2: one method per Command the route runs for that operation, so a refusal and the `extensions` reach exactly one write. Visibility and viewers stay off the port as configuration (R-9); adding them later is additive (R-16.8's rule).

### R-22.5 `extensions` and `source` on `setOrganizations` go to the children

**Proposed.** `projects.project.organizations_set` is the parent of one `organization_add` /
`organization_remove` per change, records nothing and is not hookable; the children are (#1845). The
caller's options are applied to each child, so the hooks on them get the extension input, and each
child's entry records `source`. A set that changes nothing runs no Command and so checks no key. On
every other method the options reach the one Command it runs, and the bus refuses a key no present hook
module claims — every key on `setMembers`, `link`, `unlink`, `addComment` and `delete`, none of whose
actions is hookable (the R-18.8 rule).

**Rejected.** *The parent* — the bus would refuse every key, since nothing can claim one on an action
that is not hookable. *Declaring `organizations_set` hookable* — R-16.8: a declaration is a public
contract, added when something needs it; the children already name each Organization.

**Ruling (architect, 2026-11-26): confirmed.** R-16.8: the parent is not hookable and nothing can claim a key on it; the children name the Organization and are. One sentence is owed in `ProjectCommandPort`'s JSDoc: a set that changes nothing runs no Command, so an unclaimed `extensions` key is not refused on it.

### R-22.6 The answer is the record read after the write under the Organization rule

**Proposed.** The routes answer `ProjectDetail` (reader-language, with the caller's permissions). The
port answers `ProjectRecord`, read after the write through `ProjectAccess.rowAfterWrite` — the
Organization rule alone, the routes' own after-write read — so a write that took the Project out of the
acting administrator's visibility still answers it. `setOrganizations` answers `null` when the
caller's own change took the Project out of their reach (the route's `{ outOfReach: true }`); under
`withSystemScope` it never does. `link` answers `{ linkId }` and `addComment` `{ commentId }` — the ids
a caller needs for `unlink` and to find its comment; `unlink` and `delete` answer nothing.

**Rejected.** *`ProjectDetail`* — a language parameter and an admin-panel shape on a server-side port.
*`findVisible` after the write* — a Member who removed themselves would be told a committed change
did not happen.

**Ruling (architect, 2026-11-26): confirmed; no Principle XI risk.** Every method first passes `loadVisible`, which answers an invisible Project `404 PROJECT_NOT_FOUND` exactly as a missing one, and `rowAfterWrite` / `inReachAfterWrite` are reached only after a committed write that began there. So `null` from `setOrganizations` reports only the effect of the caller's own permitted write on a Project it could see: it confirms nothing the caller could not already see. `rowAfterWrite` keeps the Organization rule, so a Project another writer has moved out of reach since answers `404`. The condition, binding: neither method may ever serve a first read (its JSDoc says so). Keep it that way.

### R-22.7 `setCustomFieldValues` runs the `PATCH`'s Command, with the merge under the lock

**Proposed.** One factory, `ProjectService.#customFieldsCommand`, builds
`projects.project.custom_fields_update` for the route and the port. The route's merge answers the bag it
validated before the Command, held to the `version` that read carried (unchanged); the port's is the
caller's merge, run on the bag the Command read under the row lock, as `organizationCommandPort`'s is.
A merge that changes nothing writes, bumps and records nothing (spec edge case "same value"), the hooks
still running with an empty `changedCustomFields`. Unlike Organizations (R-16.2), the admin edit and the
port run **one** action, so a hook that must see every change of the values registers once.

**Rejected.** *Recording an entry for a no-op merge*, as `organization.set_custom_field_values` does —
the spec's edge case asks for nothing recorded, and the route never runs the Command for an unchanged
bag.

**Ruling (architect, 2026-11-26): confirmed.** The spec's *Same value* edge case decides it: a write that changes nothing records nothing. `organization.set_custom_field_values` recording an entry for a no-op merge is the outlier. R-16.2 and T025 keep it there for parity with the deprecated `organizationCustomFieldWritePort`, so the inconsistency is accepted for now. Align Organizations to the edge case in the change that removes the deprecated port.

### R-22.8 `addComment` takes the route's body, notes and messages alike

**Proposed.** `CreateProjectCommentBody` (`kind: 'note' | 'message'`), running
`projects.project.note_add` or `.message_add` as the route does; a message tells the Project's other
Members who may see it, after the commit, for both paths.

**Rejected.** *Notes only*, as the contract's first draft's table had it — the route is one operation
for both kinds, and an integration posting into the internal thread would otherwise have no way to.

**Ruling (architect, 2026-11-26): confirmed.** The port offers the route's operation (2a.2), and the route takes both kinds. The entry records the comment id and the body's length, never the body (`audit-state.md` list 1), on both paths. The message notice still passes each recipient's visibility.
