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
| Organization | create, update, set_parent, move, delete, set_custom_field_values, convert_to_company, tax_id.change, set_credit_mode, sales_rep_assign/unassign | allow_lists_replace, allow_list_patch (`organization-restriction-service.ts`) | approved, rejected, blocked, unblocked (`organization-moderation-service.ts` `transition`, audit after commit) | sales channels (?: `routes.admin.ts` writes through `sales_channels`' membership) |
| CustomerAccount | create, change_role, set_preferred_language, remove_member, promote_organization_admin, set_subtree_rollup, custom_fields.update | block, unblock, soft-delete, restore, group assign, create standalone, anonymise (`customer-account-lifecycle-ports.ts`) | — | update_profile, email_verified (?) |
| Order | custom_fields.update, external_reference.set | status_transition (`order-transition-service.ts`), payment_status_transition (`order-service.ts`) | place_on_behalf (impersonation only) | comments (`order-comment-service.ts`, N); buyer placement (N) |
| QuoteRequest | send_document | create, create_on_behalf, patch_draft, modify, approve, assign, cancel (`rfq-service.ts`, `rfq-admin-service.ts` `#audit`) | — | admin custom-field values (?) |
| Product | create, update, archive, restore, delete, variant create/update/delete, scoped_values.save, scopes.update | — | — | — |
| Category | create, update, delete | — | — | move (?: likely `update` with a parent), inventory thresholds (N here; audited by `inventory`'s caller as `low_stock_threshold.update`) |
| Opportunity | all listed (`crm`: 33 `commandBus.run` sites, 0 hand audits) | — | — | — |
| Project | all listed (`projects`: 38 sites, 0 hand audits) | — | — | archive/restore: no such operation |
| Task | all listed except below | — | — | create many (?) |

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
value, `audit-state.md` list 1), `null` when absent. The issues' "actor kind `automation`" is read as
this pair **pending Q-1**.

**Rationale.** Principle XIII forbids an actor taken from input; `CommandActor['kind']` is
`'admin' | 'customer' | 'system' | 'api_key'` and is published (`@endora-commerce/platform`), read by
outbox rows (`actorKind`) and, after `specs/189-command-middleware/`, by middleware `meta`. A new kind is
a widening every exhaustive `switch` in a consumer must handle — itself a surface change under OD-4.
The source code answers what "automation" is meant to tell an operator: which integration acted.

**Rejected.** *A new `automation` actor kind* — see Q-1; it remains available if the owner wants the
audit screen to label it differently, as a platform change made in 189's surface rather than here.
*A free-text reason* — values are not allowed in audit state of tenant-scoped records.

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

## R-11 The published surface: kinds, tiers, directions

**Decision.** One classification, by **kind**; entries are derived per kind from the tree, never
listed (D-100). Tiers: **frozen** (no change at all), **stable** (incompatible change only after one
deprecation release), **additive-only** (only compatible additions, in the kind's direction; never a
removal, deprecated or not — a removal is a new versioned name). Directions: **read** (a consumer reads
it: HEAD must be assignable to base), **write** (a consumer writes it: base must be assignable to HEAD),
**call** (a method: base parameters assignable to HEAD parameters, HEAD return assignable to base
return). Full table: `contracts/published-surface.md`. Kinds owned by sibling specs (policy points,
command middleware, `extends`) are rows those specs fill when they land.

**Rationale.** #1820 item 4 asks for a categorised list; deriving each kind from the marker that
already makes a thing published (`Container name:`, `HookableActionRef`, `CUSTOM_FIELD_HOST_BINDINGS`)
means a new entry is covered by existing, with no list to update.

**Rejected.** *A hand-maintained list of entries* — a derived fact written down. *A per-entry `@surface`
tag* — YAGNI; nothing needs an entry tier different from its kind's.

## R-12 `check:release-intent` grows the surface comparison

**Decision.** `check:release-intent` exists (`backend/scripts/check-release-intent.ts`, CI
`quality.yml`), so #1820's premise that it does not is out of date; the surface comparison is added to
it as a new finding family, with the analysis in `@endora-commerce/cli/rules/published-surface.js` (one
analysis, two hosts — the `check:port-shape` layout). Mechanism:

1. **Base**: the highest `v*` tag reachable from HEAD (`git describe --tags --abbrev=0 --match 'v*'`),
   overridable with `--surface-base <ref>`. Unresolvable base, or an empty base population → exit 2.
2. **Populations**: each kind's derivation run on HEAD and on the base tree (read with `git show`
   / `git archive` into a temporary directory).
3. **Compatibility**: a generated probe file imports base and HEAD declarations under two names and
   asserts per entry, by direction, `[A] extends [B]`, using `Parameters<>` / `ReturnType<>` for
   methods (method syntax is bivariant otherwise); the TypeScript compiler API (already a
   devDependency) type-checks it and maps each diagnostic back to its entry. Both trees resolve
   against HEAD's `node_modules`, so a dependency's own type change (MikroORM 7) is not a finding.
4. **Deprecation**: parsed from base JSDoc — `@deprecated since <x.y.z>; use {@link …}` or
   `@deprecated since <x.y.z>; no replacement: <reason>`.
5. **Findings** (added to `ReleaseIntentFindingKind`): `surface-removed-without-deprecation`,
   `surface-changed-without-deprecation`, `frozen-surface-changed`, `additive-surface-narrowed`,
   `deprecation-unparseable`.
6. **Read size**: `[release-intent] read: … surface=<head>/<base> sources=git-tag:<tag>` per
   `check-estate.md`; estate verdict `repository-only` (the base is this repository's tag history).

**Rationale.** The owner named the instrument; it already owns the release-time questions and a git
input (`--since`). A compile probe judges compatibility as a consumer's compiler would, which a text
diff cannot (a widened union, an added optional parameter).

**Rejected.** *API Extractor* — a new dependency, a `.d.ts` roll-up model that does not know the
`Container name:` population. *A committed surface snapshot* — a generated artefact to keep fresh, which
is the trap AGENTS.md lists. *Diffing npm tarballs* — network in CI. *A textual signature diff* — false
positives on formatting, and blind to whether a change narrows or widens.

## R-13 Sanctioned breaks (pending Q-2)

**Decision, if Q-2 is answered yes.** `backend/scripts/ledgers/surface-breaks.ts`: entries
`{ entry, ruling: 'D-nnn', upgradeNote: '<anchor>' }`, two-way (an entry the comparison no longer
reports fails as stale), emptied by the release pull request that cuts the version. If Q-2 is answered
no, the ledger is not built and OD-4 holds without exception.

**Rationale.** A security fix may not wait a release; a recorded ruling beats a disabled check.

**Rejected.** *An environment variable that skips the comparison* — invisible in the diff.

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
