# Research: CRM — Sales Opportunities

**Feature**: `specs/143-crm-sales-opportunities/` · **Date**: 2026-10-05

Every decision is stated as *decision → rationale → alternatives rejected*. A statement
marked **[verified]** was established by reading the file named beside it on branch
`feat/143-crm` (base `181f36b92`). A statement marked **[unverified]** was not, and the
implementing agent must re-derive it before relying on it — a premise copied from here into
code is executed, not weighed.

## 0. What the tree says, against what the brief assumed

Seven findings that contradict or narrow the leads this design was briefed with.

| # | Lead | What the tree holds |
| --- | --- | --- |
| M1 | "`@dnd-kit` is already in the stack" | **It is not installed.** No `package.json` in the workspace names it, and `packages/admin-kit/src/components/reorder/useReorderList.ts` says so in its header: drag-reorder there is native HTML5 drag-and-drop, "the in-repo idiom". `AGENTS.md` § Stack was stale on this point **[verified]** — and becomes true with the owner's third ruling of 2026-10-05, which adds the library (R-20). The sentence in `AGENTS.md` is therefore left as it is. |
| M2 | "decide how X→Y logic is exposed … consistent with how orders does it" | `OrderTransitionService.onOrderTransitionGuard` is **not published**: it is a method on a class reachable only through `orderTransitionServiceAccessor`, and its only callers are `orders`' own tests and docs page. What other modules actually consume is the four templated EventBus events plus `order.status_changed.v1`. **[verified]** `packages/modules/orders/src/backend/services/order-transition-service.ts`, `…/events/order-status-events.ts`, `…/index.ts` |
| M3 | Quote Request statuses are configurable like Order statuses | They are a **fixed TypeScript union** — `Created from admin`, `Pending`, `Canceled`, `Approved`, `Completed`, `Expired` (`packages/modules/quote_requests/src/backend/entities/quote-request.entity.ts`; published as `QuoteRequestStatus` in `packages/contracts/src/quote-requests.ts`). **[verified]** |
| M4 | "placed Quote Requests" raise an event to subscribe to | `rfq.created.v1` is emitted by the **customer** path only (`rfq-service.ts`). `RfqAdminService.createOnBehalf` emits nothing, and completion (`order-completion-reactor.ts`) emits nothing on the EventBus either. **[verified]** |
| M5 | Customers on an Opportunity come from the `customers` module | The customer record port, `customerAccountReadPort`, is owned by **`customer_accounts`** (non-deactivatable). `customers` is the switchable admin surface over it and publishes only `CustomerAddressReadPort`. **[verified]** `packages/modules/customer_accounts/src/backend/index.ts`, both manifests |
| M6 | An existing tagging / mention / audit-trail-tab facility may exist | **None exists.** `blog` and `newsletter` each own private tag tables; no source file under `packages/admin-kit`, `packages/admin-shell` or any module's `src/admin` contains the word "mention"; the only audit reader UI is `audit_logs`' global `AuditLogViewer`, gated `audit_log:read`. **[verified]** by search |
| M7 | The `analytics` module is where CRM analytics belong | `analytics` is **storefront event tracking** (ingest, GA4 forwarding, one page). It offers no reporting framework another module can plug into. **[verified]** file listing of `packages/modules/analytics` |

Two more facts that shape the design and were not in the brief:

- **A module may not invent a sidebar section.** `AdminNavSectionNameSchema`
  (`packages/contracts/src/admin-contributions.ts`) is a closed enum and
  `packages/admin-shell/src/components/AppShell.tsx` `composeNav` throws on an undeclared one.
  The owner's ruling of 2026-10-05 (R-19) is therefore a *host* change. **[verified]**
- **`specs/135-unassigned-customer-service-policy/` is not in this repository** (pre-migration
  history). The default-assignee rule below was designed without it. **[verified]** `ls specs`

---

## R-1. Module identity and packaging

**Decision.** A new domain module `crm`, package `@endora-commerce/mod-crm`, at
`packages/modules/crm/`, MIT (the workspace default), operator-toggleable through the
manifest-declared Setting `crm.enabled` (default `true`), **not** `nonDeactivatable`.
Tables are prefixed `crm_`. Owner ruling 2026-10-05: free module in this repository, cleanly
detachable.

**Rationale.** Domain ownership, not size: no existing module owns a sales pipeline.
`quote_requests` is the nearest neighbour and is the wrong home — an Opportunity outlives and
contains Quote Requests and Orders, and must exist with neither.

**Alternatives rejected.** *Extending `quote_requests`* — makes the RFQ desk's activation
switch the CRM's. *Extending `organizations`* — `organizations` is non-deactivatable, so CRM
could never be switched off. *A plural id (`opportunities`)* — Principle VI asks for plural
snake_case, but the owner named the module `crm`, and the tree already carries acronym ids
(`seo`, `pwa`, `mfa`, `cms`). If `check:naming` refuses `crm`, that is a finding to report to
the owner, not to work around. **[unverified]** that `scripts/check-naming.sh` accepts it —
T003 measures this first.

## R-2. Workflow model

**Decision.** Mirror the Order lifecycle's two tables and one in-memory graph, with three
deliberate differences.

- `crm_opportunity_statuses` — `code` (stable, snake_case), `name` (per-language JSON),
  `default_name`, **`kind`** `open | won | lost`, **`is_initial`**, `weight`, `color`.
- `crm_opportunity_status_transitions` — `(from_status_code, to_status_code)`, unique, by
  value rather than FK, as `order_status_transitions` does.
- A pure `OpportunityStatusGraph` domain class with `has`, `canTransition`, `kindOf`,
  `initial`, `assertValid`.

Differences from orders: (1) one `kind` column instead of `isTerminal` — the owner asked for
"closes as won / closes as lost", which is an outcome, not just finality; (2) **a closing
status may have outgoing transitions** (reopen); (3) no "universal" system edges and no
`isSystem` rows — CRM has no `on_hold` / `cancelled` equivalent the platform itself depends
on.

Invariants enforced by the service on every write and by `assertValid`: exactly one initial
status, which is `open`; at least one `won` and one `lost` status; a status in use cannot be
deleted; the initial status cannot be deleted; a transition names two existing statuses.

**Rationale.** The orders shape is proven, the admin already has a component for it
(`StatusTransitionGraph` in `@endora-commerce/admin-kit/components`, used by
`OrderStatusConfigPage.tsx`), and an operator who configured one will recognise the other.

**Alternatives rejected.** *Reusing `order_statuses`* — another module's table, and Order
statuses mean something else. *A generic "workflow" module both use* — a third consumer does
not exist (Principle IV); `returns` has its own pair of tables too. *Pipelines (several
workflows)* — not asked for.

**No graph cache.** `OrderStatusGraphService` caches in process and its own header admits
cross-process invalidation is an unpaid follow-up. CRM loads the graph per operation — two
small queries, at "hundreds of opportunities per month" (constitution § Performance). No
cache means no invalidation to design. *Rejected*: a Redis-invalidated cache — a mechanism
with no measured need.

## R-3. Applying a transition, and how business logic registers on X → Y

**Decision.** `OpportunityTransitionService.apply(opportunityId, to, actor, { reason, cause })`,
in this order — every refusal before any write, as `specs/142-order-transition-atomicity/`
established for orders:

1. load the Opportunity through the tenant-scoped EntityManager (404 if absent or out of
   scope); `from === to` answers "already there";
2. consult the graph: unknown status → 422; no edge → 409 `CRM_INVALID_TRANSITION`;
3. run **before-guards** (below); a veto → 409 `CRM_TRANSITION_VETOED` with the guard's
   reason;
4. one Command (`crm.opportunity.transition`) through `CommandBus.run`: lock the row, re-check
   `status_code === from` (else re-evaluate once, then 409), write `status_code`,
   `closed_at` / `closed_kind`, append a `crm_opportunity_status_history` row, bump `version`;
5. after commit: run Order propagation (R-5) when `cause` is not `order_status`, then emit the
   after-events.

Business logic registers through **two published seams**, the same two orders has, with the
second one actually published this time (M2):

- **Events on the EventBus** (subscribe with `ctx.subscribe`) —
  `crm.opportunity.status.from_<x>_to_<y>.before`, `crm.opportunity.status.from_<x>.before`,
  `crm.opportunity.status.from_<x>_to_<y>.after`, `crm.opportunity.status.to_<y>.after`, and
  the coarse `crm.opportunity.status_changed.v1`. Names are built by one function,
  `opportunityStatusEventName`, exported from `@endora-commerce/contracts` so a subscriber
  does not spell the scheme. Before-events are passive (the bus isolates handler errors and
  cannot veto); after-events fire once the write has committed.
- **A veto-capable guard registry**, container name `opportunityTransitionGuardRegistry`,
  type `OpportunityTransitionGuardRegistryPort` in `packages/contracts/src/crm.ts`:
  `register({ ownerModuleId, match: { from?, to? }, guard })`. A guard vetoes by throwing
  `OpportunityTransitionVetoError` (exported from contracts). It is a **contribution seam** in
  the sense of `AuditReferenceRegistryPort`: registered with `ctx.di.register` (ungated),
  contributors push from `ctx.onBoot` and declare a `contributes-to` edge, and CRM skips a
  guard whose `ownerModuleId` is not effectively present at dispatch.

**Rationale.** "On the same principle as the Order status-change workflow" is exactly these
two mechanisms. Publishing the guard registry as a port is the one improvement: an overlay
module can veto an Opportunity transition without reaching for a class accessor, which is the
state orders is in today.

**Alternatives rejected.** *Events only* — cannot refuse a transition, and the owner's
reference workflow can. *Stored, operator-configured actions per transition (a rules engine)* —
far beyond "register business logic"; an overlay module is the platform's customisation seam
(Principle XV). *API interceptors on the transition endpoint* — would miss transitions made by
the board, by propagation and by the port.

## R-4. Forward direction: an Opportunity transition moves its Orders

**Decision.** `crm_order_status_mappings` rows with `direction = 'opportunity_to_order'` map
one Opportunity status to at most one Order status. After the Opportunity's transition has
committed, for every link with `document_kind = 'order'` and `sync_status = true`, CRM calls
`orderTransitionPort.applyStatus({ orderId, to, actor, reason })`
(`OrderTransitionPort`, `packages/contracts/src/orders.ts`) and **records each
`OrderTransitionOutcome` as a row** in `crm_status_propagations` — `applied`,
`already_there`, `not_found`, `unknown_status`, `not_permitted`, `vetoed`, with the port's
`detail`. The transition response returns the list; the detail screen shows unresolved
refusals with *Retry* and *Dismiss*.

- **Multi-order rule.** Every sync-enabled linked Order is asked, independently; one refusal
  does not stop the others. An Order already in a terminal Order status simply answers
  `not_permitted`.
- **Veto / refusal.** Surfaced, persisted, retryable — never swallowed and never rolled back
  into the Opportunity. The port's contract forbids calling it inside the caller's
  transaction ("Call this after your own commit", issue #200), so all-or-nothing is not
  available without changing orders; and it would let any module's Order guard freeze the
  pipeline.
- **`ModuleDisabledError` is not caught.** `orders` is non-deactivatable, so the gate is
  unreachable, but no `catch` is written around the port call (`check:port-catches`).
- **Actor.** `{ kind: 'admin', adminUserId }` for a user-initiated transition, `{ kind:
  'system' }` otherwise. `OrderStatusActor.source` is a closed union without a CRM member and
  is left alone.
- **A row is written `pending` before the call** and resolved after it. That row is also the
  echo marker R-5 needs, and it means a crash between commit and call leaves evidence, which
  *Retry* consumes.

**Alternatives rejected.** *Assigning `order.status`* — the bypass feature 085 exists to
remove. *Propagating inside the Opportunity's transaction* — see above. *A pre-flight "would
it apply?"* — the port has no such method; adding one is a change to orders for a convenience.
*A durable queue for propagation* — a handful of in-process port calls per transition; the
`pending` row plus *Retry* covers the failure case without a consumer (Principle IV; Principle
X's invariant applies only once work is queue-backed).

## R-5. Reverse direction: an Order status moves its Opportunity

**Decision — in scope, as User Story 2.** The owner wrote "mapping Order statuses to
Opportunity statuses", which read literally *is* this direction; the success criterion needs
the other one. Both are one table with a `direction` column, so the reverse costs a subscriber
and a rule, not a second model.

- Subscribe (`ctx.subscribe`) to **`order.status_changed.v1`** — the coarse event every status
  change emits, whoever caused it (`emitOrderStatusAfter` is used by the transition service
  and, through `orderStatusAnnouncePort`, by `payments` and `shipments`). **[verified]**
- Look up the link for `orderId`; no link, `sync_status = false`, or a closed Opportunity →
  stop. Look up the mapping `order_to_opportunity` for `to`; none → stop.
- **Multi-order rule**: the mapping row carries `require_all_orders`. `false`: move as soon as
  this Order arrives. `true`: move only when every sync-enabled linked Order is in a status
  whose reverse mapping names the same Opportunity status. The UI defaults it to `true` when
  the target status closes the Opportunity.
- Apply through the same `OpportunityTransitionService` with `actor: system`, `cause:
  'order_status'`, `causeOrderId` — graph and guards included. A refusal is recorded as a
  `crm_status_propagations` row with `direction = 'order_to_opportunity'`.

**Loop prevention — one hop, enforced twice.**

1. *Echo suppression.* When the subscriber sees `order.status_changed.v1` for `(orderId, to)`
   and a `crm_status_propagations` row exists for that order and target with `direction =
   'opportunity_to_order'` and `outcome IN ('pending','applied')` not yet marked `echoed`, it
   marks it `echoed` and stops. The change is CRM's own.
2. *Cause check.* A transition applied with `cause = 'order_status'` skips step 5's forward
   propagation entirely. A change that came from an Order never pushes other Orders.

Both directions are idempotent at the edges as well (`already_there` on the port; "already
there" in the service), so even a misconfigured pair of mappings terminates.

**Alternatives rejected.** *Deferring the reverse direction* — leaves the owner's sentence
unimplemented. *Marking CRM's calls with an actor `source: 'crm'` and filtering on it* — needs
a contracts change to a closed union, and the coarse event does not carry the actor at all.
*Letting mappings cascade to a fixed point* — unbounded under an inconsistent configuration.
*Subscribing to the templated `order.status.to_<y>.after` names* — the mapping is data, so the
names are not known when subscribers are registered.

## R-6. Links to Orders and Quote Requests

**Decision.** One table, `crm_opportunity_links`, polymorphic on `document_kind`
(`order | quote_request`) + `document_id`, unique on that pair, so a document belongs to at
most one Opportunity. Linking validates through the owner's port — `orderReadPort.findById`,
`quoteRequestReadPort.findById` — under the caller's tenant scope, and refuses a document of
another Organization (`CRM_LINK_ORGANIZATION_MISMATCH`). No foreign key to `orders` or
`quote_requests`: the column is polymorphic, and the ports are the integrity check.

**Rationale.** "Which Opportunity does this Order move?" must have one answer (R-5). The
same-Organization rule is what keeps a link from becoming a cross-tenant window: both
`Order` and `QuoteRequest` are `@OrgScoped`.

**Alternatives rejected.** *Two link tables* — two of everything for no difference in
behaviour. *Many-to-many* — makes reverse propagation ambiguous. *A `crm_opportunity_id`
column on `orders`* — another module's schema (Principle I), and orders would not behave
identically with CRM absent.

## R-7. Creating an Order / Quote Request from an Opportunity

**Decision — an opaque, optional `origin` reference, echoed on an event.** This is the one
place CRM needs the owning modules to change, and the change is generic: neither module
learns the word "crm".

- `packages/contracts/src/common.ts` gains `OriginReferenceSchema = { type: string
  (snake_case, ≤ 64), id: uuid }`.
- **orders**: `adminCreateOrderRequestSchema` accepts optional `origin`;
  `OrderCreationAdminService.create` passes it to `OrderService.placeOrder` as a new optional
  third argument; `placeOrder` adds `origin` to the payload of the **existing**
  `order.created.v1` event when present. Nothing is persisted and nothing is read by orders.
  `OrderPlacementPort.placeOrder(ctx, req)` is unchanged.
- **quote_requests**: `adminCreateQuoteRequestSchema` accepts optional `origin`;
  `RfqAdminService.createOnBehalf` emits a **new** event `rfq.created_by_admin.v1`
  `{ rfqId, organizationId, adminUserId, origin }` (M4: the admin path emits nothing today, and
  starting to emit `rfq.created.v1` there would change what existing subscribers see).
- **Admin screens**: `OrderCreatePage.tsx` and `RfqCreatePage.tsx` read `originType`,
  `originId` and `customerAccountId` from the URL query string, preselect the customer, and
  forward `origin` in the create request. CRM's Opportunity screen navigates to
  `/orders/new?originType=crm_opportunity&originId=<id>&customerAccountId=<id>` and
  `/quote-requests/new?…`.
- CRM's `order.created.v1` / `rfq.created_by_admin.v1` subscribers link the document when
  `origin.type === 'crm_opportunity'`, after re-checking the Opportunity exists and belongs to
  the same Organization.

**Why the event must carry it, and not a second event after it.** `order.created.v1` is also
what automatic creation (R-8) listens to. If the origin arrived on a later event, the
auto-create subscriber would already have created a second Opportunity for an Order that was
being created *from* one. One event, one decision, no race, no heuristic.

**With CRM off**, `origin` is validated, carried and read by nobody: orders and quote_requests
behave identically (FR-070, SC-003). With CRM *absent from the build*, the same.

**Files outside `packages/modules/crm` this touches** (named again in `plan.md` and
`contracts/foreign-module-changes.md`):
`packages/contracts/src/common.ts`, `packages/contracts/src/orders.ts`,
`packages/contracts/src/quote-requests.ts`,
`packages/modules/orders/src/backend/routes.ts`,
`packages/modules/orders/src/backend/services/order-creation-admin-service.ts`,
`packages/modules/orders/src/backend/services/order-service.ts`,
`packages/modules/orders/src/admin/pages/OrderCreatePage.tsx`,
`packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts`,
`packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx`, and both modules' docs
pages.

**Alternatives rejected.**

- *A server-side "creation intent" in CRM, matched to the next order the same admin places for
  the same Organization* — changes nothing in orders, and links by guesswork: an abandoned
  attempt followed by an unrelated order links the wrong document, silently.
- *A client-side hand-back (the create screen returns to the Opportunity with the new id and
  CRM links it)* — a closed tab loses the link, and with automatic creation on the Order has
  already been given a second Opportunity by the time the hand-back arrives.
- *A `post` API interceptor on `POST /api/v1/admin/orders`* — the platform's contract for the
  post phase is "MUST be side-effect-free with respect to persistence"
  (`packages/platform/src/http/interceptors/types.ts`).
- *CRM's own order-builder calling `orderPlacementPort`* — duplicates a 30 KB screen
  (Principle IX) and the admin placement logic in `OrderCreationAdminService`.
- *An `opportunity_id` field on the create request* — teaches orders about CRM.

## R-8. Automatic creation

**Decision.** Two module Settings declared in the manifest, both `boolean`, default `false`,
read through `settingsReadPort` with the document's Sales Channel:
`crm.auto_create_from_orders`, `crm.auto_create_from_quote_requests`. Three subscribers, all
through `ctx.subscribe` (so they stop when CRM is off):

| Event | Behaviour |
| --- | --- |
| `order.created.v1` | (a) `origin` names an Opportunity → link (R-7). (b) else the Order's `sourceQuoteRequestId` is linked to an Opportunity → link the Order to it, `link_source = 'quote_conversion'` (FR-027) — **regardless of the setting**. (c) else, setting on → create an Opportunity and link. |
| `rfq.created.v1` | setting on → create and link. |
| `rfq.created_by_admin.v1` | `origin` names an Opportunity → link; else setting on → create and link. |

A created Opportunity gets `source = 'order' | 'quote_request'`, the start status, the
document's Organization, the Order's Sales Channel, the default assignee (R-9), title
"`<document number>` — `<organization name>`", `value_mode = 'computed'`. Idempotent by the
unique `(document_kind, document_id)` constraint: a redelivered event finds the link and
stops.

**Rationale.** The brief's shape exactly; (b) is what makes User Story 8's "counted once"
reachable and costs one lookup.

**Alternatives rejected.** *Settings stored in a CRM table* — the owner asked for the Settings
module. *Back-filling existing documents when the setting is switched on* — an operator
flipping a checkbox should not create a thousand Opportunities; a back-fill is an explicit
action nobody asked for.

## R-9. Sales Reps and the default assignee

**Decision.** `assigned_admin_user_id` (nullable uuid) on the Opportunity. The default at
creation, when the request names none:

1. `salesRepAssignmentPort.listForOrganization(organizationId)` (`SalesRepAssignmentPort`,
   owner `organizations`);
2. keep assignments whose admin user is `active` (`adminUserReadPort.findByIds`);
3. the creating admin, if among them; else the row with the earliest `createdAt`; else `null`.

The assignee picker is `AdminUserPicker` from `@endora-commerce/admin-kit/components`. Any
active Admin UI user may be assigned. Visibility is **not** by assignee: it is the tenant
guard's (R-12), so a rep restricted to certain Organizations sees those Organizations'
Opportunities whoever holds them.

Assignment and reassignment notify the new assignee through `adminNotificationRecordPort`
(R-11).

**Alternatives rejected.** *A CRM-owned "sales rep" entity* — the platform already has the
relation. *Restricting assignees to holders of a CRM permission* — no published port answers
"which admins hold code X" **[unverified]**, and an assignee without the permission is visible
at once in the UI. *Round-robin* — not asked for.

## R-10. Notes, messages

**Decision.** One table, `crm_opportunity_comments`, with `kind = 'note' | 'message'`. A note
is editable and soft-deletable by its author; a message is immutable. Both are internal —
there is no customer-visible flag at all, unlike `order_comments`.

**Rationale.** `OrderComment` (`packages/modules/orders/src/backend/entities/order-comment.entity.ts`)
is the precedent for shape (author, body, timestamp), but its purpose is the customer
conversation, and the owner asked for messages "between Sales Reps and Platform
Administrators". One table because the two differ in two behaviours, not in data.

**Alternatives rejected.** *Reusing `order_comments`* — another module's table. *Two tables* —
the mention extraction, the history writes and the list endpoint would all be written twice.
*Threads / replies / read receipts* — not asked for.

## R-11. Notifications

**Decision.** `adminNotificationRecordPort.record({ audience: 'admin_user', targetAdminUserId,
kind, subjectType: 'crm_opportunity', subjectId, title, linkPath })`
(`AdminNotificationRecordPort`, owner `admin_notifications`, which **is switchable**). Declared
as `nonBindingDependencies` → `degrades-without`: CRM asks
`effectiveState.isPresent('admin_notifications')` first and skips the notification when it is
off. Kinds: `crm.opportunity.assigned`, `crm.opportunity.message`.

`title` is a finished English sentence today because the port has no key/params shape; that is
`specs/093-backend-delivered-prose/`'s open work for every caller of this port, and CRM joins
the existing population rather than inventing a private fix. `check:default-language-prose`
only refuses non-English literals, so the English sentence passes. **[unverified]** whether
feature 093 has landed a key/params variant since; T069 checks before writing the call.

**Alternatives rejected.** *E-mail* — needs templates, recipients' addresses and an opt-out;
the owner asked for messages "in the Admin UI". *A hard dependency on `admin_notifications`* —
would stop an operator switching the bell off while CRM is on, for a courtesy.

## R-12. Tenant isolation (Principle XI)

**Decision.** `CrmOpportunity` is **`@OrgScoped()`** on `organization_id`, non-nullable.

It is an admin-side record *about* an Organization, and that is precisely how the two closest
precedents are classified: `QuoteRequest` and `CreditLimit` are both `@OrgScoped`. The global
filter then gives a scoped admin (a Sales Rep with an allowed-Organization set) exactly the
Opportunities of the Organizations they may see, and an unscoped admin all of them, with no
`where` written by hand. Cross-tenant access is indistinguishable from "does not exist"
(FR-006).

Every child table — links, status history, propagations, comments, attachments, tag joins,
references — is **`@TransitivelyScoped('CrmOpportunity', 'opportunityId')`**. The chain stays
inside one module, so the name-addressed parent resolves trivially. Services never fetch a
child by its own id alone: they load the parent Opportunity through the filtered
EntityManager first, then the child by `(opportunityId, id)`.

`CrmOpportunityStatus`, `CrmOpportunityStatusTransition`, `CrmOrderStatusMapping`,
`CrmValueCountingStatus` and `CrmTag` are **`@GlobalEntity()`** — platform-wide
configuration, as `OrderStatus` is.

Raw SQL (the analytics queries, usage counts) is not covered by the entity filter and takes
its constraint from `orgConstraintFor()`, as `order-status-usage.ts` does.

Subscribers run without a request; they enter a system scope with `enterSystemScope(reason,
…)` from `@endora-commerce/platform/kernel` and constrain by `organizationId` themselves
(ruling D-285, `specs/conventions/module-composition.md` item 10a). `withOrgScope` is not
available to a module.

**Alternatives rejected.** *`@GlobalEntity` with route-level checks* — the four-surface leak
Principle XI was written from. *`@GlobalEntity` children, as `OrderComment` and
`ReturnCaseAttachment` are* — legacy classifications; a new module has no reason to copy the
weaker form. *A nullable Organization ("lead")* — a no-organization path is invalid by
Principle XI.

## R-13. Sales Channel (Principle XII)

**Decision.** A nullable `sales_channel_id` on the Opportunity: an *attribution* an admin sets
or that automatic creation copies from the Order, used as a list/board/analytics filter. It is
not channel-scoped content — nothing storefront-facing reads it, no `sales_channel_*` bridge is
involved, and an admin who filters by no channel sees all Opportunities by design. "No
channel" is `null`, never a default (D-47…D-51, as `QuoteRequest.salesChannelId` documents).

CRM contributes a counter to `salesChannelAttributionRegistry` (`contributes-to`
`sales_channels`), as `quote_requests` does, so the channel-delete guard sees Opportunities
attributed to a channel. The column has a foreign key to `sales_channels(id)` `on delete
restrict`. **[unverified]** the exact descriptor shape — T050 reads
`packages/modules/quote_requests/src/backend/services/sales-channel-attributions.ts`.

**Alternatives rejected.** *Scoping Opportunities to the request's resolved channel* — admin
requests resolve a channel for content, not for which sales work a rep may see.

## R-14. Opportunity value

**Decision.** Three columns — `value_mode` (`manual | computed`), `manual_value`,
`computed_value` — plus `currency`. The API exposes one `value`. `computed_value` is a
**stored** figure maintained by `OpportunityValueService.recalculate(opportunityId)`:

- sum of `OrderRecord.total` for linked Orders whose `status` is in
  `crm_value_counting_statuses` (`document_kind = 'order'`) and whose `currency` matches;
- plus, for linked Quote Requests whose status is in the counting set, Σ over
  `quoteRequestReadPort.listItems` of `quantity × (agreedUnitPrice ?? desiredUnitPrice ?? 0)`
  for lines whose `lineCurrency` matches — **skipping** a Quote Request whose
  `convertedOrderId` is itself a linked, counting Order (FR-033);
- documents left out for currency are returned as `excludedDocuments`.

Recalculation triggers: link / unlink; `order.status_changed.v1`; `rfq.approved.v1`,
`rfq.canceled.v1`, `rfq.modified.v1`, `rfq.expired.v1`; `order.created.v1` for a quote
conversion; a mode change. A change to the counting configuration recalculates **every**
computed-mode Opportunity through a BullMQ queue, `crm-value-recalculation`, consumed by a
worker registered with `ctx.worker` — the producer (the configuration endpoint) only enqueues
(Principle X).

**Open points the implementer must settle by reading, not by trusting this paragraph:**
**[unverified]** how `RfqDetail.tsx` / `RfqService` total a quote (whether packaging base
quantity multiplies the line) — the CRM figure must equal what the quote desk shows;
**[unverified]** whether `OrderRecord.total` is gross — it is used as published either way and
the docs page says which.

**"From which status onward."** A set, not a threshold: statuses form a graph. The
configuration UI offers "this status and every later one by display order" as a shortcut that
fills the set.

**Alternatives rejected.** *Computing on every read* — the list, the board totals and the
analytics all sort and aggregate by value, which would mean N port calls per row. *Currency
conversion* — no rate source was found in the tree **[unverified by exhaustive search]**, and
inventing one is a feature. *A per-status "counts" flag on Order statuses* — a column on
another module's table.

## R-15. Attachments

**Decision.** Files live in `assets_library`. The admin uploads with the existing
`AssetUploader` / `FileDropzone` from `@endora-commerce/admin-kit/components` and sends the
resulting `assetId` to CRM, which stores a `crm_opportunity_attachments` row — the
`ReturnCaseAttachment` pattern. CRM registers an asset-reference descriptor in
`assetReferenceRegistry` from a contribution-only `ctx.onBoot` (no presence probe — D-67/D-68),
as `blog`, `cms`, `catalog` and `megamenu` do, so the library refuses to delete a file an
Opportunity uses (FR-044). Download goes through the library's own URL for the asset.

**[unverified]**: the visibility an uploaded file gets by default (`private` vs public) and
how an admin fetches a private one — T080 reads `assets-api.ts` and the returns flow, and the
attachment must be uploaded **private**.

**Alternatives rejected.** *CRM-owned storage* — a second storage backend. *Storing the
bytes in Postgres* — no.

## R-16. Change history

**Decision.** The audit log is the history. Every CRM write is a Command
(`CommandBus.run`), and every Command about an Opportunity **or anything hanging on it** is
recorded with `objectType: 'crm_opportunity'` and `objectId: <opportunity id>`, the action
naming what happened (`crm.opportunity.update`, `.transition`, `.assign`, `.link_add`,
`.link_remove`, `.tag_set`, `.note_add`, `.note_update`, `.note_delete`, `.message_add`,
`.attachment_add`, `.attachment_remove`, `.value_mode_set`). The tab is served by CRM's own
endpoint, `GET /api/v1/admin/crm/opportunities/:id/history`, gated `crm:read`, which first
loads the Opportunity through the tenant filter and then calls the kernel's
`AuditPort.query({ objectType, objectId })` — the cradle name `auditLogService`, the port
`audit_logs`' own route uses. Actor names are resolved with `adminUserReadPort.findByIds`.

CRM also registers an `AuditReferenceResolver` for `crm_opportunity` in
`auditReferenceRegistry` (`contributes-to` `audit_logs`) so the dashboard's recent-activity
card names an Opportunity by title and links to it.

`crm_opportunity_status_history` is **not** the history tab's source. It exists because
analytics need per-status intervals as rows (R-18), which a JSON before/after pair in the
audit log does not give cheaply.

**Rationale.** Principle XIII makes the audit entry co-transactional with the write, so the
tab cannot disagree with the data. A CRM-owned events table, as `quote_request_events` is,
would be a second writer of the same facts.

**Alternatives rejected.** *Sending the user to `/audit-log?filter[objectId]=…`* — needs
`audit_log:read`, which a Sales Rep should not need, and shows raw rows. *A CRM timeline
table* — double bookkeeping. *An admin-kit `<AuditTrail>` component* — none exists (M6);
building a shared one for one consumer is premature, so the tab is a CRM component, written so
it can be promoted when a second module wants it (Principle IX).

## R-17. Dependencies and what happens when an owner is off

**Decision.**

| Owner | Edge | Declared as | Why |
| --- | --- | --- | --- |
| `orders` | `orderReadPort`, `orderTransitionPort`; events | `dependencies` | non-deactivatable; core of the feature |
| `organizations` | `organizationDetailsPort`, `salesRepAssignmentPort`; FK | `dependencies` | non-deactivatable; FK forces it |
| `customer_accounts` | `customerAccountReadPort` | `dependencies` | non-deactivatable (M5) |
| `catalog` | `catalogProductReadPort` | `dependencies` | non-deactivatable |
| `admin_users` | `adminUserReadPort` | `dependencies` | non-deactivatable |
| `auth` | `requireAdmin` | `dependencies` | every admin route |
| `settings` | `settingsReadPort` | `dependencies` | module settings |
| `sales_channels` | FK; `salesChannelAttributionRegistry` | `dependencies` | FK forces it |
| `assets_library` | `assetReferenceRegistry` | `dependencies` | non-deactivatable; attachments |
| `audit_logs` | `auditReferenceRegistry` | `nonBindingDependencies` · `contributes-to` | push only |
| `admin_notifications` | `adminNotificationRecordPort` | `nonBindingDependencies` · `degrades-without` | switchable; R-11 |
| **`quote_requests`** | `quoteRequestReadPort`; `rfq.*` events | **`nonBindingDependencies` · `degrades-without`** | switchable — see below |

**`quote_requests` is declared non-binding, and this deviates from the letter of the owner's
list** ("Dependencies: Orders, Quote Requests, …"). `quote_requests` is operator-switchable.
A `dependencies` entry would make `/platform/modules` refuse to switch the RFQ desk off while
CRM is on, naming CRM as the blocker — for a shop that sells without quotes and wants a
pipeline, that is a dead switch. With `degrades-without`, CRM checks
`effectiveState.isPresent('quote_requests')` before each read and, when it is absent: linked
Quote Requests render as unavailable, contribute nothing to a computed value, and the link /
create actions for Quote Requests are not offered. The `rfq.*` subscribers need no check — an
absent module emits nothing. `whenAbsent` states this sentence for the operator's dialog.

`customers` (the switchable admin surface) is **not** declared: CRM resolves no port it owns.
The admin's `CustomerPicker` calls its API, which is a UI coupling expressed as an advisory
`requires` on the permission, not a lifecycle edge.

**Alternatives rejected.** *Binding `quote_requests`* — see above; the owner confirmed the
non-binding edge on 2026-10-05 (Q1). *`acknowledgedDependencies`* — exists to break
manifest cycles; there is none here (`orders` and `quote_requests` do not declare `crm` and
must never).

## R-18. Analytics

**Decision.** A CRM-owned page and five read endpoints over CRM's own tables, charts through
the existing `<EChart>` wrapper (`@endora-commerce/admin-kit/components`,
`packages/admin-kit/src/components/charts/echart.tsx`; `echarts` is already a peer of
`mod-newsletter`, so it is not a new dependency). Queries are SQL aggregates constrained by
`orgConstraintFor()`:

| Figure | Source |
| --- | --- |
| average handling time | `avg(closed_at − created_at)` over Opportunities closed in range |
| average time in selected statuses | `crm_opportunity_status_history`: interval from an entry to the next entry of the same Opportunity (or `now()`), grouped by status |
| most effective reps | count of Opportunities with `closed_kind = 'won'` by `assigned_admin_user_id` per calendar month |
| most valuable Opportunities | top N by effective value, created or closed in range |
| average value | `avg(effective value)` in range, per currency |

Computed live — a month of a thousand rows is a sub-second aggregate on indexed columns
(SC-007); no materialised table.

**Alternatives rejected.** *Feeding the `analytics` module* — it is storefront event tracking
(M7). *A dashboard widget on the admin home* — no generic widget zone was found
**[unverified by exhaustive search]**; out of scope. *Pre-aggregated tables* — no measured
need.

## R-19. Navigation: a "CRM" group of its own (owner ruling, 2026-10-05)

**Decision.** A new sidebar section **`crm`**, declared by the host, joined by CRM's five
entries: Opportunities (100), Board (200), Analytics (300), Tags (400), Workflow (500).

**It cannot be done from inside `packages/modules/crm`.** Three files outside the module
change, and the plan and tasks name them:

1. `packages/contracts/src/admin-contributions.ts` — add `'crm'` to
   `AdminNavSectionNameSchema` (a closed enum; a contribution naming an unknown member fails
   schema validation).
2. `packages/admin-shell/src/components/AppShell.tsx` — add `{ key: 'crm', labelKey:
   'appShell.section.crm', items: [] }` to `NAV`, **after `sales` and before `catalog`**
   (`composeNav` throws for a section the shell does not declare).
3. `packages/modules/_i18n/i18n/en.json` and `pl.json` — `appShell.section.crm`: "CRM" in
   both. The section heading is resolved in the `core` scope, which is `_i18n`'s bundle, not
   the module's.

**Off-state.** `AppShell` renders a section only when it has a visible item
(`if (visibleItems.length === 0) return null;`), so with CRM off — or for a user holding no
CRM permission — the heading does not render. The section is the host's; the module
contributes entries, which is what D-23 ("a module may not invent a section") protects. The
ruling adds a host section, it does not let a module invent one.

**Recorded follow-up, not to do now.** If the group ends up holding one or two links, the
owner will have them moved into *Sales*: change `section: 'crm'` to `'sales'` in
`packages/modules/crm/src/admin/index.ts` and remove the three edits above.

**Alternatives rejected.** *Placing the entries under `sales`* — the owner ruled against it.
*Letting the manifest declare a section* — reopens D-23 for every module.

## R-20. Board view — on `@dnd-kit`, as a reusable admin-kit primitive (owner ruling, third round)

**History.** This entry first chose native HTML5 drag-and-drop with no new dependency; the
owner accepted that in the second round of 2026-10-05 and **reversed it the same day**: add
`@dnd-kit`, because "it may be useful not only in this module but in the future too".

**Decision.**

- **One new runtime dependency: `@dnd-kit/core`** — and only it. Latest stable on the public
  registry on 2026-10-05: **`6.3.1`, MIT**, peers `react >=16.8.0` and `react-dom >=16.8.0`
  (so React 19 is inside the declared range), own dependencies `@dnd-kit/accessibility`,
  `@dnd-kit/utilities`, `tslib` **[verified]** with `pnpm view`. Range: `^6.3.1`.
  **[unverified]** that it behaves correctly at runtime under React 19 — T148's tests are the
  proof, and they are written before anything depends on the primitive.
- **Not `@dnd-kit/sortable`** (`10.0.0`, MIT). It orders items *within* a list; an Opportunity
  has no position inside its column (no column in `data-model.md` stores one), so nothing
  would use it. A future consumer that needs ordered lanes adds it then, with its own
  justification. Not `@dnd-kit/utilities` or `@dnd-kit/accessibility` by name either: they
  arrive transitively and the primitive imports from `@dnd-kit/core` only.
- **Where it lives: `packages/admin-kit`, not the CRM module.** A generic, domain-free
  `KanbanBoard` under `packages/admin-kit/src/components/kanban/`, exported from the
  `@endora-commerce/admin-kit/components` barrel (the barrel `EChart` and the reorder helpers
  are exported from, and one a module's admin layer may name). It knows nothing about
  Opportunities, statuses or the API: columns, items, `canDrop(item, column)`,
  `onMove(item, from, to)`, `renderCard`, `renderColumnHeader`, and translated announcement
  labels are all props.
- **How the dependency is declared** — the pattern `echarts` already follows **[verified]**
  in the three manifests: `peerDependencies` **and** `devDependencies` of
  `packages/admin-kit/package.json` (hand-maintained), and `dependencies` of
  `admin/package.json` (the application supplies the one copy every package resolves). The
  CRM package imports `@endora-commerce/admin-kit/components` and never `@dnd-kit/*`, so
  `manifests:generate` renders **no** `@dnd-kit` peer into `mod-crm` — which is the point of
  the placement. **[unverified]** whether any other consumer of `admin-kit` in this workspace
  (`packages/admin-shell`, the docs site, `create-endora-commerce`'s template) must also
  declare the new peer for `pnpm install --frozen-lockfile` to stay quiet — T149 measures it.
- **The "Move to…" menu stays, and it is CRM's, not the primitive's.** `@dnd-kit`'s
  `KeyboardSensor` makes dragging keyboard-operable (WCAG 2.1.1) and its touch handling
  repairs what native drag-and-drop lacks, but **WCAG 2.2 SC 2.5.7 (Dragging Movements, AA)
  asks for a way to do the same with a single pointer *without dragging*** — a keyboard
  alternative does not satisfy it. So every card keeps a menu listing exactly the transitions
  the workflow permits, calling the same endpoint. It lives in CRM's card (`renderCard`),
  because what the targets are is domain knowledge; the primitive's documentation states that
  a consumer owes such an alternative.
- Sensors: `PointerSensor` with a small activation distance (so a click on the card's link or
  menu is not a drag), `KeyboardSensor`, and `DragOverlay` for the lifted card; announcements
  through the library's live region with labels the consumer passes in both languages.

**`AGENTS.md` § Stack** says "`@dnd-kit` for drag-drop". It was false when this design
started (M1) and is true once T149 lands; the sentence is not edited.

**Rationale.** The owner wants a reusable capability; a reusable capability belongs in the
design system (Principle IX: "a new primitive that earns its place SHOULD be promoted"), and a
dependency declared only by one detachable module would disappear with it.

**Alternatives rejected.** *Native HTML5 drag-and-drop* (the earlier choice) — no reliable
touch support, no keyboard operation of the drag itself, and the owner ruled it out.
*Declaring `@dnd-kit` in the CRM package only* — a second board elsewhere would import a
module, or declare it again. *`@dnd-kit/sortable` now* — unused. *Converting the existing
`useReorderList` to `@dnd-kit` in this feature* — a refactor of working code nobody asked
for; a candidate once the library has proved itself here. *A different library
(`react-beautiful-dnd`, `pragmatic-drag-and-drop`)* — the owner named this one, and the first
is unmaintained.

## R-21. References (mentions) to Products and Orders

**Decision.** No editor facility exists (M6), so the smallest thing that satisfies FR-045:

- **Storage**: plain text with tokens — `[[product:<uuid>]]`, `[[order:<uuid>]]` — in
  `description` and in comment bodies. No HTML is stored or rendered.
- **Write**: the service extracts tokens with one regular expression, validates each id's
  shape, and replaces the `crm_opportunity_references` rows for that source
  (`source_kind = 'description' | 'comment'`, `source_id`).
- **Read**: the API returns the text unchanged plus `references: [{ type, id, label, url,
  available }]`, resolved in two batched port calls (`catalogProductReadPort.findByIds`,
  `orderReadPort.findByIds`) under the reader's scope. A record the reader cannot see or that
  is gone is `available: false` with no label (User Story 12, scenario 2).
- **Compose**: a `ReferenceTextarea` in the module — a `<Textarea>` with two buttons,
  "Insert product" (the existing `ProductPicker`) and "Insert order" (a search over the Orders
  admin list endpoint), inserting the token at the caret. Rendering splits text on tokens and
  draws chips that link to `/catalog/products/:id` and `/orders/:id`.

**Alternatives rejected.** *A rich-text editor with `@`-autocomplete* — a new dependency
(TipTap / Lexical class) for two reference types. *The Puck page builder already in the admin* — a page builder, not a text field.
*Resolving labels at write time* — a renamed Product would show its old name forever.
*`prompt_actions` / the command palette* — neither is a text-composition facility.

## R-22. Integration stance for the remaining cross-cutting modules

| Module | Stance | One line |
| --- | --- | --- |
| `custom_fields` (Principle XIV) | **Now** (owner, 2026-10-05 second round) — R-26 | Was *Later*, for the Principle XVII leak a closed host-type enum causes. R-26 closes the leak with one generic field on the host registry instead of waiting for a manifest-contributed registry. |
| `import_export` | **Later** — re-examined, still deferred | **Not a one-declaration integration.** `packages/modules/import_export/src/backend/index.ts` constructs one `ImportExportService` over a fixed set of other modules' ports (catalog, inventory, orders, customer accounts, organizations) and keeps each record type's handling inside itself **[verified]** for the composition, **[unverified]** for the service's internals. Adding Opportunities means editing that module and giving it an edge to `crm`; the right first step is a contribution registry there, which is its own feature. |
| `webhooks` | **Now** (owner, 2026-10-05 second round) — R-27 | Was *Later* on the premise that exposing an event is "the webhooks module's catalogue entry". **There is no catalogue**: two hard-coded lists (R-27). |
| `transactional_emails` | **Not** | Messages and assignment use the admin bell (R-11); nothing here addresses a customer. |
| `search` (Meilisearch) | **Not** | The list filters in Postgres on indexed columns at this volume; an index is a second copy to keep tenant-scoped. |
| `prompt_actions` | **Later** | Assistant tools ("move opportunity X to won") are a `contributes-to` push into `promptActionToolRegistry` once the transition port exists (User Story 14 publishes it). |
| `admin_actions` (palette) | **Now** | Two manifest `actions` (R-23). |
| `audit_logs` | **Now** | Commands + reference resolver (R-16). |
| `assets_library` | **Now** | R-15. |
| `admin_notifications` | **Now**, degrading | R-11. |
| `organizations` admin screen | **Now** | A panel in the existing `organization.detail.after` zone (User Story 14) — no change to `organizations`. |
| `orders` and `quote_requests` admin screens | **Now** (owner, 2026-10-05 second round) — R-28 | Was *Later* because no suitable zone exists. The owner asked for it; R-28 adds the zone, and one for the Quote Request screen. |

## R-23. Permissions, palette, i18n, docs

**Permissions** (manifest `permissions`, labels in `packages/modules/crm/i18n/{en,pl}.json`
under `adminRoles.permission.<code>`):

| Code | Gates | `requires` (advisory) |
| --- | --- | --- |
| `crm:read` | list, board, detail, history, attachments download | `orders:read` (linked Orders' details, the order search) |
| `crm:write` | create, edit, transition, assign, link, tag, notes, messages, attachments | `crm:read` |
| `crm:configure` | statuses, transitions, mappings, counting statuses, tag CRUD, delete an Opportunity | `crm:read` |
| `crm:analytics` | the analytics page and endpoints | `crm:read` |

**[unverified]**: the exact codes `orders` and `customers` gate their search endpoints with —
T019 reads them before writing `requires`.

**Palette** (manifest `actions`; curated, Principle XVI): `open-opportunities` →
`/crm/opportunities` (`crm:read`), `new-opportunity` → `/crm/opportunities/new`
(`crm:write`), `open-opportunity-board` → `/crm/board` (`crm:read`). Icons from the existing
`KnownIconNameSchema` only — `CircleDollarSign`, `PlusCircle`, `PanelLeft`, `LineChart`,
`Tag`, `ListChecks` — so no icon-map edit is needed.

**i18n.** Flat `en.json` + `pl.json` at the package root. Backend prose: error sentences under
`errors.<CODE>` for the module's declared `errorCodes`; audit action labels under
`auditLog.<action>`.

**Docs.** `packages/modules/crm/docs/crm.md` (English), declared `docs: { dir: 'docs' }`, plus
the Polish materialised copy under `docs/i18n/pl/` per
`docs/docs/contributing/documentation-i18n.md`. Sibling modules are named in prose, never
linked relatively (`foreign-module-link`, `site-tree-link`).

## R-24. Demo data

**Decision.** The manifest declares `demo: false` until User Story 14, which replaces it with
a real declaration (`{ summary, seed, reset, after: ['organizations', 'orders', …] }`) seeding
about a dozen Opportunities across the default statuses for the demo Organizations, a few
linked to demo Orders. Absent is not an option: absent means "nobody has decided".

**Rationale.** Owner, 2026-09-06: demo data is optional — but the demo instances run every
module, and an empty board demonstrates nothing. Shipping it last keeps the MVP small.

## R-25. Default data and roles

**Decision.** The default workflow is **seeded by CRM's own init migration** into CRM's own
tables (a migration may write its owner's rows; `module-migrations.md` item 4a restricts
writes to *other* modules' tables): `new` (initial, open), `qualified`, `proposal`,
`negotiation` (open), `won` (won), `lost` (lost), with forward transitions, every open status
→ `lost`, and `lost → new` (reopen). No status mappings and no counting statuses are seeded —
they name Order statuses, which are the operator's.

No role is granted CRM permissions automatically. The codes appear on `/admin-roles` for an
operator to grant; a super-administrator holds them by wildcard **[unverified]**.

**Alternatives rejected.** *Seeding from an `installHook`* — needed only for writes into
another module's tables. *Granting `sales_representative` the codes from a boot hook, as
`blog` seeds its roles* — that role's rows are `admin_roles`' data; changing what an existing
role may do on upgrade is an operator decision.

## R-26. Custom fields on Opportunities (User Story 15)

**What the tree holds [verified].**

- The closest model is **`quote_requests`**: a `customFieldValues` JSONB column on the host
  entity (`quote-request.entity.ts`), added by its own later migration
  (`20260718T200342_quote_requests_quote_request_custom_field_values.ts`); the host calls
  `customFieldValues.validateAndMerge('quote_request', currentBag, patch)` inside its own
  write and maps `isCustomFieldValidationFailure` to 422 `CUSTOM_FIELD_VALUE_INVALID` with
  per-field issues (`rfq-admin-service.ts`); the port is resolved as
  `lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService')`; the admin renders
  `CustomFieldValuesPanel` from `@endora-commerce/admin-kit/components` with `entityType`,
  `values` and a `save` callback (`RfqDetail.tsx`).
- **A host type is not registered by the host.** `supportedEntityTypeSchema`
  (`packages/contracts/src/custom-fields.ts`) is a closed Zod enum, and
  `SUPPORTED_ENTITIES: Record<SupportedEntityType, SupportedEntityMeta>` in
  `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts` is a static
  map — the `Record` type makes the compiler demand an entry for every enum member. Its own
  header says: "adding an entity is one entry here plus wiring the host's read/write path".
  `GET /api/v1/admin/custom-fields/entity-types` serves the map to the admin screen.
- **`custom_fields` is `nonDeactivatable`.**

**Decision.**

1. Add `'opportunity'` to `supportedEntityTypeSchema` and an entry to `SUPPORTED_ENTITIES`
   (`orgOwned: true`), with the label `customFields.entity.opportunity` in `custom_fields`'
   own bundles — the file that already holds `customFields.entity.order`.
2. **Close the Principle XVII leak generically**: `SupportedEntityMeta` gains an optional
   `ownerModuleId`. `entity-types` omits a type whose owner is not effectively present
   (`effectiveState.isPresent`), and the definition mutation routes refuse such a type with a
   409, beside the existing `assertNotHostManaged`. Existing types declare no owner and behave
   exactly as before. The generic core still reads the marker's presence only, never which
   module it names — the rule `managedBy` already follows (Principle XIV).
3. CRM: a `custom_field_values jsonb not null default '{}'` column on `crm_opportunities`,
   added by **a second CRM migration in this story** (the `quote_requests` precedent);
   `validateAndMerge` inside the create and update Commands — so the host persists and audits
   its own write, and the generic layer only validates (Principle XIV); `project` in the
   serializers. Values inherit the Opportunity's tenant scope by construction: they are a
   column on an `@OrgScoped` row.
4. **Edge: `dependencies: ['custom_fields']`, a hard dependency — and the code forces
   nothing else to be decided.** The owner is non-deactivatable, so there is no off state to
   degrade into and no switch a binding edge could deaden; `quote_requests`, `organizations`
   and `customers` declare it the same way.
5. Admin: `CustomFieldValuesPanel` on the Opportunity's *Overview* tab, saving through the
   Opportunity PATCH with `If-Match`. On the **create** form the same fields are needed — a
   required field would otherwise refuse every creation. **[unverified]** whether the panel
   can be embedded in a form without its own save button, and how `validateAndMerge` treats a
   required field absent on create; T160 reads `CustomFieldValuesPanel.tsx` and
   `custom-field-value.service.ts` first. If the panel cannot be embedded, it gains an
   optional controlled mode (`onChange`, no button) in
   `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` — a host
   file, listed in `contracts/foreign-module-changes.md` as conditional.

**Why a second migration is acceptable here.** The plan put the whole schema before the first
story so that parallel stories never both regenerate the migration and entity registries.
One story adding one migration and no entity keeps that property: it is the only story that
regenerates `migrations-registry.generated.ts`. The alternative — adding the column to the
init migration — means changing Phase 2 while it is being implemented.

**Alternatives rejected.** *A manifest-contributed host-type registry* — the right end state
(it would also let a third-party module be a host) and a redesign of an enum that types the
custom-fields API; out of proportion here. *Leaving the leak* — "Opportunity" offered for
field definition while CRM is off is exactly what Principle XVII forbids. *A CRM-owned field
mechanism* — a second generic layer.

## R-27. Outbound webhooks for Opportunity events (User Story 16)

**What the tree holds [verified].** There is no registry, catalogue or manifest declaration.
`packages/modules/webhooks/src/backend/index.ts` holds
`BRIDGED_EVENT_TYPES = ['order.created.v1', 'order.status_changed.v1']` and calls
`ctx.subscribe` once per member; `bridgeEventHandler` (`services/event-bridge.ts`) looks up
active subscriptions for the event type — honouring a subscription's Organization binding from
the payload's `organizationId` — and enqueues one delivery job each, sending **the event's own
payload whole**. The admin screen offers a separate hard-coded list,
`KNOWN_EVENT_TYPES` in `admin/pages/WebhooksPage.tsx`. `webhooks` is operator-switchable.

**A defect found on the way, reported and not repaired here.** `KNOWN_EVENT_TYPES` offers
thirteen event types; the backend bridges two. An operator can subscribe to
`product.created.v1`, `rfq.created.v1`, `payment.settled.v1` and eight more, and will never
receive one. It predates this feature and is outside its scope; it goes to the defect register.

**Decision.** `webhooks` gains a **contribution seam**, and CRM is its first contributor.

- `packages/contracts/src/webhooks.ts`: `WebhookEventDescriptor { ownerModuleId, eventType }`
  and `WebhookEventRegistryPort { register(descriptor), owners(), list() }`. Container name
  `webhookEventRegistry`, owner `webhooks`, registered ungated with `ctx.di.register` — the
  shape and the reasons of `auditReferenceRegistry`.
- In `webhooks`: `register` records the descriptor and bridges the type through the module's
  own `ctx.subscribe`, so the bridge is gated on `webhooks`' effective state exactly as the
  two built-in types are. **[unverified]** that a `ctx.subscribe` issued from inside a
  registry method during the boot phase is accepted by the kernel and by
  `check:subscribe-seam` (mechanically it is a push into the sink — `module-context.ts`); T167
  proves it, and the fallback is for `webhooks` to subscribe in its own boot hook over
  `list()`, with the ordering question that raises stated then.
- `GET /api/v1/admin/webhooks/event-types` returns the contributed types whose owner is
  effectively present; `WebhooksPage.tsx` offers them **in addition to** its existing list,
  which is left untouched (see the defect above — changing it is a behaviour change to
  `webhooks` nobody asked for).
- CRM pushes three descriptors from a contribution-only boot hook and declares
  `nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind:
  'contributes-to' }]`. With `webhooks` off, nothing is delivered and nothing in CRM changes;
  with `webhooks` absent from an instance, the push is dropped
  (`contribution-sinks.ts`). No presence check and no `whenAbsent` — nothing degrades.

**Which events.** `crm.opportunity.status_changed.v1` (the ask), plus
`crm.opportunity.created.v1` and `crm.opportunity.closed.v1`. The cost of each is one
descriptor. Closed-won and closed-lost are **one** event carrying `outcome`, not two types: an
integrator filters on a field, and two types would be two subscriptions to keep in step.

**Payload contract.** Because the bridge sends the event payload whole, **the event payload
is the webhook payload**. `packages/contracts/src/crm.ts` therefore carries a strict Zod
schema per offered event — `OpportunityStatusChangedEventV1Schema`,
`OpportunityCreatedEventV1Schema`, `OpportunityClosedEventV1Schema` — and a test asserts every
emitted event parses under `.strict()`, so a field added to the event is a deliberate,
reviewed change to a public contract. The `.v1` suffix is the version; a breaking change is a
`.v2` event offered beside it. No free text is in any of the three.

**Alternatives rejected.** *Appending three strings to both hard-coded lists* — the smallest
diff, and `webhooks` would name CRM's events and offer them with CRM off. *CRM calling a
`webhookDispatchPort`* — every producer would re-implement "is webhooks present, then forward",
and the catalogue would still need a second mechanism. *A manifest field `webhookEvents`* — no
module reads other modules' manifests at composition today **[unverified by exhaustive
search]**; a registry is the established contribution shape.

## R-28. The linked-Opportunity panel on the Order and Quote Request screens (User Story 17)

**What the tree holds [verified].** `OrderDetail.tsx` mounts exactly one zone,
`order.detail.payment` — the body of the Payment tab — which cannot host a CRM panel.
`RfqDetail.tsx` mounts none. The precedent for "a stack of panels another module may add to a
detail screen" is `organization.detail.after`, `customer.detail.after` and
`invoice.detail.after`, each one `<AdminZone name=… props={{ …Id }} />` at the end of the
host's screen; "an empty zone renders nothing at all" (`OrganizationDetail.tsx`).
`check:admin-zones` refuses a member no host renders (`unrendered-zone`) and a contribution to
one (`contribution-to-unrendered-zone`), so the enum member and its mount must land together.

**Decision.** Two new zones, each in the established shape, each mounted once:

| Zone | Mounted in | Props |
| --- | --- | --- |
| `order.detail.after` | `packages/modules/orders/src/admin/pages/OrderDetail.tsx` | `OrderDetailZoneProps` (existing: `{ orderId }`) |
| `quote_request.detail.after` | `packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx` | `QuoteRequestDetailZoneProps` (new: `{ quoteRequestId }`) |

Neither host learns who contributes; with no contributor — CRM off, absent, or the user
lacking `crm:read` — the zone renders nothing and the screen is unchanged (FR-078).
**[unverified]** where exactly in `OrderDetail.tsx` the mount belongs given its tab layout
(below the tab panels, so it shows on every tab, is the recommendation); T175 decides with the
file open.

CRM contributes one component, `LinkedOpportunityPanel`, through two thin zone wrappers, fed
by one new endpoint, `GET /api/v1/admin/crm/documents/:documentKind/:documentId/opportunity`
(`crm:read`), answering the Opportunity's summary or `null`. The two actions are cheap and
included: **"Link to an opportunity"** — a picker over the existing list endpoint filtered by
the document's Organization and `state=open`, then the existing link endpoint; and **"Create
opportunity"** — navigation to `/crm/opportunities/new?organizationId=…&linkDocumentKind=…
&linkDocumentId=…`, where the create page, after a successful create, calls the existing link
endpoint. No change to the create contract, so nothing already tasked moves.

**The Quote Request panel is included** — it is the same component and one more mount — and
its half depends on User Story 8, which is what makes Quote Requests linkable at all.

**Alternatives rejected.** *Reusing `order.detail.payment`* — it is a tab body named for
payments. *A new tab on the Order screen* — a tab for one small panel; the zone leaves the
host free to add tabs later. *An `initialLinks` field on the create request* — atomic, and a
change to a contract Phase 1 is implementing now; two calls are enough for an action whose
second half can simply be retried from the panel.

---

## Implementation notes (premises re-derived while implementing)

Dated notes from the implementing agent. Each records what a premise above turned out to be
when it was measured, and what was done about it.

- **N-1 (2026-10-05, T003) — R-1's [unverified] premise is false: `check:naming` refuses the
  id `crm`.** `bash scripts/check-naming.sh` exits 1 with *"Backend module folder looks
  singular: packages/modules/crm — Principle VI requires plural snake_case"*. The precedent
  R-1 and `plan.md` cite does not carry: `seo` is on the script's `allowed_singular` list,
  `mfa` and `pwa` are on `allowed_proper_noun`, and `cms` passes only because it ends in `s`
  and matches the plural pattern. No acronym passes by being an acronym. Every module that
  landed with a non-plural id did so with a one-word edit to one of those two lists in the
  same change (`infakt` and `invoice_ledger` in `073e231c7` are the latest). **Resolved 2026-10-05**: the
  coordinator relayed that the owner's requirements document names the module "CRM (crm)",
  so the id is the owner's; `crm` was added to `allowed_proper_noun` in
  `scripts/check-naming.sh`, which is now row A8 of `contracts/foreign-module-changes.md`.
- **N-2 (2026-10-05, T002) — `backend/package.json` is a file this feature must touch and
  `contracts/foreign-module-changes.md` did not list it (now row A9, accepted by the
  coordinator).** The generated registries import
  `@endora-commerce/mod-crm` by bare specifier, and pnpm links a workspace member only into a
  package that declares it; without the line `overlay:check` dies with `ERR_MODULE_NOT_FOUND`
  and the backend cannot boot. No generator writes that dependency (`manifests:generate`
  reconciles `admin/package.json` only), so it is one hand-added line,
  `"@endora-commerce/mod-crm": "workspace:*"`, as every existing module has.
- **N-3 (2026-10-05, T001) — three corrections to the skeleton's file list.** `tailwind.css`,
  `LICENSE` and `README.md` are rendered by `manifests:generate`, not copied; `tailwind.css`
  is rendered only once `src/admin/` exists, so the skeleton has none. `tsconfig.ui.json` is
  present and unused until then (the rendered `build` / `typecheck` scripts name it only for a
  package with an admin layer). And the rendered `test` script is a bare `vitest run` as soon
  as `vitest.config.ts` exists, which exits non-zero on zero files — so the skeleton carries
  one real test, `src/backend/manifest.test.ts`. It cannot sit beside `src/manifest.ts`:
  `manifests:check` refuses any sibling of the root manifest as reachable through no subpath.
- **N-4 (2026-10-05, T003) — `test/unit/kernel/` needs the service-free configuration to run
  without Postgres.** `pnpm --filter backend exec vitest run test/unit/db/module-graph.test.ts
  test/unit/kernel/` goes through the default configuration, whose global setup connects to
  Postgres. The same files under `--config vitest.unit.config.ts` need no service.

- **N-5 (2026-10-05, T006) — "every contract lands before the first story" meets
  `check:port-shape`.** A contract type whose doc block carries the `Container name:` marker is
  a *published port*, and the check refuses one with no registration behind it
  (`container-name-unregistered`; its ledger says in as many words that it is not a queue).
  `OpportunityReadPort`, `OpportunityTransitionPort` and
  `OpportunityTransitionGuardRegistryPort` are registered by later stories, so the three
  interfaces are in `crm.ts` **without** the marker line; each doc block names the container
  name in prose and says which change adds the marker. That change is one comment line beside
  the `providePort` / `di.register` call — the only contract edit a later story owes.
- **N-6 (2026-10-05, T023) — the `compose/<area>.ts` premise is false; composition is one
  file.** `check:subscribe-seam`, `check:container-imports`, `check:entry-presence` and
  `check:module-boundary` were all green with a `registerWorkflow(ctx)` helper in
  `compose/workflow.ts`. `check:port-dependencies` was not: it derives a module's registered
  names (`moduleOwnedNames`) and its gated ports (`moduleRegistered`) from the module's
  **entry-point file only** — the one exporting `registerModule`
  (`backend/scripts/check-port-dependencies.ts`, the `moduleEntryPoints` loop). A
  `ctx.di.register` in a helper file is an `instance-gap` ("registered by no module"), and a
  `ctx.di.providePort` there would not read as a gated port at all, which is the fail-open
  direction. Per T023 the module composes in `src/backend/index.ts`, one commented section
  per area. Consequence for parallel stories: `index.ts` is edited by every story (it was
  already on the shared-hot-file list, but as "one line per story", not one section).
  Services, routes, domain code and tests stay one file per area as planned.
- **N-7 (2026-10-05, T016) — seven child entities.** T016 says "eight" and lists seven;
  `data-model.md` has seven child tables.
- **N-8 (2026-10-05, T022) — nothing published answers "is this an Order status code".**
  `OpportunityWorkflow.orderStatusMappings[].orderStatusKnown` needs it (T059). `orders`
  publishes `orderReadPort`, `orderTransitionPort` (`applyStatus`, `isTerminal(orderId)`) and
  others, none of which enumerates or tests a status code; `OrderStatusRegistry` is a
  contribution `payment_methods` / `delivery_methods` receive from a composition root, not a
  port. Until T059 decides — a new read on an `orders` port (a change to `orders`, not on the
  foreign-change list), or computing the flag in the admin from `GET
  /api/v1/admin/orders/statuses`, which the screen fetches anyway — the endpoint answers
  `true`, and no mapping can exist yet.
- **N-9 (2026-10-05, T019) — R-23's premise holds.** `orders` gates its admin list, detail
  and status endpoints with `orders:read` (`packages/modules/orders/src/backend/routes.ts`),
  so `crm:read` declares `requires: ['orders:read']`.
- **N-10 (2026-10-05, T024) — a new module owes four Polish mirrors, not one.** Beside the
  module page: the generated reference page (`generated:module-reference/crm`), the module
  map's row, and `sidebar.main.category.crm` in
  `docs/i18n/pl/docusaurus-plugin-content-docs/current.json`. `check:docs-translations` names
  each. The skeleton commit already owed the module-map row; it was repaired with the page.
- **N-11 (2026-10-05, T009/T026) — the test harness and the worktree's own services.** The
  harness reads `TEST_DATABASE_URL`, `REDIS_URL`, `MEILISEARCH_URL` and
  `MEILISEARCH_API_KEY`; nothing in it hard-codes a port beyond the defaults those variables
  replace. `pnpm --filter '!backend' run test` runs four vitest processes at once by default;
  under a 6 GB cap it is run with `--workspace-concurrency=1`.

- **N-12 (2026-10-05, T026) — two ledgers a story meets that `quickstart.md` does not name.**
  `backend/test/contract/kernel/openapi-baseline.test.ts` compares the served OpenAPI document
  with a committed fixture, so **every story that adds a route** regenerates
  `backend/test/fixtures/openapi-baseline.json` (`UPDATE_OPENAPI_BASELINE=1`) and reviews the
  diff; it is a contract test, so neither `test:unit:fast` nor the `quality` job reaches it.
  And `backend/test/unit/tenancy/transitive-parent-chains.test.ts` asserts the set of
  `@TransitivelyScoped` classes, which the seven CRM children joined.

- **N-13 (2026-10-05, T038) — how a `CRM_*` code is minted, re-derived from `512b68e84` and
  `packages/contracts/src/errors.ts`.** A code raised by a module of this repository **does**
  join `ERROR_CODES` (row A7 applies), is declared in the manifest's `errorCodes`, and carries
  a sentence under `errors.<CODE>` in both bundles. Two ledgers then account for it:
  `MINTED_ERROR_CODES` in `backend/test/fixtures/error-code-routing/reference-ledgers.ts` (one
  entry per code, `to: 'crm'`) and the `MIGRATED_MODULES` roster in
  `backend/test/unit/_i18n/error-code-migration-progress.test.ts`. **Eleven** of the fourteen
  codes of `contracts/admin-api.md` §13 are declared by User Story 1; `CRM_ASSIGNEE_INVALID`,
  `CRM_MESSAGE_IMMUTABLE` and `CRM_TAG_NAME_TAKEN` join with their first raise site. Three
  facts about the error envelope the contract does not state and a caller meets:
  (a) the envelope **replaces** a declared code's `message` with the bundle sentence, filling
  `{placeholders}` from the scalar members of `details` — so `CRM_TRANSITION_VETOED` raises
  with `details.reason` and its bundle sentence is `{reason}` alone, which is what makes
  "`message` is the guard's reason" true in both languages; (b) `details.code` is the
  envelope's *refusal token* and selects `errors.<CODE>.<token>`, so `CRM_WORKFLOW_INVALID`
  carries the rule as `details.rule` (the contract) **and** `details.code` (one sentence per
  rule), and no other raise uses a member named `code`; (c) a body or query the Zod schema
  refuses answers **400** `VALIDATION_FAILED`, not 422 — 422 is what a service raises.
- **N-14 (2026-10-05, T041) — "the Organization is visible to the caller" is not what
  `organizationDetailsPort` answers.** `Organization` is `@GlobalEntity` — it is the tenant,
  not a tenant-scoped row — so the port finds every Organization whoever asks. Reach is asked
  separately, with `isOrgInScope(organizationId)` from `@endora-commerce/platform/tenancy`,
  and the two answers are one refusal: an out-of-scope Organization and a missing one both
  answer 422 `VALIDATION_FAILED` on create. Without it the write would reach the tenant write
  guard and come back as 403 from the backstop, which tells the caller the Organization
  exists.
- **N-15 (2026-10-05, T041/T043) — `@TransitivelyScoped` is a classification, not a filter.**
  Nothing narrows a read of a child by its own id: the decorator registers the chain for the
  classification check and attaches no MikroORM filter. The rule of R-12 — parent through the
  scoped EntityManager first, then the child by `(opportunityId, id)` — is therefore the
  *only* protection, and it lives in one function, `loadOpportunity`
  (`services/opportunity-access.ts`), which every service calls first. Corollary met while
  implementing: the unit of work does not order inserts across a foreign key it does not know
  as a relation (the child columns are plain ids), so the create Command flushes the
  Opportunity before it writes the creation row of its status history.
- **N-16 (2026-10-05, T047/T048) — the `pending` rows are written inside the transition's
  Command, by the transition service.** R-4 asks for a row "written `pending` before the
  call"; they are written in the same transaction as the status change, so there is never a
  moved Opportunity with no record of what it owes — strictly stronger, and still before the
  call. `check:command-coverage` reads `em.create` in a helper of another file as an unaudited
  write, so `OrderStatusPropagationService.forwardTargets(em, …)` only **reads** which Orders
  are owed what, and the transition service's Command creates the rows. Recording an outcome
  after the port call is a Command too (`crm.opportunity.propagation_record`) and writes **no
  audit entry of its own** (`skipAudit`): it is the second half of a transition or a retry
  that already has one, and `orders` audits the Order's own change. That action name is
  therefore not in `data-model.md` § Audit actions and never appears in the audit log.
- **N-17 (2026-10-05, T041) — `OpportunityStatusRef.name` is resolved from the acting
  administrator's stored language.** The contract makes it a string. No module-facing seam
  answers "which language is this request in" (`kernel/i18n/request-language.ts` is the
  host's), so the label is `name[preferredLanguage]`, read through `adminUserReadPort`, then
  the status's default name. `GET /workflow` still returns the whole per-language map for a
  screen that wants to resolve it itself.
- **N-18 (2026-10-05, US1) — what User Story 1 refuses rather than half-implements.** The
  contracts were written for every story at once, so several request shapes are valid before
  the story that acts on them. Each is refused with a sentence, never accepted and dropped:
  a mapping with `direction: 'order_to_opportunity'` (US2 — 422), a link with
  `documentKind: 'quote_request'` (US8 — 422), `tagIds` on create or edit (US6 — 422), and
  the `assignedAdminUserId` / `tagId` list filters (US3, US6 — 422). `assignedAdminUserId` on
  create and edit **is** accepted when it names an existing administrator and stored as
  given; the default-assignee rule, the "active" refinement and `CRM_ASSIGNEE_INVALID` are
  US3's. `tags` is `[]`, `references` is `[]`, `excludedDocuments` is `[]` and
  `computedValue` is `0.00` until their stories.
- **N-19 (2026-10-05, T048) — what *Retry* and *Dismiss* do at the edges.** A retry asks the
  Order for what the Opportunity's status maps to **now** (the cause is usually a corrected
  mapping), falling back to what the retired row asked when the mapping is gone. It is refused
  with 409 `VERSION_CONFLICT` when the outcome is already settled (applied, dismissed), when
  the Opportunity has since left the status the row was written for, or when the Order no
  longer follows it. A child addressed under an Opportunity it does not belong to is 404
  `NOT_FOUND` (the parent's own absence is 404 `CRM_OPPORTUNITY_NOT_FOUND`). A row left
  `pending` for more than a minute — a process that stopped between the Opportunity's commit
  and the Order's answer — is shown among the unresolved outcomes as `failed` and a retry
  consumes it; the wire schema has no `pending` outcome.
- **N-20 (2026-10-05, T039/T040) — shapes `contracts/admin-api.md` §4 leaves open.** Every
  configuration write answers `{ data: OpportunityWorkflow }` (201 for `POST /statuses`, 200
  otherwise), except `DELETE /statuses/:code`, which is 204. A status's `kind` cannot change
  while Opportunities are in it (409 `CRM_STATUS_IN_USE`), because `closedAt` / `closedKind`
  are stamped on those rows. `PATCH` with `isInitial: true` alone is audited as
  `crm.status.set_initial`. An unknown status code on `PATCH` / `DELETE` is 404 `NOT_FOUND`.
  Two rules joined `details.rule` beyond the five of the graph: `mapping_unknown_status` and
  `mapping_duplicate`. The Order status a mapping names is not validated on write (N-8).
- **N-21 (2026-10-05, T027–T034) — the tests restore the seeded workflow; they do not rely on
  the harness.** The three seeded configuration tables hang off nothing the harness
  truncates, and declaring them `volatileTables` would hand every later file an empty
  workflow. `backend/test/helpers/seed-crm.ts` (**a new file under `backend/test/helpers/`** —
  test fixtures for this feature, in the place the tree keeps per-feature seeds) carries
  `restoreDefaultCrmWorkflow`, called in `beforeAll` *and* `afterAll` of every file that
  changes the configuration. Also met: the test ORM hydrates a `null` column as `undefined`,
  so an assertion on a nullable property compares `?? null`.
- **N-22 (2026-10-05, T038) — the audit viewer will not find CRM's action labels, and that is
  not repaired here.** The bundles carry `auditLog.crm.*` as `contracts/admin-surfaces.md` §7
  asks. `audit_logs`' `moduleIdForAuditAction` maps an action prefix to a bundle through a
  static chain that ends in `'core'`, so `crm.opportunity.transition` is looked up in the
  `core` bundle and renders as its raw action on `/audit-log`. `audit_logs` is not on the
  foreign-change list; the Opportunity's own history tab (US11) reads CRM's bundle and is
  unaffected. Reported for the register rather than fixed.
- **N-23 (2026-10-05, T050) — R-13's [unverified] descriptor shape, read from the tree.**
  `SalesChannelAttributionDescriptor` is `{ ownerModuleId, consumer, tableName, columnName,
  countForChannel(salesChannelId) }`. CRM's count is a raw statement, as `quote_requests`'
  is and for its reason: the entity is organization-scoped and the question is platform-wide.
  `sales_channels` is already a binding dependency (the foreign key), so no further edge is
  declared and `check:port-dependencies` is green. A refused channel delete answers 422
  `SALES_CHANNEL_HAS_ATTRIBUTIONS` naming `sales opportunity(ies)` and the count.
- **N-24 (2026-10-05, T030) — the MVP walk maps five steps, not two.** `quickstart.md` asks
  for "two forward mappings". The walk maps every status from `qualified` to `won` onto the
  seeded Order workflow's own path (`paid` → `processing` → `shipment_ready` →
  `shipment_sent` → `completed`), so the Order is read back after *every* step of the
  Opportunity's workflow and ends completed when the Opportunity is won. The refused-Order
  case (step 9) runs on a second Opportunity in the same test.

- **N-25 (2026-10-05, T050) — a ledger derived about the contribution, in a file T050 never
  names.** `backend/test/integration/sales_channels/delete-attribution-guard.test.ts` asserts
  the contributors of `salesChannelAttributionRegistry` as an exact set (`orders`,
  `quote_requests`), so the counter T050 asks for reddens it — and a targeted run over the
  CRM directories never opens that file. Found by running the neighbouring suites. The
  expectation gained `crm`; the file was **not** on `contracts/foreign-module-changes.md`, so
  it is added to §E there, beside the other set-asserting ledger CRM joined, **in a commit of
  its own and without the coordinator's prior acceptance** — it is the one edit of this story
  to an existing file outside the listed set.
- **N-K1 (2026-10-05, T148) — R-20's [unverified] premise holds: `@dnd-kit/core` 6.3.1 runs
  under React 19.** Resolved against `react`/`react-dom` 19.2.5. Two measurements. The
  primitive's tests (`admin/test/components/KanbanBoard.test.tsx`, 22 cases) drive the
  library's real sensors, collision detection and live region under jsdom with nothing of the
  library mocked — only geometry is substituted, because jsdom lays nothing out. And a
  throw-away page (not committed) mounting the board inside `<StrictMode>` was driven in
  headless Chromium 148 through Playwright: mouse drag, press-and-hold touch drag, a swipe
  that must *not* lift, the keyboard path, the refused lane, the rejected promise, and a
  390 px viewport. Sixteen assertions, all passing, with no console error or warning.
  **[unverified]**: a physical touch device and a real screen reader — T093's audit.
- **N-K2 (2026-10-05, T149) — no other consumer of `admin-kit` has to declare the peer.**
  `pnpm install --lockfile-only` then `pnpm install --frozen-lockfile` exit 0 with no warning
  naming `@dnd-kit`; the lockfile gains three packages (`core`, `accessibility`, `utilities`)
  and two importer entries, and `manifests:check` reports every module manifest unchanged.
  `packages/admin-shell` and `packages/page-builder-admin` name the kit as a workspace peer
  and inherit nothing. The docs site does not depend on the kit. The scaffold
  (`adminMemberPackages` in `packages/cli/src/new-instance/template.ts`) writes exactly four
  dependencies into an instance's admin member — the kit, the shell, `react`, `react-dom` —
  and **none** of the kit's other peers: `echarts`, `lucide-react` and the Radix packages
  reach an instance only because pnpm installs missing peers by itself
  (`autoInstallPeers: true`, the pnpm 9 default and the first setting in this lockfile).
  `@dnd-kit/core` arrives the same way, so the template is unchanged. Two things follow that
  nothing here measures: a scaffolded install against a *published* kit carrying this peer
  cannot be run before a release exists **[unverified]**; and `@dnd-kit/core` itself peers
  `react-dom`, which the kit does not declare (the Radix packages already put it in that
  position) — satisfied by the application in every arrangement the scaffold produces.
- **N-K3 (2026-10-05, T150) — the plan's [unverified] "paid only on the board route" is
  FALSE once a consumer exists, and no check holds it.** Nothing analyses the admin build's
  chunks (no `manualChunks`, no size gate). Measured with `pnpm --filter admin run build`:
  with no consumer the primitive is tree-shaken out completely — no chunk contains
  `@dnd-kit` and the entry chunk is 1 872 781 bytes, its hash unchanged. With a
  dynamically-imported consumer (a throw-away `import()` of a file that imports `KanbanBoard`
  from `@endora-commerce/admin-kit/components`, which is the shape T091's lazy page has)
  `@dnd-kit/core` lands in the **entry chunk**, which grows to 1 914 770 bytes (+41 989); the
  lazy chunk holds 7.76 kB. The cause is not this component: the shell reaches the
  `components` barrel statically, the kit's `package.json` carries no `sideEffects` field, so
  Rollup must assume every module the barrel names has import-time effects and keeps them
  with the entry. `echarts` is in the entry chunk today for the same reason. One further
  build, with `"sideEffects": ["*.css"]` added to the kit's manifest and nothing else changed,
  put `@dnd-kit/core` in the lazy chunk (50.32 kB, 17.09 kB gzip) and shrank the entry to
  652 527 bytes. **That flag is not part of this change**: it re-chunks the whole admin, and
  it is only safe if no module of the kit relies on being imported for its effect — which
  needs its own verification, not a board story's. Recorded as the lever; the cost accepted
  until someone pulls it is ~42 kB (uncompressed) in the entry from the day T091 lands.
- **N-K4 (2026-10-05, T150) — three places where the primitive departs from R-20's sketch,
  each for a reason the sketch could not have known.** (a) **`MouseSensor` + `TouchSensor`,
  not `PointerSensor`.** A pointer-event sensor only works on touch if every card carries
  `touch-action: none`, and a narrow board whose lanes are full of cards could then not be
  scrolled with a finger. The pair keeps a swipe a scroll (measured in Chromium: the board
  scrolled, nothing lifted) and makes a 250 ms press a lift. The activation distance R-20
  asks for is on the mouse sensor (8 px). (b) **Keyboard drag starts from a handle button
  inside the card, not from the card.** The library's default puts `role="button"` on the
  draggable; a button's descendants are presentational to assistive technology, so the card's
  own link and its "Move to…" menu — the SC 2.5.7 path — would disappear from it. The card
  is the mouse/touch surface, the handle is the keyboard one, and "focus a card" in T148
  reads "focus the card's handle". (c) **A coordinate getter and a collision rule of its
  own.** The library's default keyboard step is 25 px, a dozen presses per lane; here one
  arrow is one lane, and the lane is chosen by horizontal span, because lanes are as tall as
  their content and "closest centre" picks a short neighbour over a tall target. The
  announcements are the library's (`DndContext`'s `accessibility`) as R-20 says, with one
  addition it cannot make: a move the caller's promise rejects is known only after the drag
  has ended, so it is spoken through the kit's existing `ReorderAnnouncer`.
- **N-K5 (2026-10-05, T148) — the primitive's test reads the kit's `dist`.** It imports
  `@endora-commerce/admin-kit/components`, as the other `admin/test/kit` tests and every
  consumer do, so `pnpm --filter @endora-commerce/admin-kit run build` precedes it after an
  edit to the component (`specs/conventions/building-packages.md`). The two domain-freedom
  cases read the **source** file: no `opportunit|status|crm` in it, and `@dnd-kit/core` the
  only `@dnd-kit/*` specifier.
- **N-B1 (2026-10-05, T059) — `orderStatusKnown` is computed from what the Orders port has
  answered, not from the Order workflow.** Re-derived: `orders` publishes `orderReadPort`,
  `orderListPort` (whose `counts` holds only statuses some Order is in), `orderPlacementPort`,
  `orderStatusAnnouncePort`, `orderTransitionPort` and a payment-status apply port — none
  lists or tests a configured status code, and N-8 stands. No port was added and `orders` was
  not edited. What CRM does hold is the transition port's own answers, one row per Order it
  asked: for each Order status code, the latest forward outcome that says anything about the
  *status* (`applied`, `already_there`, `not_permitted`, `vetoed`, `unknown_status`) decides —
  `false` when it is `unknown_status`, `true` otherwise, and `true` for a code nobody has
  asked for yet. So the flag is **evidence, not validation**: it cannot warn before the first
  refusal, and a reverse-only Order status that never occurs never turns `false`. The admin
  screen, which fetches `GET /api/v1/admin/orders/statuses` for its picker, can tell sooner
  and should prefer its own answer; a real one needs a read on an `orders` port, which is a
  foreign change this feature's list does not carry.
- **N-B2 (2026-10-05, T062) — there is no Zod schema for `order.status_changed.v1`.** T062
  asks for the payload to be parsed "with its Zod schema". The event's shape is a TypeScript
  type inside `orders` (`OrderEvents` in `order-service.ts`); the contracts package has none,
  and the CRM package does not depend on `zod`. The subscriber reads the three fields it uses
  (`orderId`, `organizationId`, `to`) with a hand-written guard in `index.ts` and drops an
  event that lacks one. The coarse event carries no actor, so "who changed the Order" is not
  known to the handler — which is why the echo is recognised by row, as R-5 says.
- **N-B3 (2026-10-05, T061) — how the reverse half is wired and what it records.** The
  transition service already depends on the propagation service, so `onOrderStatusChanged`
  takes the "move this Opportunity on an Order's behalf" function as an argument from the
  subscriber in `index.ts` rather than holding the transition service. Marking a forward row
  `echoed` is a Command with `skipAudit` (`crm.opportunity.propagation_echo`). A refused
  Order-caused move is one Command, `crm.opportunity.propagation_skip`, that writes the
  `skipped` row **and an audit entry** — an action `data-model.md` § Audit actions does not
  list. It is audited because the spec's scenario 3 wants the skipped change "recorded on the
  Opportunity with the reason", `unresolvedPropagations` is forward-only by `data-model.md`,
  and the Opportunity's history tab reads the audit log. A closed Opportunity, a missing
  mapping and an unmet "every Order" rule record nothing. `requireAllOrders` is stored `false`
  on a forward mapping whatever the request says. A new `details.rule`,
  `mapping_duplicate_order_status`, joins the seven.
- **N-B4 (2026-10-05, T058) — an echo marker that is never consumed.** A forward row is
  matched as an echo while it is `pending` or `applied` and not yet `echoed`. If the module is
  switched off between asking an Order and hearing the event, the row stays unconsumed, and
  the next time that Order reaches that same status by somebody else's hand the change is
  taken for the echo, once. Not repaired: it needs an Order to leave a status and return to
  it across a deactivation, and the cost is one unfollowed change.

## Questions put to the owner — all decided on 2026-10-05

Nothing is open. The three questions this design raised were answered in the second round,
and the third answer was reversed in the third round the same day.

| # | Question | Owner's decision |
| --- | --- | --- |
| **Q1** | Should switching the Quote Requests module off be refused while CRM is on, or allowed with CRM degrading? | **Allowed; CRM degrades** (R-17) — the default, accepted. |
| **Q2** | When an Order refuses the mapped status, should the Opportunity's own transition still stand? | **Yes — it stands; the refusal is shown and retryable** (R-4) — the default, accepted. |
| **Q3** | Native drag-and-drop for the board, or `@dnd-kit`? | **`@dnd-kit`** — the native default was accepted and then reversed: "it may be useful not only in this module but in the future too". R-20 is rewritten accordingly; the "Move to…" menu stays for WCAG 2.2 SC 2.5.7. |
