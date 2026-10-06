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
  `mapping_duplicate_order_status`, joins the seven. The audit entry of an Order-caused
  transition carries `causeOrderId` in its after-state beside `cause` — the status-history row
  had it, and the Opportunity's change history is read from the audit trail (R-16), which did
  not.
- **N-B4 (2026-10-05, T058) — an echo marker that is never consumed.** A forward row is
  matched as an echo while it is `pending` or `applied` and not yet `echoed`. If the module is
  switched off between asking an Order and hearing the event, the row stays unconsumed, and
  the next time that Order reaches that same status by somebody else's hand the change is
  taken for the echo, once. Not repaired: it needs an Order to leave a status and return to
  it across a deactivation, and the cost is one unfollowed change.
- **N-B5 (2026-10-05, T068) — the Sales Rep port's container name is
  `organizationSalesRepScopePort`, not `salesRepAssignmentPort`.** R-9, R-17 and
  `contracts/events-and-ports.md` §5 name the *type* (`SalesRepAssignmentPort`) as if it were
  the container name. The `Container name:` marker in `packages/contracts/src/organizations.ts`
  says `organizationSalesRepScopePort`, which is what `quote_requests` resolves, and what CRM
  resolves. `listForOrganization` answers rows with `adminUserId` and `createdAt`, unordered;
  the rule sorts them itself and breaks a tie on the date by id. `organizations` is already a
  binding dependency, so no edge was added.
- **N-B6 (2026-10-05, T066/T068) — "active" is two columns, and `activeOnly` reads one.**
  `adminUserReadPort.findById(id, { activeOnly: true })` excludes soft-deleted administrators
  only; a deactivated one (`status: 'inactive'`) is returned. User Story 1 validated an
  assignee with it and so accepted a deactivated administrator. An assignee is now held to
  `status === 'active' && deletedAt === null` in one predicate
  (`isActiveAdministrator`), used by the default rule, by `POST /assign`, by create and by
  `PATCH` — and the refusal is 422 `CRM_ASSIGNEE_INVALID` on all three, where create and
  `PATCH` answered 422 `VALIDATION_FAILED` before.
- **N-B7 (2026-10-05, T069) — R-11's [unverified] premise: no key/params variant has
  landed.** `RecordAdminNotificationInput` still takes `title: string`, as it does for
  `organizations`, `catalog`, `product_feeds` and `pim_ergonode`. CRM's title is a finished
  English sentence (`Opportunity OPP-000123 "<title>" was assigned to you`); the Opportunity's
  title is in it, which is internal to administrators who already see bell entries. The
  notifier returns `'recorded' | 'not-present'`, decides presence before the call and catches
  nothing. The edge is `degrades-without` with a `reason`; `check:port-dependencies` accepted
  it with no ledger edit. The generated reference page gained the row, and with it its Polish
  mirror and cache entry.
- **N-B8 (2026-10-05, T068/T070) — what the contract leaves open about assignment.** The
  default assignee of an Opportunity somebody else created **is** notified (the story's
  independent test); `crm.opportunity.assigned.v1` is emitted by `POST /assign` and by a
  `PATCH` that changes the assignee, **not** on create, whose Command already declares
  `crm.opportunity.created.v1` and a Command declares one event. Naming the assignee the
  Opportunity already has answers 200 and writes nothing — no version bump, no audit entry,
  no event. `assignedAdminUserId=me` with no administrator behind the request answers an
  empty page. The assignee is not required to hold a CRM permission or to reach the
  Organization (R-9), so an assignee may be somebody who cannot open the Opportunity.
  **Superseded by N-R2 on the last sentence: an assignee must reach the Organization.**
- **N-B9 (2026-10-05, T085) — where a tagging is written, and the shapes §8 leaves open.**
  `tag-service.ts` owns the tag list (Commands `crm.tag.create|update|delete` against
  `crm_tag`); the **taggings** are written by `opportunity-service.ts`, in the Commands that
  already hold the scoped parent — create, `PATCH`, and `setTags` (`crm.opportunity.tag_set`)
  — so no child row is ever written from a file that did not load its Opportunity. T085's
  "tagging in `tag-service.ts`" is therefore half true. Shapes: `POST /tags` answers 201
  `{ data: OpportunityTag }`, `PATCH` 200 the same, `DELETE` 204, `PUT …/tags` 200
  `{ data: OpportunityDetail }`. An unknown tag id on `PATCH`/`DELETE /tags/:id` is 404
  `NOT_FOUND`; an unknown tag in a `tagIds` is 422 `VALIDATION_FAILED` and nothing is
  replaced. Setting the set an Opportunity already has writes nothing (no version bump, no
  audit entry); a real change bumps `version`. `tagIds` on `PATCH` absent = leave alone,
  `[]` = clear. A tag's audit entry on delete carries the platform-wide `usageCount`, because
  the tag leaves every Opportunity, not only the visible ones. Tags on an Opportunity are
  ordered by name.
- **N-B10 (2026-10-05, T084) — `crm_tags` joins the tables the tests clean themselves.** Like
  the three workflow tables (N-21), `crm_tags` hangs off nothing the harness truncates;
  `clearCrmTags` in `backend/test/helpers/seed-crm.ts` is called in `beforeAll` and
  `afterAll` of the two tag files. The AND filter is a raw `group by … having
  count(distinct tag_id) = n` whose ids only ever narrow the scoped `find`; the usage count
  is raw SQL joined to `crm_opportunities` and constrained by `orgConstraintFor()`.
- **N-B11 (2026-10-05, T085) — `crm` is not on `check:command-coverage`'s roster.** The
  check's own output lists its "migrated modules" and `crm` is not among them, so a write
  outside a Command in this module is reported by nothing. N-16's sentence about what that
  check reads was about its rule, not about this module being held to it. Every write of
  these stories is in a Command regardless, and the check run by hand against the module
  (`tsx scripts/check-command-coverage.ts --strict --module crm`) reports 0 blocking; joining
  the roster is one line in a file this feature's foreign-change list does not carry, and is
  reported rather than done.
- **N-B12 (2026-10-05, T075) — what §6 leaves open about notes and messages.** `POST` answers
  201 `{ data: OpportunityComment }`, `PATCH` 200 the same, `DELETE` 204; `GET` requires
  `kind` (400 without it — the schema has no default). The refusals of `PATCH`/`DELETE` are
  evaluated in this order: the Opportunity as the caller may see it (404
  `CRM_OPPORTUNITY_NOT_FOUND`), the comment under it (404 `NOT_FOUND`, also for a note already
  deleted and for a comment of another Opportunity), a message (409 `CRM_MESSAGE_IMMUTABLE`
  **whoever asks**, the author included), and only then authorship (403 `FORBIDDEN`). So the
  platform administrator cannot edit a colleague's note: authorship is not a permission. A
  `PATCH` with the body a note already has writes nothing. Deletion is soft (`deleted_at`),
  as the entity's header says. **The audit entries carry the text** (`body` in the after-state
  of `note_add` / `message_add`, both states of `note_update`, the before-state of
  `note_delete`): "stays in the audit trail" is otherwise unverifiable, and the audit log is
  read by administrators only. `references` is `[]` until User Story 12.
  **Superseded by N-R6 on the audit entries: they carry the text's length, never the text.**
- **N-B13 (2026-10-05, T075) — who a message tells.** The assignee at the moment of sending
  and every earlier *message* author on that Opportunity (note authors are not participants),
  each once, never the sender — computed inside the Command, before the message joins the
  thread, and notified after the commit through `crm-notifier.ts` (kind
  `crm.opportunity.message`, an English title naming the Opportunity, the first 200
  characters of the message as the bell entry's body). A participant who has since been
  deactivated is still a recipient; the bell entry is inert for somebody who cannot sign in.
  A recipient is not checked against the Opportunity's tenant scope: an earlier author could
  only have written there by reaching it, and the assignee is whoever was chosen (N-B8).
  **Superseded by N-R2: the bell entry has no body, and each recipient's reach is checked.**
- **N-B14 (2026-10-05, T074) — how "no customer-facing route returns a note or a message" is
  held.** The module registers nothing outside `/api/v1/admin/crm` (`contracts/admin-api.md`
  says so, and the off-state list is every route it has). The test writes a note and a
  message with marker strings on an Opportunity linked to an Order, then reads, as the
  customer of that Organization, `/api/v1/orders`, `/api/v1/orders/:id`,
  `/api/v1/orders/:id/comments` and `/api/v1/quote-requests`, asserting the markers are in
  none and that the customer really is shown that Order; and it asserts the admin endpoint
  refuses the customer's session.
- **N-B15 (2026-10-05, T080) — User Story 5 is STOPPED before any code: the asset-reference
  descriptor needs a foreign edit this feature's list does not carry.** An
  `AssetReferenceDescriptor` answers `AssetReference[]`, and `AssetReference.kind` is a
  **closed Zod enum**, `assetReferenceKindSchema` in `packages/contracts/src/assets-library.ts`
  (nine members: four of `catalog`, one of `cms`, one of `megamenu`, three of `blog`). There
  is no member a CRM attachment can truthfully carry, so the descriptor
  T080 asks for cannot be written without adding one — e.g. `'crm_opportunity_attachment'` —
  to that file. It is one line, it is how `megamenu` and `blog` joined (the only two files
  naming `megamenu_item_target` are that contract and `megamenu`'s own descriptor; no label
  map elsewhere consumes the enum), and it is **not** a row of
  `contracts/foreign-module-changes.md` (§A lists `crm.ts`, `index.ts`,
  `admin-contributions.ts`, `common.ts`, `errors.ts`). Attachments without the descriptor
  would be attachments the library may delete from under an Opportunity (FR-044), so the
  story was not half-built: T078–T080 are untouched. **What unblocks it:** a row in §A for
  that enum member, with the `@endora-commerce/contracts` changeset saying so.
- **N-B16 (2026-10-05, T080) — R-15's [unverified] premises, re-derived from the tree for
  whoever resumes User Story 5.** (a) **An upload is `public` by default**
  (`packages/modules/assets_library/src/backend/routes.admin.ts`, `let visibility … =
  'public'`); `private` is a multipart field sent *before* the file part, which the kit's
  `uploadAsset(file, { visibility: 'private' })` does. So "attachments are uploaded private"
  is the admin screen's act unless the backend refuses a non-private asset on attach — the
  recommendation here is that it does (422), because nothing else stands between a customer's
  brief and a stable public URL. (b) **A private asset is served through a signed, expiring
  URL** — `…/assets/file/<id>?token=…&exp=…`, TTL from the adapter's `privateUrlTtlSec` (300 s
  in the adapter's tests) — produced by `AssetsLibraryService.resolveUrl` and carried as
  `AssetDetail.url`. An administrator gets it from `GET /api/v1/admin/assets/:id`
  (`fetchAssetDetail`), **which is gated `assets.read`**: a Sales Rep holding only CRM
  permissions cannot use it. So `OpportunityAttachment.url` has to be resolved by CRM, through
  `assetsLibraryPort.getAsset(assetId).url`, at read time — and the screen should re-read the
  list before opening a link, since the one it holds may have expired. `getAsset` also builds
  the deletion-protection `references` list (one query per registered descriptor), which is
  acceptable for a handful of attachments and would not be for a list of Opportunities.
  (c) **Name, MIME type and size come from `assetReadPort.findByIds(ids, { liveOnly: true })`**
  — `AssetRecord.filename`, `.mimeType`, `.sizeBytes` (a decimal **string**; the wire schema
  wants a number), `.visibility`. `resolvePublicUrls` on the same port answers stable URLs for
  public assets only and nothing for private ones. Both ports are `assets_library`'s, already
  a binding dependency. (d) The registry's enumeration policy is *honoured while the
  contributor is absent*, so the push is a contribution-only `ctx.onBoot` with no presence
  probe; `backend/test/integration/blog/asset-reference-while-off.test.ts` composes the module
  alone, while off, against a registry of its own, asserts the owner registered, that the
  Library's `softDelete` answers 409 `ASSET_REFERENCED` naming the module's kind, and — the
  control — that the same delete succeeds through an empty registry. Composing `crm` alone
  needs `salesChannelAttributionRegistry` supplied as a root value too (its other boot hook).
  (e) §7 names no error for attaching the same asset twice; the unique `(opportunity_id,
  asset_id)` constraint exists, and no `CRM_*` code of §13 fits — answering the existing
  attachment (200, nothing written) avoids minting one.
- **N-B17 (2026-10-05, T080) — User Story 5 unblocked and built.** The coordinator approved
  the enum member (row A10 of `contracts/foreign-module-changes.md`, a commit of its own).
  Before relying on "nothing else enumerates the kinds", six sibling literals were grepped
  across the whole tree (admin, admin-kit, every module's admin pages, bundles, docs, tests):
  each is named only by the contract, by its owner's descriptor and by its owner's tests; no
  label map, no exhaustive switch, no exact-set expectation over kinds. Nothing else was
  touched. What was built, and what N-B16 recommended that is now fact:
  (a) **the backend enforces `private`** — a live asset whose `visibility` is not `private`
  is 422 `VALIDATION_FAILED`; `AssetRecord` carries nothing that says what a file was uploaded
  *for* (only `label` and `folderId`, both free), so purpose is not checked and the admin
  screen **must** upload with `visibility: 'private'`;
  (b) **`url` is `assetsLibraryPort.getAsset(assetId).url`**, resolved on every read, for live
  assets only (`assetReadPort.findByIds(…, { liveOnly: true })` decides which — so the library
  is never asked for something it would refuse, and no port call is wrapped in a `catch`);
  (c) **a private file cannot be reached by attaching it elsewhere**: an asset already
  attached to an Opportunity the caller's scoped EntityManager does not return is refused with
  the same 422 as a missing one. **Residual, not closed:** a private library asset that is
  attached to *no* Opportunity can be attached by anybody holding `crm:write` who knows its
  uuid, and they then hold a link without `assets.read` — the port offers nothing to tell such
  a file from an attachment-to-be;
  (d) the same asset twice on one Opportunity answers 200 with the existing attachment and
  writes nothing (§7 names no error for it); `POST` otherwise 201, `DELETE` 204, a child under
  the wrong parent 404 `NOT_FOUND`;
  (e) a file gone from the library leaves its attachment listed with the snapshot name,
  `application/octet-stream`, size 0 and `url: null`;
  (f) the descriptor's label is `Sales opportunity <number>` — the number and never the title,
  because whoever deletes a file in the library need not be able to read the Opportunity;
  (g) composing `crm` alone for the while-off test needed `salesChannelAttributionRegistry`
  as a root value, as N-B16 predicted, and `lazyPort` resolved both registries from root
  values. `check:port-dependencies` asked for no new edge: `assets_library` was already
  binding.

- **N-26 (2026-10-05, T053) — `PaginationFooter` cannot be fed by a cursor-paged endpoint.**
  T053 and `plan.md` name the kit's `PaginationFooter` for the list. Its props are a
  zero-based `page`, a `pageSize` and a **`total`**, and it renders "Showing X–Y of Z" and
  "Page N of M". `GET /opportunities` answers `{ cursor, hasMore, limit }` and no total (the
  platform's `paginationSchema`; offset totals are deliberately not part of it), so the
  component could only be handed an invented number. The list uses a module-private
  `components/CursorPagination.tsx` instead: rows per page, the page number, Previous / Next
  over a trail of the cursors that led to the page on screen, on the kit's `Button` / `Select`
  and the shared `common.pagination.*` copy. Page sizes above the endpoint's maximum of 200
  are not offered (`PAGE_SIZE_OPTIONS` goes to 500). A promotion candidate for the kit, which
  has no footer for the cursor shape; the alternative — adding a `total` to the list answer —
  is a contract change and a count query per page, and was not made.
- **N-27 (2026-10-05, T037) — the kit's `CustomerPicker` cannot be driven from an admin test.**
  It takes `apiClient` from the kit's own `lib/api-client.js`, not through the `./lib` barrel,
  so the `vi.mock('@endora-commerce/admin-kit/lib', …)` every packaged screen's test uses does
  not reach its request, and the request then meets the suite's "no network" guard. That is
  the state `SalesChannelPicker.tsx` records for "the kit's five older data-fetching
  components". The create-page test therefore replaces `CustomerPicker` (and nothing else)
  through the `./components` barrel and asserts what the screen owes it: the Organization it
  is scoped to, that it is disabled until one is chosen, and that its value is cleared when
  the Organization changes. The real picker was exercised in the browser walk (N-30). The
  one-line repair — importing `apiClient` from `../../lib/index.js` as the three newer pickers
  do — is the kit's and was not made here.
- **N-28 (2026-10-05, T052/T054) — what the screens add that the contract leaves open.**
  (a) **No dialog primitive exists in the kit**; `components/ModalDialog.tsx` is
  module-private (scrim, `aria-labelledby`, Escape, the kit's `useFocusTrap`) and a promotion
  candidate. (b) **Delete is offered for every status**, in use or not: `inUseCount` counts
  only the Opportunities the operator may see, so the server decides and its sentence is
  shown. (c) **An edit sends only the changed fields** — a restated, unchanged `kind` on a
  status in use would turn every rename into `CRM_STATUS_IN_USE`. (d) **A status is named in
  the Admin UI's two languages** (`en`, `pl`), which are the keys N-17's resolution reads.
  (e) **`orderStatusKnown` is also derived on screen** (N-8): a mapped Order status missing
  from `GET /api/v1/admin/orders/statuses` is shown as "… (no longer exists)". (f) Saving the
  forward mappings sends any `order_to_opportunity` mapping back unchanged, so the table
  cannot delete what User Story 2 will add. (g) **The Opportunity screen has no edit form and
  no delete control** — neither is in T054 or in the success scenario; `PATCH` and `DELETE`
  are served and unused by the admin. (h) The transition's optional `reason` is not asked
  for. (i) With one tab the tab strip is not rendered; it appears with the second entry of
  `tabs.ts`.
- **N-29 (2026-10-05, T055) — a key-coverage test, because nothing else holds it.**
  `i18n:hardcoded` refuses a literal and says nothing about a key that no bundle carries; the
  resolver renders such a key as `crm.some.key`. `packages/modules/crm/src/admin/index.test.ts`
  scans the admin sources for every key a screen asks for, enumerates the seven families
  composed at run time, and holds each to **both** bundles — and, in the other direction,
  refuses a key under the screens' prefixes that no screen asks for. The admin tests render
  over the shipped English bundle for the same reason. Polish wording: *Dismiss* is
  "Pomiń" on the button while `auditLog.crm.opportunity.propagation_dismiss` (the backend
  half's, not touched) says "Odrzucono odmowę…"; the module page's Polish copy says
  "przedstawiciel handlowy" where the bundles and the new section say "handlowiec".
- **N-30 (2026-10-05, T057) — the success scenario, walked in a browser.** Headless Chromium
  (Playwright 1.60) against the admin's Vite dev server and the backend **test composition**
  (`setupBackendServer`, listening on a port) over a throw-away `_test` database on this
  worktree's own Postgres — the stub admin session, real routes, real `orders`. Not a
  production boot: authentication, CORS and the install hooks are outside what it shows.
  Walked: the CRM sidebar group; add a status and two transitions; four forward mappings;
  create by hand (required-field errors first); the list with a matching and a non-matching
  search; link an Order by search; four moves, the Order following `paid` → `processing` →
  `shipment_ready`; the move to *won* answered `not_permitted` ("no edge from
  "shipment_ready" to "completed"") with *Retry* (refused again) and *Dismiss*; the same
  screens at 390 px and in Polish. No failed request and no page error. **One defect found
  and fixed**: an unsaved mapping choice was discarded when another write on the screen
  returned (the table reset its draft on the workflow object's identity) — a jsdom test now
  holds it. Not verified by eye: a real screen reader, a physical touch device, dark theme.
- **N-C1 (2026-10-05, T181) — the edit form, the delete control and the reason, which T054
  did not ask for.** N-28 (g) and (h) recorded that `PATCH` and `DELETE` were served and
  unused and that the transition's `reason` was never asked for; T181 closes all three.
  (a) **The form is in place, not a dialog and not a route**: *Edit* beside the *Details*
  heading swaps the definition list for the form. No route was added, so
  `contracts/admin-surfaces.md` §1 is unchanged, and seven fields with two comboboxes are
  not squeezed into the module's `max-w-lg` `ModalDialog`. (b) **What the form sends is
  `UpdateOpportunityRequestSchema` minus two fields**: `title`, `description`,
  `customerAccountId`, `salesChannelId`, `expectedCloseDate`, `valueMode`, `manualValue`.
  `organizationId` and `currency` are refused by the schema (`.strict()`) and are shown as a
  sentence; `assignedAdminUserId` has its own endpoint and story (US3) and `tagIds` is refused
  until US6 (N-18) — neither is in the form. Only changed fields are sent (N-28 (c)'s rule),
  an untouched form is no request, and a cleared optional field is sent as `null`.
  (c) **`If-Match` is the version the draft was read at, not the one on screen.** A status
  change bumps `version` too (`opportunity-transition-service.ts`), so an operator who opens
  the form, moves the status and then saves gets the same 409 as one who lost a race with a
  colleague. The sentence therefore says "has changed since you opened this form" and blames
  nobody. On 409 saving is disabled and *Reload the opportunity* reads it again and restarts
  the draft from it; the draft is not merged, because a merge is a silent overwrite of
  whichever field both sides touched. (d) **Value mode is offered although the computed figure
  is `0.00` until US8** (N-18): the endpoint accepts `valueMode` today and the brief asked for
  it. An operator who chooses "calculated from linked documents" before US8 lands sees a value
  of zero — true, and not useful. The manual figure is kept while the mode is `computed` and
  is not sent from that mode. (e) **The contact picker cannot show the person already chosen**:
  the kit's `CustomerPicker` labels a value only from accounts it has searched for and takes
  no `selectedLabel`, so the form names the current person in a line under it until another is
  picked. A one-prop repair in the kit, not made here. (f) **Delete is in the page header**,
  gated on `crm:configure` like the endpoint, behind `ModalDialog`, and navigates to the list;
  the dialog names the number and the title and says the linked Orders are not changed.
  (g) **The reason is one optional field under the status buttons**, sent with the next move
  and then cleared; the board's moves (US7) send none.
- **N-C2 (2026-10-05, T088/T090) — the board endpoint: two reads, the tenant filter applied
  by name, and two filters it refuses.** `GET /board` is new files only —
  `services/board-service.ts`, `routes/routes.board.ts` — and one delimited section of
  `src/backend/index.ts` with a `ctx.routes` of its own (`compose/board.ts` does not exist,
  N-6). (a) **The cards are the list's.** `OpportunityService.list` is called once per
  status with `statusCode: [code], limit: perColumn`, so a card is rendered, ordered and
  language-resolved by the one code path that already does it, and `hasMore` is the list's.
  The service takes the list as a function and edits nothing in `opportunity-service.ts`.
  (b) **The figures are one grouped statement** over `CrmOpportunity` — `count(*)` and the
  sum of the effective value, grouped by status and currency. A QueryBuilder does **not** take
  the entity filters on its own (MikroORM 6.6: `QueryBuilder.applyFilters()` is a separate
  call); the service calls it, so the tenant predicate is the platform's and none is written
  by hand. `board.contract.test.ts` proves it with a Sales Representative confined to one
  Organization: the other Organization's Opportunity is in no column, no count and no total,
  with the platform administrator's answer as the positive control. A currency whose
  Opportunities carry no value is counted and has no total. (c) **The filters are stated
  twice** — in the list for the cards, in `BoardService.conditions` for the figures — because
  unifying them means editing `list`, which another branch is editing now. The contract test
  holds the two to the same answers for `q` (title and organization name),
  `organizationId`, `salesChannelId` and the creation dates. **Owed after the US3 / US6
  merges:** `tagId` and `assignedAdminUserId` are refused by the board with 422 — it refuses
  before it reads, so it never answers cards filtered one way and counts another — and the
  story that teaches the list either filter adds it to `conditions` and replaces the 422 case
  of the test. Moving `conditions` into a function `list` also calls is the tidy-up that
  becomes possible then. (d) A malformed query (`perColumn=0`, `201`, a non-uuid id) answers
  **400** `VALIDATION_FAILED` — the platform's answer for a schema failure, where T088's
  first draft assumed 422. (e) **SC-006, measured** on the test harness (`app.inject`, one
  Organization, this worktree's Postgres): 500 open Opportunities over four statuses, twelve
  requests each, the first two discarded — `perColumn=50` median **56 ms** (max 64 ms, 99 kB),
  `perColumn=200` median **65 ms** (max 96 ms, 247 kB, every card of every column); the list
  at `limit=200` for comparison, 24 ms. Sequential per-column list calls are the bulk of it
  and were kept sequential on purpose: asking six columns at once takes six connections from
  the pool for one request. **[unverified]**: a real network, a cold database, and a
  Sales Representative's allowed-set predicate at that size.
- **N-C3 (2026-10-05, T089/T091) — what the board screen does that the tasks could not have
  known.** (a) **A card's permitted moves come from `GET /workflow`, not from the card.** The
  board answers `OpportunitySummary`, which has no `allowedTransitions` (only the detail
  does). `canDrop` and the "Move to…" menu are therefore the workflow's edges out of the
  card's status — the same graph the server walks — which is also why the lanes can be drawn,
  in a loading state, before `GET /board` has answered. A guard's veto is not in the graph and
  is met when the server refuses. (b) **The page moves the card, not the primitive.** The
  primitive's optimistic projection only covers a drag; the menu is a first-class path
  (SC 2.5.7), so the page relocates the card in its own state for both, adjusts the two lanes'
  counts and per-currency totals in cents, and puts the card back at its old index on a
  refusal. The promise handed to `KanbanBoard.onMove` still rejects — that is the primitive's
  rollback and its spoken message (`labels.moveFailed`, with the server's sentence) — after
  the page has set the visible error. (c) **After a refusal the board is read again only when
  the refusal says the board is stale**: any 409 but `CRM_TRANSITION_VETOED`. A veto changed
  nothing, and re-reading would collapse a lane the operator had expanded. (d) **A refused
  Order is shown twice and dismissed once**: a notice above the board names each Order with
  the Order workflow's own reason and links to the Opportunity (where *Retry* and *Dismiss*
  live), and the card carries a count for the rest of the visit. Dismissing the notice hides
  the notice; the card's marker and the Opportunity's unresolved outcome are untouched. The
  marker does not survive a reload — `OpportunitySummary` carries no unresolved-outcome count,
  and adding one is a contract change no task asked for. (e) **"Move to…" is a disclosure,
  not a floating menu**: a labelled button revealing a list of buttons inside the card. The
  kit's `RowActionMenu` is the only menu it publishes and its trigger is a fixed 32 px icon
  with no visible label; the `DropdownMenu` parts are not on a barrel a module may name. In
  the page flow it cannot be clipped by the lane, needs no positioning, and each target is a
  full-width, 44 px-tall button on a phone. Its accessible name contains its visible label
  (SC 2.5.3): "Move to… — <title>". (f) **A lane is continued from the list endpoint.** §10
  has `perColumn` and `hasMore` and no cursor, so *Show more* asks
  `GET /opportunities?statusCode=<code>&limit=200` under the same filters — the first time
  replacing the lane's cards with that longer first page (same order, N-C2 (a)), then
  following the list's cursor. One redundant read of at most `perColumn` rows, against a
  contract change. (g) **The card's title link is inline, not block.** A link never starts a
  drag (the primitive's rule), so a block-level title took the whole first row of the card
  away from the pointer — found in the browser, not by a test. (h) The transition's `reason`
  is not asked for on the board; a move there is one gesture.
- **N-C4 (2026-10-05, T092) — the filter fields are one component for both screens.**
  `components/OpportunityFilterFields.tsx` renders the five filters §1 and §10 share (text,
  Organization, Sales Channel, created from / to); the list passes its two own fields (state,
  status) as children, and `OpportunitiesList.test.tsx` passes unchanged. `api.ts` has the
  matching `OpportunityFilterParams` and one `appendSharedFilters`. The assignee and tag
  filters are in neither screen and cannot be sent — the types do not carry them. The story
  that serves one adds a field to that component, a key to `SharedOpportunityFilters` and a
  line to `sharedFilterParams` / `appendSharedFilters`; neither screen is restructured. The
  board has no sort control: its lanes are in the list's default order (newest first), which
  is what makes (f) of N-C3 seamless.
- **N-C5 (2026-10-05, T093) — the board in a browser, and what a person still has to
  check.** Headless Chromium (Playwright 1.60) against the admin's Vite dev server and the
  backend test composition on a throw-away `_test` database (N-30's arrangement; created and
  dropped), seeded with 64 Opportunities in six statuses, an Order in a terminal status linked
  to one of them, and a guard vetoing one deal's move to *won*. **Desktop, 1440 px — 24 of 24
  checks**: the sidebar row between *Opportunities* and *Workflow*; the palette action; a
  mouse drag onto an allowed lane (one `POST …/transition`, 200); a drop on a refused lane
  (nothing called); the keyboard path from the handle — Space, →, Space — with each
  announcement read back from the live region, a keyboard drop on a refused lane and Escape;
  the "Move to…" menu listing exactly *Proposal, Lost* for a *Qualified* card, moving it, and
  closing on Escape with focus back on its button; the Order that did not follow, above the
  board and on the card; the vetoed drag (card back in *Negotiation*, the guard's sentence on
  screen and in the live region); a move refused because the transition had been removed
  under the board (the server's sentence, and the board re-read); search; *Show more*
  (50 → 54 through the list endpoint); tab order inside a card (handle → title → menu); no
  console error or warning once the shell had loaded, no failed request but the three
  deliberate 409s. (On a first paint the shell asks for every module's `nav.*` keys before the
  bundles arrive and warns per key, CRM's three included; the labels are right a moment
  later. That is the shell's and was left alone.)
  **Read-only role**: cards, no handle, no menu, the explanation. **390 px with touch
  emulation**: the page does not scroll sideways and the board scrolls inside its region; a
  tap on "Move to…" (212 × 44 px) moves the card; a swipe over a card scrolls the board and
  lifts nothing; a 400 ms press lifts it and a drop moves it. **Polish**: the row *Tablica*,
  the heading, the lanes, the menu, the handle's name and every announcement, with no key and
  no English string left; no sideways scroll at 390 px.
  **Found on the way, not defects of this story's code but worth a decision:**
  (1) six lanes are 1 796 px and the content area beside the sidebar is 1 136 px at 1440, so
  the two last lanes are reached by scrolling the board (the library scrolls it while a card
  is dragged to the edge); (2) lanes are as tall as their longest one — fifty cards is about
  8 000 px of page — because the primitive gives a lane no height of its own; (3) the
  primitive's drag handle is 28 × 28 px, above WCAG 2.2 SC 2.5.8's 24 px and below this
  repository's 44 px rule; (4) a role with `crm:read` and `orders:read` only gets 403 from
  the Organization and Sales Channel pickers of the shared filter bar (their endpoints have
  their own codes) — on the list as on the board; (5) an arrow key sent with no pause after the
  Space that lifts a card is ignored — observed; the library appears to attach its key
  listeners a tick after the lift — which a script meets and a hand cannot; (6) a card lifted with the keyboard stays lifted if the
  pointer is then used elsewhere, until Escape.
  **Not verified, and owed to `endora-commerce-designer` before T093 is ticked:** a physical
  touch device (press-and-hold feel, the 250 ms delay against scrolling, drag near the screen
  edge, the 28 px handle under a thumb); a real screen reader in both languages (NVDA /
  VoiceOver: whether the handle's role description, the instructions and the live-region
  sentences are spoken once and in a sensible order, and how the disclosure's group is
  announced); dark theme and contrast of the dimmed refused lanes; zoom at 200 % and reflow
  at 320 px; reduced motion; a board with a dozen statuses; long titles and long Organization
  names; Polish plural forms where a count follows a colon by design.
- **N-C6 (2026-10-05, T091) — N-K3's prediction, measured with the real consumer.**
  `pnpm --filter admin run build` before this story: entry chunk **1 874 213 bytes**
  (595.22 kB gzip), no chunk containing `@dnd-kit`. After: **1 916 576 bytes** (608.86 kB
  gzip) — **+42 363 bytes, +13.6 kB gzip** — with `@dnd-kit/core` in the entry chunk and the
  board page itself a lazy chunk of 21.18 kB (7.48 kB gzip). N-K3 predicted +41 989. The
  lever it names (`"sideEffects"` on the kit's manifest) is still not pulled.
- **N-D1 (2026-10-05, after the merge of the backend wave) — what the merged tree owed, and
  what it did not.** Measured on `367bd3d0e` after `pnpm run build:packages`: `typecheck` and
  `lint` clean; `composer:check` and `manifests:check` up to date; the OpenAPI baseline
  **already matched** (git had merged the two sides' CRM paths without a conflict, and
  `UPDATE_OPENAPI_BASELINE` had nothing to write). Stale: the two Polish translation-cache
  entries (taken from one side of the merge, while the materialised Polish pages had merged
  cleanly and were the complete ones — the caches were rewritten from them); the module page's
  *Coming* list and *Permissions* table, which still announced reverse mapping, assignment,
  notes, attachments and tags as future; the sections of that page, which the merge had left
  in arrival order (*Coming* in the middle); and one changeset saying the board refuses the
  two filters "which a later release serves". `crm` joined `MIGRATED_MODULES` in
  `backend/scripts/check-command-coverage.ts` (N-B11): the list's own header asks for a new
  module "as it lands", and outside `--strict` a module that is not on it is only warned
  about. The file is now a row of `contracts/foreign-module-changes.md` §E. Polish wording:
  *Dismiss* is "Pomiń" on the button, in the module page and now in the audit label
  ("Pominięto odmowę zmiany statusu zamówienia"); the page says "handlowiec" throughout.
- **N-D2 (2026-10-05, T088 follow-up) — the board applies the assignee and tag filters, and
  still states them twice.** `BoardService.conditions` gained the two filters N-C2 (c) left
  owed, in the list's terms: `assignedAdminUserId` = `me` | `unassigned` | an id, and a
  repeated `tagId` = every tag named, through the tag service's own
  `opportunityIdsCarryingAll` (handed in as a function, as the list is). A filter nothing can
  satisfy — a tag set no Opportunity carries, "mine" with nobody asking — answers every
  column, empty, rather than an error. `board.contract.test.ts` holds cards, counts and
  totals to the list's answer for each. The tidy-up N-C2 names — one `conditions` function the
  list also calls — was **not** made: `opportunity-service.ts` is being edited on the sibling
  branch.
- **N-D3 (2026-10-05, T063) — the reverse table is keyed by Order status, and one thing T063
  asks for cannot be shown.** (a) One row per **Order** status, not per Opportunity status:
  the server's rule for this direction is `mapping_duplicate_order_status`, so an Order status
  has one choice and several rows may choose the same Opportunity status. (b) "Only when every
  linked order is there" is ticked when the chosen target is of kind `won` or `lost` and is
  re-applied whenever the target changes; a stored mapping shows what is stored. (c) **An
  unknown Order status is decided from `GET /api/v1/admin/orders/statuses`**, as N-B1
  recommends, not from `orderStatusKnown`: a mapped code the Orders module no longer answers
  gets a row of its own, says so, and is removed by choosing "Leave the opportunity as it
  is". (d) Both tables are one draft and one *Save mappings*, because the endpoint replaces
  the whole set. (e) **Not done: "show the cause Order on `OverviewTab.tsx`".**
  `OpportunityDetail` carries no status history — `causeOrderId` is on the events, in the
  status-history table and in the audit entry (N-B3) — so the Overview has nothing to read
  it from. The change history tab of User Story 11 is where it will be shown; adding a field
  to the detail for it is a contract change no task asks for.
- **N-D4 (2026-10-05, the picker defect of N-C5 (4)) — CRM answers its own pickers; `requires`
  was not the fix.** Measured first: the kit's `OrganizationPicker` reads
  `GET /api/v1/admin/organizations` (`customers:read` or `customers:manage`),
  `SalesChannelPicker` reads `/api/v1/admin/sales-channels` (`sales_channels:read`),
  `CustomerPicker` reads `/api/v1/admin/customers` (`customers:read`), `AdminUserPicker` —
  which T071 names for the assignee — reads `/api/v1/admin/admin-users`
  (**`admin_users:manage`**), and `CurrencyPicker` reads `/api/v1/admin/dictionary/currencies`
  (the dictionary's *write* code). So the defect was wider than the report: the create form's
  contact and currency fields failed the same way, and the assignee picker would have.
  **How `requires` is consumed:** `missingPermissionRequirements` in
  `packages/contracts/src/admin.ts` and the role editor — a suggestion beside a checkbox;
  "nothing here refuses anything". It is how `rfqs:handle` names `price_lists:read` (D-173),
  and `quote_requests`' own list uses the kit's `OrganizationPicker` with no requirement
  declared for it — whether its Sales Rep meets the same 403 was not measured here. **Why it was not used here:** declaring
  `customers:read`, `sales_channels:read`, `admin_users:manage` and a dictionary write code
  as what a Sales Rep "should also hold" would make assigning an Opportunity cost the right
  to manage administrators. That is a wider grant than any CRM screen needs, and an operator
  following the advisory would hand it out.
  **What was built:** four reads under `/api/v1/admin/crm/lookups/` — `organizations`,
  `sales-channels`, `assignees` (`crm:read`: the list and the board filter by them) and
  `contacts` (`crm:write`: chosen on the forms only) — in one new service
  (`services/crm-lookup-service.ts`), one new route file and one delimited section of
  `index.ts`. Each goes through the owner's published read port (`organizationDetailsPort`,
  `adminUserReadPort`, `customerAccountReadPort`) or, for channels, the kernel's `SalesChannel`
  entity the module already reads; every owner was already a binding dependency, so the
  manifest's edges did not change and `check:port-dependencies` asked for nothing.
  **Tenant scope is applied by name** (N-14: the Organization port answers whoever asks): a
  platform administrator searches by name through the port; a confined one is offered the
  Organizations of `orgConstraintFor()` and nothing else, searched in memory so a page of
  platform-wide matches can never crowd theirs out; contact persons are offered only for an
  Organization `isOrgInScope` accepts, and an out-of-scope one answers an empty list, not a
  refusal. Answers are the minimum a picker shows: `id` + `name` (an assignee's e-mail is
  searched and not returned; a contact's is returned because the screen shows it).
  **No other module's gate changed**, and `lookups.contract.test.ts` holds that: the same
  role still gets 403 from all four owners' lists, with the platform administrator as the
  positive control.
  **On the screens** the kit's pickers were replaced by `components/LookupPickers.tsx` — the
  same props, on the kit's `Combobox` — in the filter bar, the create form and the edit form;
  `admin/test/modules/crm/lookups.test.tsx` makes every foreign list reject and asserts none
  was asked. Three things fell out: (a) the contact picker is now driven by the tests instead
  of stubbed (N-27) and names the person already chosen itself (N-C1 (e)), so
  `opportunity.edit.contactCurrent` is gone; (b) **the currency of a new Opportunity is chosen
  from the currencies the active Sales Channels sell in**, not from the currency dictionary —
  a behaviour change of the create form, made because the dictionary's list is behind its
  write code and neither `dictionaries` nor `currencies` is a dependency of this module;
  (c) the Overview's Sales Channel name comes from the same lookup. **Left as it is:** the
  Organization's name on the Overview links to `/organizations/:id`, which a role without
  `customers:read` cannot open — a link, not a failing read; and the kit's pickers
  themselves, which every other module's screens still use.
- **N-D5 (2026-10-05, T071) — what the assignment screens do that T071 leaves open.**
  (a) **The picker is CRM's `AssigneeLookup`, not the kit's `AdminUserPicker`** T071 names:
  that one reads `admin_users`' list under `admin_users:manage` (N-D4). (b) **On the
  Opportunity, choosing is assigning** — one field, no *Save*; clearing it posts
  `{ adminUserId: null }`. A refusal is shown in the server's sentence and the field returns
  to the current assignee. (c) **The create form sends an assignee only when one is chosen**;
  empty means "apply the default rule" (absent), and there is no way on that form to ask for
  "explicitly nobody" (`null`) — unassign on the Opportunity afterwards. (d) **The filter is a
  select plus a conditional field**: *Anyone / Mine / Unassigned / A specific person…*; "a
  specific person" filters nothing until somebody is chosen. It is one of the shared filter
  fields, so the board has it too (N-C4), and the board's cards carry the same *inactive*
  marker. (e) The marker is the summary's `assignee.active`; `board.card.unassigned` was
  folded into `assignment.unassigned`. (f) The edit form still has no assignee field
  (N-C1 (b)): the section above it is the one place to change it.
- **N-D6 (2026-10-05, T086) — what the tag screens do that T086 leaves open.** (a) **In
  Polish a tag is "Etykieta"**, on the sidebar row too (`contracts/admin-surfaces.md` §2 said
  "Tagi"; the coordinator's brief and the module page say "Etykiety", and the contract line
  was brought in line). (b) **No palette action**: §3 of that contract names three and the
  tag list is not one of them. (c) **Tagging on the Opportunity is one gesture** — each tick
  is a `PUT …/tags` with the whole set, in the tag list's order, and the answer is put on
  screen; there is no *Save*. (d) **The tag control is the kit's `MultiSelect`** in all three
  places (Opportunity, create form, filter), fed by one `GET /tags` per screen; with no tags
  defined it is disabled and says so. (e) The filter is labelled "Tags (all of them)"
  because several tags mean AND, which a bare "Tags" would not say. (f) The delete
  confirmation names `usageCount`, which is the number of Opportunities **the operator can
  see** carrying the tag (N-B9) and says so — the tag leaves the others as well. (g) An edit
  sends only the changed fields; an untouched dialog is no request. (h) The edit form of an
  Opportunity still carries no tags field (N-C1 (b)); the *Tags* section is the one place.
  (i) `GET /tags` is `crm:read` while the screen opens on `crm:configure`: every control on
  it is a write, as on *Workflow*.
- **N-D7 (2026-10-05, T076) — what the Notes and Messages tabs do that T076 leaves open.**
  (a) **One thread component for both tabs** (`components/CommentThread.tsx`) beside the one
  composer T076 names; the two tab files only hand it their sentences, so no key is composed
  at run time. (b) **"Mine" is `useAuth().me.adminUser.id` against `author.id`**, and *Edit* /
  *Delete* are offered for a **note**, to its **author**, who also holds `crm:write` — the
  platform administrator sees neither on a colleague's note, which is what the server
  answers (N-B12). The server's refusal is still shown if one comes. (c) **A note is edited
  in place**, not in a dialog; a refused edit keeps what was typed. Deleting asks first and
  says the text stays in the change history. (d) A written entry is appended from the
  endpoint's answer rather than by reading the list again; the lists are not polled, so a
  colleague's message appears on the next visit to the tab. (e) An empty entry is refused on
  screen; the 10 000-character limit is the field's `maxLength`. (f) **With the second tab
  the tab strip appears** (N-28 (i)); the tabs are not routes, so a link cannot open one.
- **N-D8 (2026-10-05, T081) — the Attachments tab, and one permission it cannot work
  around.** (a) **The upload is the media library's, and so is its gate.** The kit's
  `AssetUploader` posts multipart to `POST /api/v1/admin/assets`, which is
  `assets.write` — a code a Sales Rep holding only CRM's does not hold. The tab therefore
  offers *Add a file* to a holder of `crm:write` **and** `assets.write`, and tells a holder of
  `crm:write` alone why there is no button; listing, downloading and removing need nothing of
  the library's. This is the same shape as the picker defect (N-D4) and was **not** repaired
  the same way: a CRM-owned upload would have to carry multipart through a port that takes
  none today. Reported for a decision — an upload seam on `assetsLibraryPort`, or
  `assets.write` named in `crm:write`'s `requires`. (b) `visibility: 'private'` is passed as
  the uploader's `defaults`, and the test asserts it: the backend refuses anything else
  (N-B17 (a)). (c) **Download reads the list again and opens the link it was just given**
  (`window.open(url, '_blank', 'noopener,noreferrer')`), because the one on screen may be
  minutes old; `url: null` on that read — the file gone from the library (N-B17 (e)) — is
  said and nothing is opened. The open happens after an `await`; browsers honour it inside
  the transient-activation window of the click, which a slow list read could outlast
  **[unverified beyond the browser walk]**. (d) Attaching the same asset twice answers the
  existing attachment (N-B17 (d)); the list does not grow a second row. (e) Removing asks
  first and says the file stays in the library. (f) A size is rendered by `Intl.NumberFormat`
  with a unit, in binary steps, so no unit string is hand-written in either language.
  **Superseded by N-F1 on (a): the upload is CRM's own endpoint, under `crm:write` alone.**
- **N-D9 (2026-10-05, the stories' browser walk) — user stories 2–6 and the picker repair,
  walked in a browser.** N-30's arrangement: headless Chromium (Playwright 1.60) against the
  admin's Vite dev server and the backend test composition on a throw-away `_test` database on
  this worktree's Postgres, created and dropped with its template — the stub admin session,
  real routes, real `orders` and a real media-library upload. **The dev server serves the
  module's `dist`**, not its source: an edit to a screen is invisible to it until
  `pnpm --filter @endora-commerce/mod-crm run build`, which is how the one fix below first
  appeared not to work. **English, 1440 px — 32 of 35 checks on the first pass; the three that
  failed were the walk's own misreads, named below, and one of them had aborted the
  assignment block, which then passed 9 of 9 on its own after the selector was corrected. The
  whole walk was not repeated end to end afterwards.** What was seen: the Tags
  row between *Board* and *Workflow*; a reverse mapping *Paid → Qualified* (toggle clear) and
  *Completed → Won* (toggle ticked by default) saved in one write, then the Order's status
  changed **on the Order screen** and the linked Opportunity read back as *Qualified*; an
  unassigned Opportunity assigned by choosing a person, the list and the board filtered to
  *Mine* showing exactly it and *Unassigned* the other three; a tag created, the same name in
  another case refused in the dialog with the server's sentence, the Opportunity tagged, the
  list and the board filtered to it; a note added, edited in place and marked *edited*, a
  message sent with no way to change it; a file uploaded (`201 POST /api/v1/admin/assets`,
  `201 POST …/attachments`), listed with its size and uploader, downloaded — the list read
  again and a new tab opened on `…/assets/file/<id>?token=…&exp=…` — and removed. **The role
  holding only `crm:read` and `orders:read`**: the Organization and Sales Channel filters of
  the list and the board offered their options and narrowed both, every lookup answered 200,
  and nothing a CRM screen asked for was refused. **Polish — 6 of 6**: the sidebar rows, the
  *Handlowiec* filter and column, the *Handlowiec* and *Etykiety* sections, the four tabs, no
  untranslated key, no failed request.
  **One defect found and fixed:** the tag filter sat 6 px above its neighbours in the filter
  bar — its label was a block-level `span` where the kit's `Label` is inline, and the kit's
  `MultiSelect` trigger is an inline-level button with a descender gap under it. Measured
  before (label top 261 against 265) and after (265, control 285, as the Organization field).
  **The walk's own three misreads:** `getByText('Unassigned')` also matched the hint under the
  field; Chromium logs a console line for the deliberate 409 of the tag-name refusal; and
  **the shell asks `GET /api/v1/admin/settings/admin.idle_logout_minutes` on every page, which
  answers 403 to this role** — not a CRM request and not repaired here, but a red line in
  every Sales Rep's network panel, reported for whoever owns the shell's idle-logout read.
  Not verified by eye: a real screen reader, a physical touch device, dark theme, a popup
  blocker stricter than Chromium's default on the download's new tab (N-D8 (c)).
- **N-E1 (2026-10-05, T095) — R-14's [unverified] premise about how a quote is totalled,
  re-derived; the formula stands with two corrections.** `RfqDetail.tsx` shows, per line,
  `agreedUnitPrice × quantity`, falling back to `desiredUnitPrice × quantity`; its total row is
  `Σ agreedUnitPrice × quantity` and is shown **only when every line has an agreed price**
  (`rfq-service.ts`' `summarize` computes the same `totalAtAgreedPrice`, `null` otherwise).
  **The packaging unit's base quantity multiplies nothing** on that screen, so it multiplies
  nothing here. CRM's figure is `Σ quantity × (agreedUnitPrice ?? desiredUnitPrice)`, which is
  the sum of the desk's line totals and equals its total row whenever it shows one
  (`value.test.ts` compares the two after an agreed revision). Corrections: (a) **quote prices
  are net** — the desk adds VAT below the net total from `rfqService.taxRateForOrganization`,
  which `quoteRequestReadPort` does not publish, so CRM counts the **net** total; (b)
  `QuoteRequestLineRecord`'s doc comment says "the money columns are deliberately absent"
  while the interface carries `lineCurrency`, `agreedUnitPrice` and `desiredUnitPrice` (added
  for the ERP export callers) — the comment is stale, the fields are published, and no change
  to `QuoteRequestReadPort` was needed. `findById` and `listItems` are one call each per
  linked Quote Request; the port has no batch read.
- **N-E2 (2026-10-05, T102) — `OrderRecord.total` is gross.** `order-service.ts` computes it as
  `subtotal + taxTotal + deliveryTotal + paymentSurcharge − discountTotal`: what the customer
  pays, delivery included. It is used as published. So a computed value adds **gross Order
  totals and net Quote Request totals**; neither is converted, each is what its own screen
  shows, and the docs page says so in both languages. **Currency**: an Opportunity has one;
  nothing is converted (R-14's "no rate source" still holds for a module — `currencies` is a
  module with its own ports, and converting is a feature nobody specified). A counting document
  in another currency is left out and named in `excludedDocuments` with
  `reason: 'currency_mismatch'`; a Quote Request with lines in several currencies counts its
  matching lines and is named as well. A document that would not have counted anyway is not
  named. Linking a document in another currency is **not** refused.
- **N-E3 (2026-10-05, T095) — nothing in the tree writes `orders.source_quote_request_id`. A
  pre-existing defect of the quote-to-order flow, reported and not repaired.** The column, the
  `OrderRecord.sourceQuoteRequestId` field and `quote_requests`' `order-completion-reactor.ts`
  (which completes a Quote Request and sets `convertedOrderId` when an Order names it) all
  exist; `placeOrder` never sets the field, and `POST /quote-requests/:id/convert-to-order`
  fills a cart that keeps no reference to the request. So today no Order placed through the
  product carries its source, no Quote Request is ever completed by one, and
  `quote_requests`' own test of the reactor writes the Order row by hand
  (`backend/test/integration/quote_requests/off-state.test.ts`, "written directly rather than
  checked out"). **Consequence for this feature:** FR-027 (the Order joins the Opportunity of
  its Quote Request) and FR-033's "counted once" are implemented against the published
  contract and proven with that same fixture, and are **unreachable from the storefront until
  `orders` records the source** — a change to `carts`/`orders` that is on no list of this
  feature. Until then an Order placed from a linked Quote Request is a separate, unlinked
  Order, and with automatic creation on (US9) gets an Opportunity of its own.
- **N-E4 (2026-10-05, T098–T100) — what the value story decided that the contract leaves
  open.** (a) `computed_value` is maintained **only while the mode is `computed`**; a `PATCH`
  that makes the mode `computed` recalculates, and `manualValue` is kept either way. (b) A
  recalculation is a Command with `skipAudit` (`crm.opportunity.value_recalculate` — never in
  the audit log) and **does not bump `version`**, so an open edit form is not invalidated by a
  linked Order being paid. It evaluates under a row lock, so two recalculations of one
  Opportunity are serial. (c) `excludedDocuments` is **evaluated on read** of the detail (the
  stored figure has no room for names) and is `[]` in manual mode. (d) `PUT
  /value-counting-statuses` answers **202 `{ data: OpportunityWorkflow }`**, sorted and
  de-duplicated; an Order status code is not validated (N-8), a Quote Request status outside
  the six is 400. (e) **"Counted once" is decided from either side**: `convertedOrderId` on
  the Quote Request *or* `sourceQuoteRequestId` on the Order — the first is written by
  `quote_requests`' own `order.created.v1` subscriber, which may run after CRM's. (f) A Quote
  Request reaching `Completed` announces nothing (`quote_requests` emits no event for it), so
  a value that counted it as `Approved` is corrected at the next trigger, not at once.
  (g) With `quote_requests` switched off and on again, a stored value catches up at its next
  recalculation, not at the flip — nothing subscribes to another module's activation.
  (h) `syncStatus` is stored for a Quote Request link and means nothing.
- **N-E5 (2026-10-05, T099) — the `degrades-without` edge, and one sentence that had to
  shrink.** The manifest schema caps `whenAbsent` at 200 characters; the sentence of
  `contracts/events-and-ports.md` §5 is 213. The manifest says "…stop counting toward computed
  values, and can no longer be linked or created from one. Opportunities and their Orders keep
  working" (190 characters) — the same statement; the contract's wording was not edited.
  Presence is decided in one file, `services/crm-quote-requests.ts`: rendering and the value
  skip an absent owner, and linking throws `ModuleDisabledError('quote_requests')` **from that
  decision**, so the answer is 503 `MODULE_DISABLED` on both axes (deactivated and
  platform-unavailable) and no refusal is ever caught. `check:port-dependencies` accepted the
  edge with no ledger edit. An existing Quote Request link can be removed while the owner is
  off.
- **N-E6 (2026-10-05, T100) — composition: three more subscriptions and a queue, in one
  delimited section of `index.ts`.** `compose/value.ts` does not exist (N-6). The value
  subscriber of `order.status_changed.v1` is a **second** `ctx.subscribe` beside the reverse
  mapping's rather than a line inside it (`contracts/events-and-ports.md` §2 draws one
  handler); they share nothing, and the bus runs them in registration order, so the value is
  recalculated after the Opportunity has moved. The four `rfq.*` payloads carry `rfqId` only —
  no Organization — so the handler finds the link by document and works in a system scope.
  The queue is `crm-value-recalculation`; its producer is built lazily on `moduleQueueRedis`
  and its consumer only where `processRunsWorkers` says so, attached with `ctx.worker`. The
  shared test server offers neither, so `value.test.ts` runs the job's body
  (`recalculateAll` in a system scope) through the container. `bullmq` and `ioredis` joined
  the rendered `package.json` as peers, as T102 predicted.
- **N-E7 (2026-10-05, T103) — the premise "the `order.created.v1` subscriber sees the
  committed Order" is FALSE, measured.** `orders` emits the event from **inside** the
  transaction that places the Order (`order-service.ts`: `await tx.flush()`, then the emit,
  then more work, then the transactional callback returns), the storefront route calls
  `placeOrder` with no event scope around it, and the bus runs a handler at once. A probe
  subscriber reading through `orderReadPort.findById` on three storefront placements
  (`POST /api/v1/cart/items`, `POST /api/v1/orders`): the first placement was **not found**
  at once and found 5 ms later; the second and third were found at once — a race with the
  commit that a warm connection usually wins. (`quote_requests`' completion reactor reads the
  same way and has the same exposure; it never shows, because of N-E3.) `orders` is not
  edited. The CRM handler **waits for the commit**: it reads the document again after 10, 25,
  75, 150, 250, 500 and 1000 ms (about two seconds in all) and gives up — creating nothing —
  for a document that never appears, which is what a rolled-back placement looks like. The
  pauses are a constant in `opportunity-auto-create-service.ts`; the unit test injects the
  sleep and holds both the retry and the bound. **The repair that removes the wait is
  `orders`'**: emit after the commit, or run the placement inside `EventBus.run`. Reported, not
  made — it is on no list of this feature.
- **N-E8 (2026-10-05, T106) — what automatic creation decided.** (a) **The Opportunity and its
  link are one Command** (`crm.opportunity.create`, with the link written by
  `OpportunityService.createForDocument`): the unique `(document_kind, document_id)`
  constraint then rolls a second Opportunity back together with its refused link, so a
  redelivered event or two racing handlers cannot leave an Opportunity without its document.
  T106 sketched "create through `OpportunityService`, then link"; two Commands could. The
  constraint violation is answered `already-linked`. (b) A Command declares one event, and
  that one is `crm.opportunity.created.v1` (`source: 'order' | 'quote_request'`);
  `crm.opportunity.document_linked.v1` (`linkSource: 'auto'`) is emitted by the service after
  the commit — once per created Opportunity and never for a rolled-back one, which is what
  `contracts/events-and-ports.md` §1.2 promises, by other means. (c) The audit entry of an
  automatic creation has no actor, and its after-state carries `source` and `linkedDocument`.
  (d) **A Quote Request's Sales Channel is not published** — `QuoteRequestRecord` has no
  `salesChannelId` although the row does, and `contracts/foreign-module-changes.md` §F
  forbids changing that port — so an Opportunity created from a Quote Request has **no Sales
  Channel**, and `crm.auto_create_from_quote_requests` is read platform-wide (`null`), not
  per channel. For an Order both follow the Order's channel, and a per-channel override is
  honoured in both directions (`auto-create.test.ts`). (e) A Sales Channel that no longer
  exists is left out rather than failing the creation. (f) The contact person is not set:
  R-8 does not list it. (g) An Order an administrator places on a customer's behalf goes
  through the same `placeOrder` and gets its Opportunity; a Quote Request an administrator
  creates emits no `rfq.created.v1` and gets none until US10's event. (h) The unified
  `order.created.v1` subscriber replaced User Story 8's: quote conversion first, whatever the
  setting says, then "already linked", then the setting. `compose/auto-create.ts` does not
  exist (N-6). (i) `zod` joined the package's peers — the settings port takes a Zod schema —
  which closes N-B2's "the CRM package does not depend on `zod`".
- **N-E9 (2026-10-05, T104) — the off-state harness's "setting is not editable while off"
  probe is vacuous, for every module. Pre-existing, reported, not repaired.**
  `expectSettingWriteRefused` in `backend/test/helpers/off-state.ts` sends
  `PUT /api/v1/admin/settings/:code/value` with `{ value }`. The route parses
  `SetValueRequestSchema` first, which requires `scope`, so the call answers 400
  `VALIDATION_FAILED` **while the module is on** as well (measured here, on `crm`), and the
  helper asserts only `>= 400`. The real refusal is also a 400, `MODULE_SETTING_READ_ONLY`.
  CRM's own off-state file therefore writes each of its two settings with the body the
  Settings screen sends (`{ scope: 'all', value }`), asserts 200 while on, and asserts the
  refusal **by code** on both axes. The helper is shared by every module's off-state test and
  is not this feature's to change.
- **N-E10 (2026-10-05, T121) — the history endpoint: what R-16 could not have known about
  the audit port.** `AuditPort.query` takes `{ objectType, objectId, action, actor…, limit }`
  and nothing else — **no cursor, no offset** — answers newest first, and caps `limit` at 500.
  So `GET …/history?limit&cursor` cuts its pages from one capped read: the cursor is an
  offset (opaque, base64url, 400 `VALIDATION_FAILED` when it is not one this endpoint issued),
  `limit + offset + 1` rows are asked for to know whether a next page exists, and **a history
  reaches back 500 entries** — the 501st and older are unreachable through this endpoint
  until the port grows a cursor (a platform change, not this feature's). The entries are
  exactly §11's six fields; `ipAddress`, `userAgent`, `requestId` and the impersonated
  customer of the audit row are **not** returned — the tab is read by Sales Reps, not by
  whoever holds `audit_log:read`. `actor.kind` is `admin` when the row has an administrator
  and `system` otherwise (`{ kind: 'system', id: null, name: null }`); an administrator who has
  since been deleted is `admin` with `name: null`. **Status history is not read**: the audit
  entry of a transition already carries `status` before and after, `cause`, `causeOrderId`
  (N-B3) and `reason`, which is everything the status-history row holds, and R-16 keeps that
  table for analytics. Tenant safety is the parent-first rule (N-15): the Opportunity is
  loaded through the scoped EntityManager, then entries are read by its id — an audit row
  belongs to no Organization and nothing else filters it. `compose/history.ts` does not exist
  (N-6); the section registers its own `ctx.routes`.
- **N-E11 (2026-10-05, T120) — the sweep found no Command recording the wrong object, and
  two tests now hold what it found.** `audit-coverage.test.ts` performs every audited
  Opportunity action through the API — eighteen: the list of `data-model.md` § Audit actions
  without `value_mode_set` (which is a field of `update`, never an action of its own) and with
  `propagation_skip` (N-B3) — and asserts each is recorded under `crm_opportunity` and the
  Opportunity's id; its last case holds that list equal to the `auditLog.crm.opportunity.*`
  keys of the bundle. `opportunity-history-labels.test.ts` (module-local, no service) scans the
  services for every `crm.<object>.<verb>` literal and holds each audited one to a sentence in
  **both** bundles, and each `auditLog.crm.*` key to a Command that exists. Three actions are
  never audited (`propagation_record`, `propagation_echo`, `value_recalculate` — `skipAudit`
  on every path) and have no label. So the contract the admin tab relies on is: **label =
  `auditLog.<action>` in CRM's bundle**, and the endpoint adds no label field of its own.
- **N-E12 (2026-10-05, T121) — N-22 investigated: `moduleIdForAuditAction` is a hard-coded
  prefix chain, not a registry.** It is one exported function at the bottom of
  `packages/modules/audit_logs/src/backend/routes.admin.ts`: eighteen `if
  (action.startsWith('<prefix>.')) return '<moduleId>'` lines — `settings`, `catalog`,
  `sales_channels` and `audit_logs` itself name their prefixes there; `api_key.`, `order.`,
  `organization.` and `impersonation.` are sent to `core` — ending in `return 'core'`. The
  route puts its answer on every row as `actionModuleId`, and the viewer looks
  `auditLog.<action>` up in that module's bundle. There is no roster, ledger, manifest field
  or contribution seam a module joins; its only test (`routes.admin.test.ts`) asserts the
  `tenant.` row. **The smallest correct fix is one line in that function** —
  `if (action.startsWith('crm.')) return 'crm';` — after which `crm.opportunity.transition`
  resolves to `auditLog.crm.opportunity.transition` in CRM's bundle, which exists in both
  languages for every audited action (N-E11). **Not applied**: it is production code of
  another module naming this one, not an exact-set ledger, and `audit_logs` is on no row of
  `contracts/foreign-module-changes.md`. The durable repair is the one the function's shape
  asks for — deriving the module from the manifests' declared audit prefixes — and is
  `audit_logs`' to design. Until either lands, `/audit-log` shows CRM's rows under their raw
  action codes; the Opportunity's own history is unaffected.
- **N-E13 (2026-10-05, T126) — references: three places where the build departs from the
  tasks' sketch.** (a) **The grammar stays in the contracts package**, where
  `extractOpportunityReferenceTokens` already was (its doc block: "the one place the grammar
  is written; the backend extracts with it and the admin's composer inserts with it").
  `domain/reference-tokens.ts` is therefore a two-line door to it (`referenceTokensOf`, which
  also answers for a text that is not there), and T124's cases — duplicates, malformed tokens,
  10 000 characters of almost-tokens in under 250 ms — are held against that door. The
  expression has no nested quantifier, so it is linear by construction. (b) **`syncForSource`
  is not a method of the reference service.** `check:command-coverage` reads a write in a
  helper of another file as unaudited (N-16; run by hand with `--module crm` it reported
  exactly that), so `ReferenceService.rowsFor` only says which rows a text asks for, and the
  delete-then-create is a private `#saveReferences` in each of the two services that own a
  saving Command (`opportunity-service.ts`, `opportunity-comment-service.ts`) — where the
  parent was loaded through the scoped EntityManager. (c) **On read the tokens come from the
  text, not from the rows.** The text is the truth and the rows are an index of who mentions
  what (the `(target_type, target_id)` index is for a later "where is this product
  mentioned"); resolving from the text cannot be stale. `resolveMany` resolves a whole page of
  comments in two port calls. `compose/references.ts` does not exist (N-6).
- **N-E14 (2026-10-05, T125) — what a reference shows, and to whom.** A Product's label is
  its name in the reader's stored language (`adminUserReadPort`, as N-17 does for statuses):
  the exact locale, then any locale of the same language — the catalog keys names `en-US` /
  `pl-PL` while an administrator's preference is `en` / `pl` — then any name, then the SKU.
  An Order's label is its number (`businessId`). URLs are the Admin UI's own
  (`/catalog/products/:id`, `/orders/:id`). **Unavailable** is: a Product that does not exist
  or is soft-deleted (`liveOnly`), and an Order `orderReadPort.findByIds` does not return
  under the reader's tenant scope — proven with a Sales Representative confined to one
  Organization reading a description that names another Organization's Order (no label, no
  URL, the number nowhere in the body; the platform administrator, as the control, sees it).
  **Products are not tenant-scoped and no catalog permission is asked**: whoever may read
  the Opportunity reads the names of the Products it mentions, as R-21 has it. A deleted
  note's rows are removed; a message is immutable, so its rows never change. No endpoint was
  added: `contracts/admin-api.md` §9 names none, and the composer's two pickers use the
  catalog's and the Orders' own admin endpoints.
- **N-E15 (2026-10-05, T163) — the reported webhooks defect, verified before touching the
  module; it is as R-27 says, and a little worse.** `KNOWN_EVENT_TYPES` in
  `packages/modules/webhooks/src/admin/pages/WebhooksPage.tsx` offers **thirteen** event
  types. `BRIDGED_EVENT_TYPES` in `packages/modules/webhooks/src/backend/index.ts` holds
  **two** — `order.created.v1`, `order.status_changed.v1` — and the loop over it was the
  module's only `ctx.subscribe`; `bridgeEventHandler` is called from nowhere else, and no other
  module adds a job to the delivery queue. `POST /api/v1/admin/webhooks` accepts any non-empty
  string as an event type. So a subscription to any of the other **eleven** is stored and never
  receives a delivery. Of those eleven, **six are emitted** by something in the tree and simply
  not bridged (`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
  `rfq.created.v1`, `rfq.expired.v1`, `credit_limit.adjusted.v1`), and **five are emitted by
  nothing at all** (`rfq.quoted.v1`, `rfq.accepted.v1`, `order.cancelled.v1`,
  `payment.settled.v1`, `credit_limit.reservation_released.v1` — no `emit` of those names
  exists outside tests; `order.cancelled.v1` is declared in `orders`' event map and emitted
  nowhere). **Not repaired**: `contracts/foreign-module-changes.md` §I and §F
  leave both lists untouched. The seam this story adds is the repair's shape — the six emitted
  types need one `register` each from their owners, and the five need deleting from the form
  — and is for the defect register.
- **N-E16 (2026-10-05, T167) — R-27's [unverified] premise holds: a `ctx.subscribe` issued
  from the registry during the boot phase is accepted, by the kernel and by
  `check:subscribe-seam`.** The kernel: `ModuleContext.subscribe` is
  `sink.unsubscribes.push(subscribeForModule(module.id, eventBus, event, handler))` with no
  `isRegistering` guard — `subscribeForModule` calls `bus.on` at once, with the handler
  wrapped in `effectiveState.isPresent('webhooks')`, so a late subscription is gated exactly
  as an early one. The only thing that differs is bookkeeping: `composeModules` copies each
  module's `unsubscribes` into its result when registration ends, so a later one is not in
  that copy — and **nothing in the tree reads that copy** (it is collected and never called;
  the bus lives and dies with its composition), so nothing is lost by it. The check: it is
  static, flags `<bus>.on(<event>, …)` in a module's files, and has nothing to say about a
  `ctx.subscribe` wherever it is called from; it is green. Proven end to end by
  `backend/test/integration/webhooks/contributed-events.test.ts`, which registers its
  descriptor **after** `runBootHooks()` has returned — later than any boot hook can — and
  observes the job enqueued, the Organization binding honoured, and nothing enqueued on either
  off axis. So the fallback (subscribing from a `webhooks` boot hook over `list()`) was not
  needed, and the ordering question it raises never arises: a contribution is bridged the
  moment it is pushed, whichever boot hook pushes it. The registry takes the subscribing
  function from `index.ts` (`bridge`), where `ctx` is, and the two built-in types now go
  through the same function. A contribution naming a type the module bridges already is
  recorded and **not** bridged a second time.
- **N-E17 (2026-10-05, T166/T169) — what the webhook contract fixed in place.** The three
  payload types are now `z.infer` of their strict schemas (`OpportunityStatusChangedEvent`,
  `OpportunityCreatedEvent`, `OpportunityClosedEvent`), so every emit site is typed by the
  schema and there is one definition; `OpportunityStatusEvent` (the four templated events and
  what a guard is handed) stays an interface — it is not offered to webhooks.
  `CRM_WEBHOOK_EVENT_TYPES` and `CRM_WEBHOOK_EVENT_SCHEMAS` name the three for the contributor
  and the tests. `occurredAt` is held to an ISO date-time with offset and `currency` to a
  three-letter code; `reason` to 2000 characters (the transition request's own limit).
  `crm/webhooks.test.ts` subscribes to the three on the bus through a manual create, a
  computed one, six transitions including reopen, won and lost, and an automatic creation from
  a placed Order, and parses every payload under `.strict()`. `GET
  /api/v1/admin/webhooks/event-types` answers `{ data: [{ ownerModuleId, eventType }] }` under
  `integrations:manage`, the gate of the module's other routes; no response schema was added
  to the contracts package beyond the two interfaces §I1 lists. The edge is `contributes-to`
  with a `reason` and no `whenAbsent`; `check:port-dependencies` and `check:port-shape`
  accepted the new container name with no ledger edit. Two test files the seam needed are new
  and are not rows of §I: `backend/test/integration/webhooks/contributed-events.test.ts` (T163)
  and `admin/test/modules/webhooks/contributed-event-types.test.tsx` (T165).
- **N-E18 (2026-10-05, T106 — a correction to N-E7) — the wait for a commit must not be
  awaited on the bus, and for one story it was.** `EventBus.dispatch` runs the subscribers of
  an event one after another and awaits each. User Story 9's handler slept until the Order was
  readable, so every later subscriber of `order.created.v1` waited with it — a few
  milliseconds when the race was lost, **the whole two seconds for an Order that never
  commits**. It was found by a neighbour's test, not by CRM's:
  `backend/test/integration/webhooks/off-state-bridge.test.ts` announces an Order that does not
  exist and gives the bridge 50 ms. Repaired in `opportunity-auto-create-service.ts`: the
  handler reads **once**; a document that is there is handled in the handler, as before; one
  that is not is looked for again through `defer`, which the composition supplies — off the
  dispatch chain, in a system scope of its own (the handler's ends when it returns), doing
  nothing if the module was switched off meanwhile, and logging rather than rejecting. The
  handler answers `deferred` at once. `idle()` resolves when no deferred look is running;
  `whenCrmEventSettled` in `seed-crm.ts` waits on it, which is what keeps "nothing was
  created" a measurement rather than a race. A deferred look for a Quote Request asks for
  `quote_requests`' presence again before every read. The lesson for any subscriber in this
  module: read, decide, and never sleep in a handler.
- **N-E19 (2026-10-05, T169) — the first real second subscriber broke the order of the
  transition hooks, and the transition now delivers them in one bus scope.**
  `contracts/events-and-ports.md` §1.1 lists the after-events "in this order". They were
  emitted bare: outside a scope `EventBus.emit` starts one dispatch chain **per event**, and
  the chains run side by side. While no event had an awaiting subscriber the order of emission
  was the order of arrival. The webhook bridge is now a subscriber of
  `crm.opportunity.status_changed.v1` and awaits a subscription lookup, so a later subscriber
  of that event received it **after** the two templated after-events —
  `transition-hooks.test.ts`, written for User Story 1, failed on exactly that. The transition
  service now emits its after-events inside one `EventBus.run`, which holds them back and
  dispatches them one after another, each to all of its subscribers before the next. Two
  consequences: the documented order is the order every subscriber sees, whoever else
  subscribes; and **the transition answers once its after-subscribers have run** — as
  `POST /opportunities` already does for `created.v1`, a Command's event being dispatched in the
  Command's own scope. A subscriber's failure is still isolated by the bus and cannot undo or
  fail the transition. The two `.before` events are emitted bare as before: they are passive,
  nothing is promised about them beyond "ahead of the write", and only the test subscribes.
- **N-E20 (2026-10-05, T169) — one check-estate ledger learned of the new registry.**
  `check:port-dependencies` refuses a `contributes-to` edge into a registry whose owner has
  not stated what it does with an absent contributor's entry, and reads that statement from
  `CONTRIBUTION_POLICY_STATED` in `backend/scripts/check-port-dependencies.ts` (one line per
  registry — `email:emailBlockRendererRegistry` joined it the same way in `f1d5a4ad6`). The
  line `'webhooks:webhookEventRegistry': 'skip'` is that statement, and it mirrors the doc
  block of `WebhookEventRegistryPort`. The file is not a row of §I; the line is in a commit of
  its own and is listed in `contracts/foreign-module-changes.md` §E. The edge and the line
  need each other — the check refuses the line while nothing resolves the name, and the edge
  while the line is missing — so the story's commit is red on that one check until the commit
  after it.
- **N-E21 (2026-10-05, T169) — a second ledger derived about the edge, found only by the
  whole fast suite.** `backend/test/unit/kernel/contribution-absent-owner.test.ts` derives
  every `contributes-to` edge from the registered manifests and holds the set, both ways, to a
  table of compositions: each contributor is composed once with its owner's names withheld —
  an instance that never installed the owner — where the boot must survive and nothing may be
  pushed, and once with them present, where the push must arrive. CRM's edge into
  `webhookEventRegistry` is the fourth contributor; without a `crm` entry the file is red, and
  no targeted run over the CRM or the webhooks directories opens it (`AGENTS.md` § traps, "a
  ledger derived about the files you changed"). The entry composes `crm` by its published
  specifier, supplies the two registries of modules CRM declares in `dependencies`, and passes
  in both directions with **no line in CRM about whether `webhooks` is installed** — which is
  the property the file exists to hold. Not a row of §I; in a commit of its own and listed in
  `contracts/foreign-module-changes.md` §E.
- **N-F1 (2026-10-06, T182) — the upload seam N-D8 said did not exist does: `assetsLibraryPort.upload`.**
  N-D8 (a) left the Attachments tab without *Add a file* for a role holding only CRM's
  permissions, on the premise that "a CRM-owned upload would have to carry multipart through a
  port that takes none today". Re-derived from the tree, that premise is false.
  `AssetsLibraryPort` (`packages/contracts/src/assets-library.ts`) has four methods and the
  first is `upload(input: AssetUploadInput)` — a filename, the declared MIME type, a byte
  stream, a size, a folder, a label and a `visibility`; `assets_library` registers its own
  `AssetsLibraryService` under that name, and the library's admin route calls the very same
  method. `pwa` is the precedent for a module accepting an upload on behalf of an
  administrator: it registers `@fastify/multipart` in a child context of its own route and
  hands the bytes to that port. **So nothing in `assets_library` and nothing in its contract
  was changed**; `contracts/foreign-module-changes.md` gains no row for it. What was built:
  (a) **`POST /opportunities/:id/attachments/upload`**, `crm:write`, in a new route file with
  the parser registered inside a child context, a new service and one delimited section of
  `index.ts`. `@fastify/multipart` joins `mod-crm`'s rendered peers — a package two modules
  already use, written by `manifests:generate` from the import, which is the derivation
  `foreign-module-changes.md` §F already allows.
  (b) **The file is read whole, and that is what makes the library's size limit apply.** The
  library's pipeline compares `declaredSize` with `assets.max_file_size_mb` **as it is set at
  that moment**, and a multipart part carries no length — which is why the library's own
  route passes `declaredSize: 0` and is held only by its parser's `fileSize`, fixed when the
  backend booted (its own contract test says as much). CRM buffers the part and passes the
  real size, so `ASSET_UPLOAD_TOO_LARGE` is the library's live answer; the price is a bound on
  the buffer, `OPPORTUNITY_ATTACHMENT_MAX_BYTES` (25 MB, in the contracts so the screen can
  refuse a larger file before sending it), answered as 413 `CRM_ATTACHMENT_TOO_LARGE` — one
  minted code, by N-13's procedure. Type checks, content sniffing, the storage backend and
  the `asset.upload` audit entry are the pipeline's, untouched.
  (c) **Parent first.** The route loads the Opportunity through the scoped EntityManager before
  it reads the body, and the service does so again before it stores anything: out of scope is
  404 with no asset row and no file, which the integration test counts.
  (d) **Two writes in two modules, compensated.** The asset insert is the library's
  transaction and the attachment is CRM's Command; a file stored and then not attached is
  soft-deleted through the same port (no `catch` — a flag and a `finally`), so the upload
  cannot manufacture the orphan N-B17's residual is about.
  (e) **The library's two refusal sentences are placeholders** — `errors.ASSET_UPLOAD_TOO_LARGE`
  is "Asset Upload Too Large." in its bundle, and that is what a Sales Rep reads when the
  library refuses. The envelope replaces a declared code's message with the bundle sentence
  (N-13 (a)), so CRM cannot improve it; reported for `assets_library`' owner. The screen's own
  pre-check covers the 25 MB case in a full sentence.
  (f) **N-B17's residual, and the narrowing that was not applied.** With a CRM-owned upload the
  Admin UI no longer calls `POST …/attachments { assetId }` at all (`crmApi.addAttachment` is
  kept and unused). The endpoint still lets a holder of `crm:write` who knows the uuid of a
  private library asset attached to no Opportunity attach it and obtain a signed link without
  `assets.read`. Two narrowings are available: **(i)** gate the by-id attach with `crm:write`
  **and** `assets.read` — exactly the people who could already fetch the file from the
  library — or **(ii)** remove the endpoint. Neither was made: both change §7's gate column
  for a documented endpoint (a client holding `crm:write` alone is refused where it was
  served), which is a contract change and the owner's call; (i) is the recommendation, and it
  is one `preHandler`, one line of §7 and one test. The port still offers nothing to tell a
  file uploaded *for* an attachment from any other private file, so a rule keyed on purpose
  remains impossible without a foreign change.
  (g) **On the screen** the kit's `AssetUploader` is replaced by a module-private
  `components/AttachmentUploader.tsx` (a button, a drop area, no request of its own) and
  `lib/upload-attachment.ts`, which posts multipart with `fetch` — the kit's client is
  JSON-only — and throws the client's own `ApiError` so the server's sentence is shown.
  `attachments.uploadNotAllowed` is gone.
- **N-F2 (2026-10-06, T129–T133) — analytics: what R-18 and §12 left open, and what was
  measured.** New files only — `services/analytics-service.ts`, `routes/routes.analytics.ts`,
  one delimited section of `index.ts` (`compose/analytics.ts` does not exist, N-6) — plus the
  one edit named in (g).
  (a) **What a range selects is a decision per figure**, and R-18's table does not make it.
  *Handling time* and the *rep ranking* go by `closed_at` (R-18 says so); *average value* goes
  by `created_at` — "in range" in R-18, and the creation date is the only one every valued
  Opportunity has; *most valuable* by either (`basis`); *time in status* counts the **stays
  that began in the range**, each from its history row to the next row of the same Opportunity
  (`lead(changed_at)` over the Opportunity's whole history, so a stay that began in the range
  and ended after it is measured in full) or to `now()` for one that has not ended — T129's
  "an Opportunity still in the status". All of it is written into `contracts/admin-api.md`
  §12 and the module page.
  (b) **"The platform's time zone" does not exist.** `spec.md` assumes "a month is a calendar
  month in the platform's time zone"; no setting, constant or environment input in the tree
  names one (searched `time_zone|timezone` over the platform package and every manifest).
  Days and months are therefore **UTC** — what `GET /opportunities` already does with
  `createdFrom` / `createdTo` — and the screen and the page say so. An operator in Warsaw sees
  an Opportunity closed at 00:30 on the 1st counted in the month before. Reported for a
  decision: a platform time-zone setting is a host change, not this story's.
  (c) **`top-opportunities` ranks within each currency, and `limit` is per currency.** The
  contract draws a flat `OpportunitySummary[]` with `limit` 10. A single ranking over PLN and
  EUR amounts compares numbers that are not comparable, and the owner's rule is that
  currencies are never mixed; so the statement is `row_number() over (partition by currency
  order by value desc, number)` and the answer — still a flat array of the same schema — is
  ordered by currency, then highest first. A reading of `limit` the contract did not state;
  §12 now does.
  (d) **The rep is the current assignee**, read off the Opportunity at the time of asking, not
  whoever held it when it was won — the status history records who moved it, not who held it.
  An Opportunity won while assigned to nobody is in no row (`adminUser` is not nullable in
  the schema); it is still in the handling time and in the lists. A currency in which a rep's
  won Opportunities carry no value is omitted from `wonValue`, as the board omits it.
  (e) **Tenant scope is written into every statement** from `orgConstraintFor()` — the model
  T131 names — because these are aggregates handed to the connection, which the entity filter
  never sees; the predicate builder is exported and the service refuses to run a statement for
  a reader who reaches no Organization. The status history is only ever read joined to its
  Opportunity (N-15). `top-opportunities` reads its ranked ids **again** through the scoped
  EntityManager before rendering, so the filter has the last word. Proven with a Sales
  Representative confined to one Organization against the platform administrator as the
  positive control, figure by figure, each against a hand computation
  (`analytics.test.ts`, whose header carries the fixture and the arithmetic).
  (f) **The effective value is stated a third time.** `data-model.md` defines it as one SQL
  expression; the list (`opportunity-service.ts`) and the board (`board-service.ts`) each hold
  a private copy and neither file exports it. Analytics has the same expression under one
  name (`EFFECTIVE_VALUE`) and reads `computed_value` as stored — whatever maintains it. One
  exported fragment for all three is the tidy-up after the value story merges; it was not
  made here because both other files are being edited on a sibling branch.
  (g) **One edit outside the new files: `OpportunityService.summarize(rows)`**, eleven lines
  between `list` and `get`. The contract answers `OpportunitySummary[]` for the most valuable
  Opportunities, the renderer is the service's private `#summaries`, and `list` cannot be asked
  for "these ids" or "closed between". The alternatives were a second copy of the rendering
  (status label, assignee marker, tags, value) in the analytics service, which would drift
  with the next field, or N calls to `get` — an N+1 by construction. The method renders rows
  the caller has already read through the scoped EntityManager and decides nothing.
  (h) **Cost (SC-007), measured** on the test harness (`app.inject`, this worktree's Postgres,
  ten Organizations, eight reps, four history rows per Opportunity, twelve requests each with
  the first two discarded; statements counted off the ORM's query log, less the seven the
  request pipeline issues for a platform administrator and eleven for a confined one):
  | Endpoint | Statements | Median, 300 in the month | Median, 1 000 in the month |
  | --- | --- | --- | --- |
  | `handling-time` | 1 | 10 ms | 9 ms |
  | `time-in-status`, statuses selected | 1 | 15 ms | 17 ms |
  | `time-in-status`, every status | 3 (two read the workflow) | 16 ms | 20 ms |
  | `rep-effectiveness` | 3 (one aggregate, the names through `adminUserReadPort`) | 12 ms | 10 ms |
  | `top-opportunities` (10 per currency) | 10 (the ranking, the scoped re-read, the list's renderer) | 22 ms | 20 ms |
  | `top-opportunities`, `limit=100`, `basis=closed` | 10 | 32 ms (92 kB) | 37 ms (118 kB) |
  | `average-value` | 1 | 8 ms | 8 ms |
  The worst single request of the run was 45 ms; a confined manager's figures were within 3 ms
  of the administrator's. `analytics.test.ts` holds the part a loaded machine cannot move:
  each endpoint issues the same number of statements after sixty more Opportunities as
  before. **[unverified]**: a cold database, a real network, a history table of millions of
  rows (the stay window is narrowed to Opportunities with a change in the range, which the
  `changed_at` index serves, and was not measured at that size), and an allowed set of
  hundreds of Organizations.
  (i) **`crm:analytics` is declared with its first gate** (`contracts/admin-surfaces.md` §4),
  `requires: ['crm:read']`: the screen names statuses from `GET /workflow` and offers its two
  pickers from `/lookups/*`, all `crm:read`. The five reads ask for `crm:analytics` alone, and
  the contract test gives a role holding every *other* CRM code 403. A role holding the
  analytics code and not `crm:read` still gets every figure; statuses are then shown by code
  and the pickers say they could not be read.
  (j) **A fourth palette action, `open-crm-analytics`.** §3 said "three entries, deliberately";
  the coordinator's brief for this story asked for the action, and the argument for it is
  that the screen opens on a code of its own — for a manager holding it, the palette offered
  nothing that code is for. §3, the off-state test's exact list and the package's declaration
  test follow.
  (k) **On the screen.** One set of filters (range presets and two dates, Sales Channel, Sales
  Rep — CRM's own lookup pickers, N-D4) and five independent reads, each in a region named by
  its heading with its own loading, empty and failed state; a change applies at once. Two
  charts through the kit's `EChart` (time in status, the rep ranking), each `aria-hidden`
  above a table of the same numbers; the other three figures are text and tables. `mod-crm`
  does not import `echarts` — the option is typed through the kit's `EChartProps` — so it
  gains no peer. A chart is a canvas and knows no custom property, so its colours are read off
  the theme's tokens (`--foreground`, `--muted-foreground`, `--border`, `--primary`) and read
  again when the root's class changes; a bar of time-in-status takes its status's own colour,
  with the status named on the axis. **The shell has no theme switch** — `theme.css` defines
  `.dark` and nothing sets it — so dark was looked at by setting the class by hand. Durations
  and months are formatted by `Intl` (unit and plural form in the language on screen), and a
  count follows a colon so no Polish plural is hand-written.
- **N-F3 (2026-10-06, T182 / T132) — the upload and the analytics screen, walked in a
  browser.** N-30's arrangement (headless Chromium, the admin's Vite dev server serving the
  module's `dist`, the backend test composition on a throw-away `_test` database of this
  worktree's Postgres, created and dropped with its template), seeded with 46 Opportunities
  created from June to September 2026 in two currencies, three Organizations and four reps.
  **Attachments, as a role holding `crm:read`, `crm:write`, `orders:read` — 17 of 17**: *Add a
  file* offered and the hint naming 25 MB; one `201 POST …/attachments/upload` and no request
  to `/api/v1/admin/assets`; the file listed with size and uploader and announced; *Download*
  re-reading the list and opening the signed link, whose bytes were the uploaded bytes; a
  25 MB + 1 byte file refused on screen and not sent; removal; a file dropped on the dashed
  area uploaded the same way; at 390 px the button 44 px tall and no sideways scroll.
  **Analytics — 27 of 27**: the sidebar row between *Board* and *Tags*; the palette action;
  the five reads for the current month, then for *This year*; won and lost apart; the average
  per currency; two canvases, each `aria-hidden` with its table; a table per currency for the
  most valuable; two statuses selected asking that one figure only; the Sales Rep filter
  narrowing all five; the closing-date basis; a range ending before it begins asking for
  nothing; the filters reached by keyboard in reading order; a manager confined to one
  Organization shown that Organization's Opportunities only; a role without `crm:analytics`
  offered no row and asking for no figure; no failed request, no console error.
  **Polish — 8 of 8**, with no key and no English sentence left on either screen.
  **One defect found and fixed:** at 390 px each chart was 478 px wide inside a 324 px card —
  a grid item is as wide as its widest content, and the tables' minimum width set it. The
  cards are `min-w-0` now and the charts measure 324 px; the page never scrolled sideways,
  so only the measurement showed it. The native filter controls are 44 px tall on a phone;
  the two lookup pickers are the kit's `Combobox` at 36 px, as on every other CRM screen.
  **Seen and not this story's:** with `.dark` set by hand the cards, the tables and the
  charts take the dark tokens and the page background behind them stays light — the shell
  has no dark theme to switch to; a currency is formatted by its own locale (`31.220,00 €`
  beside `26 398,53 zł`), which is `formatMoney`'s rule everywhere; and the attachment table
  of T081 breaks a long file name letter by letter at 390 px. Not verified by eye: a real
  screen reader, a physical touch device, zoom at 200 %.
- **N-G1 (2026-10-06, T160) — R-26's two [unverified] premises, read from the tree.**
  (a) **The panel cannot be embedded as it was.** `CustomFieldValuesPanel` took a required
  `save` and always rendered its own *Save custom fields* button; inside the create form that is
  a second submit of half a form, for a record that does not exist yet. Row G8 was therefore
  taken: the panel gained an **embedded mode** — `save` optional, `onChange(values)` told the
  whole bag on every edit, no button without `save`. Two more optional props came with it,
  **beyond G8's "onChange, no button"** and in the same file: `fieldErrors` (a refusal per
  field key, shown at the field — a host that owns the write is the only one who learns which
  field was refused, and T155 asks for exactly that) and `language` (labels were hard-coded to
  `label['en']`; User Story 15's scenario 2 asks for the user's language). All three default to
  the old behaviour, so the four existing hosts render and save exactly as before —
  `admin/test/kit/kit-custom-field-values.test.tsx` and the `quote_requests` screen test pass
  unchanged, with three cases added for the new mode. (b) **A required field absent on create
  is refused**: `validateAndMerge(type, {}, {})` walks every definition and reports
  `missing_required`, so the create form must offer the fields — which is why (a) was needed.
- **N-G2 (2026-10-06, T159) — when the definitions are enforced.** One function,
  `services/opportunity-custom-fields.ts`, called inside the create and the update Command.
  A bag that is **absent** is not validated: the stored values are returned as they are. So a
  `PATCH` that does not name `customFieldValues` never meets a field made required after the
  Opportunity was created (contract §12a: "absent on a PATCH means leave the values as they
  are"), and a `PATCH` that names it is held to **every** definition, required ones included.
  The public `create` passes `customFieldValues ?? {}`, so a create by hand is always
  validated; a caller that builds the create Command without a bag — the automatic creation
  of User Story 9, on its own branch — creates an Opportunity with no custom values instead of
  being refused by a field nobody was there to fill in. The audit snapshot carries
  `customFieldValues` only when the bag is not empty, so an Opportunity without custom values
  audits byte for byte as before. `project` strips a deleted definition's value on read; the
  column keeps it (the platform's dormant-value rule).
- **N-G3 (2026-10-06, T156/T157) — what `'opportunity'` joining the enum touched, and what it
  did not.** The grep of T156, whole tree: **compile-coupled** — `SUPPORTED_ENTITIES` (H2) and
  a second `Record` over the enum that §H does not name, `HOST_TABLE_BY_ENTITY` in
  `custom-field-value.service.ts` (the `{table, column}` the definition-change guards probe;
  `crm_opportunities.custom_field_values`), with its row in `value-probe-binding.test.ts` —
  both H6. **Not touched**: `CustomFieldsPage.tsx` (its hard-coded list is a pre-fetch
  fallback; the screen renders what `entity-types` answers), `host-managed.test.ts` (asserts
  membership, not an exact set) and `value-matrix.test.ts` (its own list of five). **The
  owner-absent refusal mints no code**: it is 409 `CUSTOM_FIELD_HOST_MANAGED`, the code whose
  manifest note already says it "refuses a definition whose entity type another module
  manages… about this registry rather than about whichever module happens to be named", with
  a sentence that names no module. `effectiveState` is read in `routes.admin.ts` (H3), so
  `custom_fields`' composition file is unchanged. **H5 has nothing to edit**: `custom_fields`
  ships no documentation page (the module map says "no page yet"); the host type and the
  owner-presence rule are documented on CRM's page instead.
- **N-G4 (2026-10-06, T160) — the picker defect of N-D4 again, answered with `requires` this
  time.** The panel reads `GET /api/v1/admin/custom-fields/definitions`, gated
  `custom_fields:read`, which a Sales Rep holding only CRM's codes does not hold. Unlike
  `admin_users:manage` in N-D4, that code grants nothing but reading field definitions, so
  `crm:read` now names it in `requires` (the advisory the role editor shows) rather than CRM
  growing a fifth lookup and the kit panel a `definitions` prop. On screen, the fields are
  rendered — and the definitions asked for — only for a holder of `custom_fields:read`; a
  person without it sees no section and no refused request, and a required field that then
  refuses their create is named in the form's own error message. A holder of `crm:read`
  without `crm:write` gets a read-only list (`CustomFieldValuesList`, module-private: the kit
  panel has no read-only mode).
- **N-G5 (2026-10-06, T139) — R-24's design cannot be built inside the module, and T139 is
  STOPPED, not half-built.** R-24 and T139 ask for a module-own demo body
  (`src/backend/demo/`) that seeds Opportunities "for the demo Organizations, a few linked to
  demo Orders". Three facts from the tree: (a) **a module's demo body may write only its own
  tables, read no other module's table and resolve no other module's port** — the doc block of
  `ModuleDemoManifest` in `packages/contracts/src/modules.ts` (§2.1–§2.2), which adds that
  "wiring that spans modules is a composition and belongs to the instance". An Opportunity is
  CRM's row whose `organization_id` is a foreign key into `organizations`' demo row, which the
  body may not look up. The tree's own precedent is exact: `organizations`' `demo/rows.ts`
  says the demo buyer and the demo credit limit are "another module's row against this one's
  and are therefore composition steps", and both live in
  `packages/demo-composition/src/composition.ts` ("credit limit granted to the demo
  organisation"). (b) **That file is not a row of `contracts/foreign-module-changes.md`.**
  (c) **There is no demo Order anywhere**: `orders` declares no `demo`, and none of the ten
  composition steps places one — so "one linked to a demo Order" needs a demo Order to be
  invented first, through `orders`' placement path, which is a second unlisted foreign change
  and a much larger one. What a compliant module-own body could seed — tags and Order-status
  mappings — shows an empty board, which is the thing R-24 says "demonstrates nothing"; it was
  not built, so the manifest still says `demo: false`, and the module page says in so many
  words that CRM ships no demo data. **What unblocks it:** a §-row admitting
  `packages/demo-composition/src/composition.ts` (+ its test and the recorded delta of
  `backend/test/integration/demo/demo-shop.test.ts`), and a decision on whether the demo gains
  an Order. With both, the step is: find the demo Organization by its tax id, create a dozen
  Opportunities across the six seeded statuses through `CrmOpportunity` rows keyed on fixed
  ids, write `order_to_opportunity` / `opportunity_to_order` mappings for the seeded Order
  workflow (N-24's path: `qualified → paid`, `proposal → processing`, `negotiation →
  shipment_ready`, `won → completed`), and link one Opportunity to the demo Order; `withdraw`
  deletes by those ids. The owner's standing position (demo data is optional and opt-in) is
  met either way — `endora demo seed` is the opt-in.
- **N-G6 (2026-10-06, T137) — the two ports, and what the contract leaves open.** Registered
  with `ctx.di.providePort` in one delimited section of `src/backend/index.ts` (N-6), and the
  two `Container name:` marker lines N-5 withheld are now in `packages/contracts/src/crm.ts`
  — `check:port-shape` and `check:port-dependencies` are green with them.
  (a) **`findByDocument` is parent-first**: the link row is read only to learn which
  Opportunity to ask for, and the Opportunity is then read through the scoped EntityManager,
  so a document linked to an Opportunity the caller may not see answers `null` (N-15).
  (b) **`not_found` covers "outside the caller's scope"**, as 404 does on the HTTP API.
  (c) **A malformed id is `null` / `not_found`**, never a database error. (d) **`cause`** is
  `manual` for an `admin` actor and `system` for a `system` one; the port cannot be asked for
  `order_status`, which is the reverse mapping's own. (e) **A concurrent move is thrown**, not
  returned: `CRM_TRANSITION_CONFLICT` is not one of the contract's outcomes, and the `catch`
  tolerates exactly `CRM_TRANSITION_VETOED` after `rethrowIfModuleDisabled`. (f) The callers
  of a port carry their own tenant context; with none, the tenant guard refuses the read
  (`MissingTenantContextError`) — the tests enter one with `resolveTenantContext`.
  (g) **The audit reference** is `referenceType: 'crm_opportunity'` (the `objectType` every
  CRM Command records), label = the title, url `/crm/opportunities/:id`, read through the
  scoped EntityManager so a reader confined to other Organizations gets no title. **The edge
  is `dependencies: ['audit_logs']`, not the `contributes-to` entry T137 and
  `contracts/events-and-ports.md` §5 name**: `check:port-dependencies` refuses a
  `contributes-to` edge to a registry whose absent-contributor policy is not listed in its
  `CONTRIBUTION_POLICY_STATED` ledger, and offers "declare the edge in `dependencies`" as the
  other answer — which is what the registry's four existing contributors (`catalog`,
  `customer_accounts`, `inventory`, `price_lists`) do, costs an operator nothing
  (`audit_logs` cannot be switched off) and edits no check ledger. `backend/test/integration/audit_logs/reference-contributions.test.ts`
  asserts the registry's contributors as an exact set and gained `crm` — a ledger of N-25's
  kind, in a commit of its own, now a row of `contracts/foreign-module-changes.md` §E.
  **N-22 still stands**: `audit_logs`' action-label lookup is a separate static chain and was
  not touched.
- **N-G7 (2026-10-06, T138) — the Organization panel.** `organization.detail.after` exists
  and is mounted once at the end of `OrganizationDetail.tsx`; a contribution is one
  `zoneComponent(zone, () => import(…), { weight, requiredPermission })` in the module's
  `contributions.zones`, exactly as `carts` declares its own, and the renderer applies both
  presence axes and the permission before the chunk is fetched — nothing in `organizations`
  changed. Weight 600 (after `carts`' 400). The panel lists the ten newest **open**
  Opportunities from the existing list endpoint (`state=open&organizationId=…&limit=10`) —
  no new route — and *New opportunity* is shown to a holder of `crm:write` only, because the
  create route is gated on it. The list screen does not read filters from its URL, so "see
  them all" links to the unfiltered list.
- **N-G8 (2026-10-06, T175) — the Order half of User Story 17, and why the Quote Request
  zone is not in the enum.** User Story 8 (quote-request links) is on another branch, so —
  as the phase header says — `quote_request.detail.after` was left out of
  `AdminZoneNameSchema` **entirely**: `check:admin-zones` refuses a member no host renders,
  and a mount in `RfqDetail.tsx` for a panel that cannot yet be linked would be a zone with a
  contributor that says "not yet". Only `'order.detail.after'` was added (props: the existing
  `OrderDetailZoneProps`), with its one mount. **R-28's [unverified] position, decided with
  the file open:** the last child of `OrderDetail.tsx`'s fragment, after the `Card` that
  holds the tab strip and every tab body — so it is there on every tab, and with nobody
  contributing the screen's last element is that card. The host's test
  (`admin/test/modules/orders/OrderDetail.after-zone.test.tsx`) uses a stand-in contributor,
  not CRM, and compares the screen's markup three ways: no registry entry, a contributor
  whose module is not present, and a contributor whose permission the person lacks — all
  equal, with a fourth render (the contribution shown) as the control that the comparison
  can fail. `packages/modules/orders/src/admin/index.ts` carries a header comment saying
  "the four it hosts"; it now hosts five and that comment was **not** edited (the file is not
  a row of §J).
- **N-G9 (2026-10-06, T176) — the document endpoint, and what it refuses.** New files
  (`services/document-opportunity-service.ts`, `routes/routes.documents.ts`) and one
  delimited section of `index.ts`; `opportunity-link-service.ts` was not edited — T176 names
  "`findByDocument` on the link service" and "`compose/links.ts`", and neither is where it
  went (N-6, and the sibling branch is editing that service). (a) **The document is read
  first**, through `orderReadPort` under the caller's scope: missing, malformed id and out of
  scope are one 404 `CRM_DOCUMENT_NOT_FOUND`, *before* the link is looked at, so `null` versus
  a refusal never tells a stranger whether another Organization's Order has an Opportunity.
  (b) **Then parent-first** (N-15): the link names the Opportunity, the scoped EntityManager
  decides whether the caller may have it. (c) **The summary is cut from the detail** —
  `OpportunitySummarySchema.parse(await opportunityService.get(id))` — so the Opportunity is
  rendered by the one code path that renders it and `opportunity-service.ts` gained nothing.
  (d) **An unknown kind is 422**, validated in the service: a route schema would answer 400
  (N-13 (c)) and the contract says 422. (e) **`quote_request` is 422 on this branch**, with
  the sentence the link endpoint already uses for that kind (N-18's rule: refused, not
  accepted and dropped). **What the Quote Request half replaces:** that branch of
  `findForDocument` — validate through `quoteRequestReadPort` under the caller's scope,
  answer 503 `MODULE_DISABLED` while `quote_requests` is off — nothing else in the service.
- **N-G10 (2026-10-06, T177/T178) — the panel, and three things the tasks leave open.**
  (a) **Strings are under `orderPanel.*`**, not `links.*` as T177 says: the coordinator's
  merge rule for this branch, and `links.*` is the Opportunity screen's own section, edited on
  another branch. (b) **The Organization of an unlinked Order is read from `orders`' own
  admin endpoint** (`GET /api/v1/admin/orders/:id`, `orders:read`). §12b adds one read and
  "nothing else", the zone hands over an id only, and `{ data: null }` carries no
  Organization — while whoever is on the Order's screen holds `orders:read` by construction.
  It is read only for an unlinked Order in front of a holder of `crm:write`; a linked Order
  costs one request. (c) **The picker is a select of the Organization's hundred newest open
  Opportunities** from the list endpoint, not a search box: it is the contract's "list of §1
  filtered by `organizationId` and `state=open`", and an Organization with more than a
  hundred open Opportunities links from the Opportunity's screen instead. (d) **"Create
  opportunity" is two requests**, as R-28 decided: the create page honours
  `linkDocumentKind=order` + `linkDocumentId`, calls the link endpoint after a successful
  create and then navigates. A refused link leaves the Opportunity created: the form shows
  the server's sentence, links to the Opportunity and disables *Create* so a second click
  cannot create a second one. `linkDocumentKind=quote_request` is ignored until that kind is
  linkable. (e) The thin wrapper is `zones/OrderOpportunity.tsx`; `LinkedOpportunityPanel`
  takes `documentKind`, `documentId` and a `loadOrganizationId` function, which is all the
  Quote Request wrapper has to supply.
- **N-G11 (2026-10-06) — what remains of User Story 17, exactly.** After User Story 8 is on
  the same branch: (1) `'quote_request.detail.after'` and `QuoteRequestDetailZoneProps
  { quoteRequestId }` in `packages/contracts/src/admin-contributions.ts`, with (2) the one
  mount and the `AdminZone` import in `RfqDetail.tsx`, in one change; (3)
  `admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx` on the model of the
  Order host test; (4) the `quote_request` branch of `DocumentOpportunityService` (N-G9 (e))
  with its contract cases — linked, unlinked, out of scope, 503 while `quote_requests` is
  off; (5) `zones/QuoteRequestOpportunity.tsx` and its `zoneComponent` line, widening
  `LinkedOpportunityPanelProps['documentKind']`, `crmApi.opportunityOfDocument`'s callers and
  the create page's `linkDocument` to the second kind, plus a `loadOrganizationId` for a
  Quote Request; (6) the zone in `quote_requests`' docs page (+ Polish) and `mod-quote-requests`
  in the changeset. Tasks T172, T175, T176, T177 and T179 are left unticked for that half.
- **N-G12 (2026-10-06) — user stories 14, 15 and the Order half of 17, walked in a browser.**
  N-30's arrangement: headless Chromium (Playwright 1.60) against the admin's Vite dev server
  and the backend test composition on a throw-away `_test` database on this worktree's
  Postgres, created and dropped with its template — the stub admin session, real routes, real
  `orders`, real `custom_fields`. The dev server serves each module's `dist` (N-D9), so the
  `orders` and `crm` admin halves were rebuilt first; the first pass showed no panel on the
  Order screen for exactly that reason. **English, 1440 px — 29 of 29**: *Opportunity* among
  the record types of the custom-fields screen; a required select and an optional text field
  defined there; the create form showing both with no button of their own, refusing the
  missing required field **at the field**, then creating; the values on the Opportunity,
  edited and saved through one `PATCH`, and an emptied required field refused at the field;
  the *Open opportunities* panel on the Organization (statuses and values, no lost
  Opportunity, *New opportunity* carrying the Organization); a linked Order showing number,
  title, status, assignee and value with a link; an unlinked Order linked by picking an open
  Opportunity (the picker offers no lost one); *Create opportunity* from an Order ending on an
  Opportunity that lists that Order, and the Order then showing it. **CRM off — 12 of 12,
  each screen waited for before it was judged**: the Order screen rendered, with no panel, no
  request to `/admin/crm/`, and its text exactly the "on" screen's minus the panel; no CRM
  group in the sidebar; no panel and no CRM request on the Organization screen; *Opportunity*
  not among the record types; all three back after switching on. **Polish — 5 of 5**:
  *Powiązana szansa*, *Otwarte szanse sprzedażowe* / *Nowa szansa*, the record type *Szansa
  sprzedażowa*, *Pola niestandardowe* on the Opportunity, no untranslated key.
  **One defect found and fixed:** a cleared choice, number or date did not clear. The kit
  panel reports such a field as `undefined`, JSON drops the key, and a key the `PATCH` does
  not name keeps its stored value — so the field came back after saving, and an emptied
  *required* field was not refused. The Opportunity's save now sends a stored-and-now-empty
  field as `null` (`withCleared`), which the server clears or, for a required field, refuses;
  one admin case and one integration case hold it. **The same gap exists for the panel's four
  other hosts** (their `save` passes the bag through unchanged) — the kit's, pre-existing, and
  not repaired here. **The walk's own misreads, all timing:** the first two passes judged
  three screens while the shell still showed "Loading the module's screen…" — which made the
  first off-state checks pass vacuously and is why that part was re-run on its own with an
  explicit wait and a positive control. **Seen and not this feature's:** the Organization
  screen's own `GET …/pricing/display-mode-overrides/organization/:id` answers 404 for an
  Organization with no override, with or without CRM. Not verified by eye: a real screen
  reader, a physical touch device, dark theme, 390 px (the three panels are cards of the
  host's own width and their tables scroll inside them — measured by nothing here).
- **N-H1 (2026-10-06, after the merge of the admin wave into the second backend wave) — the
  merged tree, and N-22 closed.** The merge of `43df36d42` conflicted in six files. Measured
  after `pnpm run build:packages`: `typecheck` clean; `composer:check` and `manifests:check`
  up to date; the OpenAPI baseline **already matched** (git had merged the two sides' paths,
  as N-D1 found the time before). The two Polish translation-cache entries were rewritten
  from the materialised pages, not merged. The module page keeps the admin wave's order —
  features, then extension, activation, permissions, settings — with this wave's five sections
  after *Attachments*. **N-22 / N-E12 applied, with the owner's approval:** one line in
  `audit_logs`' `moduleIdForAuditAction` sends the `crm.` prefix to CRM's bundle, so the
  platform-wide audit log shows the sentences the Opportunity's own history shows. In a commit
  of its own; `contracts/foreign-module-changes.md` §K.
- **N-H2 (2026-10-06, T101) — the Quote Request picker reads a lookup of CRM's own; the port
  decides what it can offer.** `GET /api/v1/admin/quote-requests` is gated `rfqs:handle` — the
  right to handle quotes — which is N-D4's case again, so the picker reads
  `GET /api/v1/admin/crm/lookups/quote-requests?organizationId&q` (`crm:write`; one new
  service, one new route file, one delimited section of `index.ts`). `QuoteRequestReadPort`
  has **no search**: it lists the *open* requests of given Organizations and finds one by its
  exact number. So the lookup offers the Organization's open Quote Requests narrowed by the
  typed fragment, plus the one whose number is typed in full, whatever its status (tried as
  typed and upper-cased) — an approved or completed request is linked by its number, and the
  picker's empty message says so. The answer is `id`, `number`, `status`; **no amount**
  (`listItems` is one port call per request). Tenant scope by name (`isOrgInScope`): an
  Organization out of reach answers an empty list. With `quote_requests` off it answers 503
  `MODULE_DISABLED` from the same door as linking (N-E5). `document-lookups.contract.test.ts`
  holds the gate, the shape, both isolation cases and that the desk's own list still refuses
  the role. **The test was written before the service but run only after it** — its red was
  not observed.
  **Superseded by N-R13 on the gate: the lookup asks for `rfqs:handle` beside `crm:write`.**
- **N-H3 (2026-10-06, T127) — the reference pickers are the owners' lists, offered by
  permission; no product lookup was added, because the catalog's port cannot search.**
  `CatalogProductReadPort` finds by id and by exact SKU and lists everything; a CRM-owned
  product search would be `listAll()` filtered in memory or an edit to another module's port,
  and neither is this feature's. So *Insert product* is the kit's `ProductPicker`
  (`GET /api/v1/admin/catalog/products`, `catalog:read`), fetched lazily on first press, and
  is **not offered** to a role without that code; *Insert order* searches `orders`' list for
  the Opportunity's Organization, as the link picker does, and needs `orders:read` — which
  `crm:read` already names in `requires`. `catalog:read` was **not** added to `requires`: the
  feature degrades to a plain textarea, and a token typed by hand resolves all the same
  (N-E14 asks for no catalog permission to *read* a name). The splitter a screen needs to
  render tokens joined the grammar's one home (`splitOpportunityReferenceText` in
  `packages/contracts/src/crm.ts`). The textarea's own announcement is `aria-live="polite"`
  and not `role="status"`: the comment thread around it owns the one status of its tab, and
  one existing test (`comments.test.tsx`, "sends a message") now waits for the composer
  instead of assuming the lazy tab has rendered.
- **N-H4 (2026-10-06, T122) — what the Change history tab does with a row the endpoint
  answers raw.** The label is `auditLog.<action>` in CRM's bundle (N-E11), with a generic
  sentence for an action that has none. `before` / `after` are `unknown` on the wire, so the
  tab decides what is readable: a status change is a sentence (names from `GET /workflow`,
  codes only if that read fails) with its cause — the Order by number when the Opportunity
  still links it, otherwise a link that says "Order (open)" — and its reason; an edit lists
  only the fields that differ; a creation, a link or a note lists what it arrived with.
  **Identifiers are never printed**: `linkId`, `commentId`, `attachmentId`, `assetId`,
  `propagationId` and `version` are dropped; an assignee is named when this page knows the
  name (the current assignee, anybody who acted in the pages read) and is otherwise "Another
  administrator"; a contact person or Sales Channel that changed is "Set". Naming every
  administrator would need the assignee lookup per page, and was not built. Pagination
  appends ("Show earlier changes") rather than paging back and forth: the endpoint's cursor
  is an offset into one capped read (N-E10), and a reader scanning back keeps their place.
- **N-H5 (2026-10-06) — the two automatic-creation Settings are on the Settings screen, in
  English only, and that is the platform's, not this module's.** `SettingRowEditor.tsx`
  renders `setting.name` and `setting.description` straight from the manifest; there is no
  bundle key, no `labelKey` and no per-language field for a Setting anywhere in
  `packages/modules/settings` — every module's Settings read in English whatever the
  operator's language. Nothing was added: there is no label to add a translation *to*. Both
  Settings are listed under the **CRM** group with the sentences T105 wrote, and the
  generated reference page shows them in both languages' pages under the same English name.
  A translatable Setting name is a change to the settings manifest contract — for the
  register. The value screens: the counting-status save says its 202 in words
  (`value.counting.accepted`), and the value section reads the figure from the detail it was
  just handed, never from a list.
- **N-H6 (2026-10-06) — User Story 10 (T108–T118) was not started; nothing of it is in the
  tree.** The session that finished the merge and the admin halves of User Stories 8, 11 and
  12 ran out of its time budget before Phase 12, and a story that edits `orders` and
  `quote_requests` is not one to leave half-made. What the next session inherits, all of it
  already measured: `order.created.v1` is emitted inside the placing transaction, so the
  origin branch belongs in the existing deferred re-read of
  `opportunity-auto-create-service.ts` (N-E7) and must run **before** the "already linked" and
  setting branches, so that an Order created from an Opportunity is linked with
  `linkSource: 'created_from_opportunity'` and gets no second Opportunity (N-E8 (g) is the
  case that would otherwise create one); a Quote Request an administrator creates emits no
  event today (N-E8 (g)), which is why `rfq.created_by_admin.v1` is new; the link must be
  refused silently when the Opportunity is not reachable by the creating administrator or
  belongs to another Organization; the Opportunity screen's two buttons belong beside the two
  link sections of the Overview (`LinkedDocuments.tsx`, `LinkedQuoteRequests.tsx`), the second
  only while `useModulePresence().isPresent('quote_requests')`; and the foreign files are
  exactly the rows of `contracts/foreign-module-changes.md` §A–§C. The off-state file already
  lists every CRM route; T111 adds the two foreign create requests carrying an `origin`.
  **Superseded by N-J1…N-J9: User Story 10 was then built, and those notes record it.**
- **N-I1 (2026-10-06, after the merge of the second backend wave into the integration
  branch) — the merged tree.** `6b7694235` (User Stories 8, 9, 11, 12, 16) met analytics, the
  CRM-owned upload, custom fields, the published ports and the two host panels. Thirteen files
  conflicted and every resolution is "both": `src/backend/index.ts` keeps each delimited
  section once (fifteen `registerCrm*Routes` calls, each name once; five `ctx.subscribe` call
  sites; four boot hooks); `opportunity-service.ts` keeps the custom-field merge and `summarize()` beside
  the value recalculation, the references and `createForDocument`; the two bundles are the
  union of two disjoint key sets (649 keys each, no key twice). Measured after
  `pnpm install --lockfile-only`, `build:packages`, `composer:generate` and
  `manifests:generate`: **none of the four wrote anything** — git had merged the lockfile, the
  two registries (both CRM migrations are in `migrations-registry.generated.ts`), the rendered
  `package.json` and the OpenAPI baseline correctly, as N-D1 and N-H1 found the two times
  before. The two Polish translation-cache entries were rewritten from the materialised
  pages. **The module page is one page again**: the features in the order they are met on
  the screens, then the three surfaces on other modules' screens and the two extension points,
  then activation, permissions, settings, demo data and what is still coming — which is one
  line, creating an Order or a Quote Request from an Opportunity. Three things on it were
  wrong and none was a conflict: the second wave's permission row said an upload "also needs
  the media library's `assets.write`" (false since N-F1); its *Settings* table had two rows of
  two cells under a three-column header; and the advisory sentence named `orders:read` only
  where the manifest names `custom_fields:read` as well (N-G4).
- **N-I2 (2026-10-06) — the effective value is stated once (closes N-F2 (f)).**
  `domain/effective-value.ts` holds the rule in both forms — `effectiveOpportunityValue(row)`
  and `effectiveOpportunityValueSql(alias)` — and the list's `sort=value`, the board's column
  totals and the five analytics statements read it from there; the three private copies are
  gone and `effective-value.test.ts` scans the module's sources so a fourth cannot appear.
  **Nothing disagreed before the change** — the three copies were the same text — so the
  behaviour test (`backend/test/integration/crm/merged-stories.test.ts`: a computed
  Opportunity with a paid Order of 321.00, a manual one, a computed one with nothing linked
  and one nobody valued, read by a manager confined to their Organization) passed on the
  unmodified merge and holds the agreement from here on: detail, list, board cards, board
  total, average and ranking, before and after a mode change. It was seen to fail with the
  fragment mutated to `manual_value` (list, board, analytics and the mode change, four cases).
  **One thing the first version of the fragment got wrong, caught by that test and not by the
  type-check:** the list hands it the ORM's own placeholder (`raw((alias) => …)` passes
  `[::alias::]`), which a guard written for plain identifiers refused with a 500. The guard
  now refuses only what could end an identifier. A computed Opportunity with nothing counting
  is worth `0.00`, not nothing — it is in the average and at the bottom of the ranking, and
  the page says so nowhere; left as R-14 has it.
- **N-I3 (2026-10-06) — automatic creation is not refused by a required custom field
  (N-G2's claim, proven).** With a required select defined for Opportunities and
  `crm.auto_create_from_orders` on, an Order placed through the storefront still gets its
  Opportunity, linked, with `customFieldValues: {}`; a create by hand without the field is
  422 in the same test (the control); an edit that does not name `customFieldValues` is
  accepted, one that names it empty is refused, one that fills it in is accepted. Seen to
  fail with `createForDocument` passing an empty bag: the Order is placed and no Opportunity
  appears — silently, which is what the wrong merge of these two stories would have looked
  like in production. Same test file.
- **N-I4 (2026-10-06) — the off-state route list is checked in both directions.**
  `off-state.test.ts` proved that every listed route exists; nothing proved that every
  registered route is listed, and each story added routes on a branch of its own. The file
  now reads the composed application's route table (`printRoutes`, HEAD left out) and compares
  it with the list as an exact set — 45 method-and-path pairs. It was complete after the
  merge; the test was seen to fail with the history route taken off the list.
- **N-I5 (2026-10-06, T183) — N-F1 (f)'s narrowing (i), applied. A decision of the
  session's coordinator that the owner may reverse — it is one `preHandler`.**
  `POST /opportunities/:id/attachments { assetId }` is now gated `crm:write` **and**
  `assets.read` — the code as `assets_library`' manifest declares it, with a dot, not a
  colon. `RequireAdminFactory` takes one code, so the conjunction is two `preHandler`s in
  order, `crm:write` first: a caller without CRM's code is told about CRM's code, and the
  refusal for the library's is the platform's own 403 `FORBIDDEN`, no code minted. This
  closes N-B17's residual: a holder of `crm:write` who knows the uuid of a private library
  asset can no longer attach it and read a signed link off the list, because the people who
  may attach by id are now exactly the people who could already open the file in the
  library. A route gate is the right place here, unlike `rfqs:handle` (N-R13):
  `assets_library` is non-deactivatable, so its code can always be granted and the
  foreign-gate sweep reads the gate as `owner-locked`. **Unchanged:** the upload of §7a stays
  `crm:write` alone (the integration test holds both halves in one case, with the same
  role), listing and downloading stay `crm:read`, removing stays `crm:write`; the Admin UI
  never called the by-id endpoint (N-F1 (f)), so no screen changes; the active-content
  refusal of N-R1 still applies to a file attached by id. **Not declared in the manifest:**
  `crm:write` does not name `assets.read` in `requires`, because a Sales Rep needs it for
  nothing the screens do — the advisory would tell every role editor to grant the library
  to people who only upload. **What it costs:** a client that attached by id with
  `crm:write` alone is now refused; §7's gate column says so. The tenant-isolation cases of
  `integration/crm/attachments.test.ts` give their Sales Rep `assets.read`, since they are
  about what a person who passes the gate still cannot reach. A rule keyed on what a file
  was uploaded *for* remains impossible without a foreign change, as N-F1 (f) ends. Both
  new cases were seen red before the gate existed (the contract case and the upload case);
  the implementation is the parked commit `6f8a0088e`, re-applied.
- **N-I6 (2026-10-06, T172, T175–T177, T179) — the Quote Request half of User Story 17,
  the five steps of N-G11.** (1)–(2) `'quote_request.detail.after'` and
  `QuoteRequestDetailZoneProps { quoteRequestId }` joined
  `packages/contracts/src/admin-contributions.ts` with the one mount in `RfqDetail.tsx`,
  after the card that holds the tabs. `useParams` types the id as possibly absent there, so
  the mount is behind `id ?` — the Order screen's is not. (3) The host test
  (`admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx`) is the Order host
  test's twin, with a stand-in contributor: the markup is byte-identical with no registry
  entry, with the contributor's module not present and with its permission not held, and a
  fourth render is the control; it also holds that the screen's source and
  `mod-quote-requests`' `package.json` name nothing of CRM. **The two existing `RfqDetail`
  tests needed the session providers**, as the handover predicted: `<AdminZone>` reads the
  contribution registry from context, so they now render under `withSession` with an empty
  registry — fourteen cases were red for that reason alone before the wrapper. (4)
  `DocumentOpportunityService` takes `quoteRequestPresence`, a lazy `quoteRequestReadPort`
  and the `rfqs:handle` check, in that order of use: presence (503 `MODULE_DISABLED`
  naming `quote_requests`, on both axes, whoever asks), then the permission (403), then the
  request through the port under the caller's scope. **Tenant filtering of `findById` is
  proven, not assumed**: a Sales Rep confined to another Organization gets 404
  `CRM_DOCUMENT_NOT_FOUND` for a request of the test Organization, linked or not, with the
  Organization's own Sales Rep and the platform administrator as the positive controls. Five
  contract cases, all seen red against the 422 the branch answered before. (5)
  `zones/QuoteRequestOpportunity.tsx` and its `zoneComponent` line (weight 600, `crm:read`);
  `LinkedOpportunityPanelProps['documentKind']` and the create page's `linkDocument` are the
  contract's `OpportunityDocumentKind`; the request's Organization is read from
  `GET /api/v1/admin/quote-requests/:id` (`rfqs:handle`, held by whoever is on that screen),
  and only for an unlinked request in front of a holder of `crm:write`. **The strings stay
  under `orderPanel.*`** (N-G10 (a)); the three sentences that say "order" gained a variant
  each — `orderPanel.noneQuoteRequest`, `orderPanel.pick.failedQuoteRequest`,
  `orderPanel.createForm.hintQuoteRequest` / `linkFailedQuoteRequest` — chosen by kind with a
  literal key on each branch, because `src/admin/index.test.ts` finds keys by scanning for
  literals (N-29). **Not done:** the panel does not say why linking is refused to somebody on
  the Order screen without `orders:read` or on the Quote Request screen without
  `rfqs:handle` — neither person can be on that screen. `quote_requests` gained one import
  (`@endora-commerce/admin-kit/zones`) and no dependency; its docs page and the Polish copy
  have the zone, and the changeset names `mod-quote-requests` and `contracts`.
- **N-J1 (2026-10-06, T117) — where the origin branch sits, and what it is made of.** The
  claim is checked in a file of its own, `services/opportunity-origin-link-service.ts`; the
  placed-document service (`opportunity-auto-create-service.ts`) calls it through one optional
  dependency, `linkByOrigin`, as **step 0** of `#placedOrder` and `#submittedQuoteRequest` —
  ahead of quote conversion, "already linked" and the setting, and *inside* the deferred
  re-read, because the document's Organization is needed to check the claim and
  `order.created.v1` arrives before its commit (N-E7, N-E18). The origin is read off the
  payload in the handler (`readEventOrigin`, the contracts schema) and carried through
  `#lookAgain` in the closure. Outcomes: `linked` and `already-linked` end the handling;
  `not-ours` (another `origin.type`) and `refused` fall through to the branches that were
  there, so such a document is handled exactly as one without an origin — which with the
  setting on means it gets its automatic Opportunity. The write is
  `OpportunityLinkService.linkAutomatically`, unchanged: one Command, `linkSource:
  'created_from_opportunity'`, idempotent on the unique constraint. `opportunity-link-service.ts`
  was not edited. Composition is one delimited section of `index.ts` plus two lines in the
  placed-documents section (the dependency and the `readEventOrigin(payload)` argument).
- **N-J2 (2026-10-06, T117) — who the events name, and the rule the link ended up with.**
  `order.created.v1` carries **no actor**: `orderId`, `organizationId`, and now `origin`. It
  was not given one — §B lists the one field. `rfq.created_by_admin.v1` carries `adminUserId`
  (§C2). The rule, for both: the Opportunity must exist and belong to the **same Organization
  as the document as its owner's read port answers it** (never the Organization the event
  claims); and, where the event names an administrator, that administrator's tenant scope —
  `adminTenantScopePort.resolveForAdmin`, `organizations`' own answer, so a role-less or
  unknown id reaches nothing — must hold the Opportunity's Organization. A refusal writes one
  warning (`opportunityId`, document, reason; "missing" and "another Organization" are one
  reason) and tells the caller nothing: both create routes answer what they answer without an
  origin. **What the Order path cannot check**: that the creating administrator holds
  `crm:write`. Tenant reach is implied there — `POST /api/v1/admin/orders` refuses a customer
  outside the caller's scope (`assertCustomerInScope`) and the Opportunity must be of that
  customer's Organization — but an administrator with `orders:write` and no CRM permission who
  knows an Opportunity's id can attach an Order of the same Organization to it. The buttons
  are gated on both codes; the event is not. Closing it needs the actor (and the question
  "does this role hold `crm:write`") on `order.created.v1`, which is `orders`' to add. The
  same holds for a Quote Request: reach is checked, the CRM permission is not.
- **N-J3 (2026-10-06, T108, T109, T114, T115) — four premises of the tasks, measured.**
  (a) *"an invalid `origin` is 422"* is false: a body the Zod schema refuses answers **400**
  `VALIDATION_FAILED` (N-13 (c) again); both owners' tests assert 400 and the code.
  (b) §B2, `orders`' `routes.ts`, **needed no edit**: the route hands the parsed body whole to
  the creation service, so the field arrives once `AdminCreateOrderInput` declares it.
  (c) §C2: `RfqAdminServiceDeps.events` is typed by the `RfqEvents` map of `rfq-service.ts`,
  and `plugin.ts` casts the bus to it — neither file is a row of §C. The new event's type
  (`RfqAdminEvents`) is therefore declared in `rfq-admin-service.ts`, beside its one emitter,
  and the emit widens the bus locally with one `as`. Adding the member to `RfqEvents` would be
  the tidier shape and is one line in a file this feature may not touch.
  (d) The OpenAPI baseline **did not move**: it records paths and not request bodies, so
  neither optional field is in it (regenerated; no diff).
- **N-J4 (2026-10-06, T112, T116) — what the create screens are handed, beyond §B5/§C3.**
  The contract names three query parameters (`originType`, `originId`, `customerAccountId`).
  Neither create screen has an Organization field — each picks a **customer**, whose
  Organization follows — and an Opportunity's contact person is optional, so "the
  Organization prefilled" needed more: `organizationId` narrows the customer search to that
  Organization (the list endpoint already filters by it) and offers its people before
  anything is typed; `customerAccountId` arrives chosen (one read of
  `GET /api/v1/admin/customers/:id` for the name, and on the quote screen for the
  Organization the request needs); `salesChannelId` arrives chosen on the order screen (a
  quote request takes no channel); and `returnTo`, a path of the Admin UI (a value with a
  scheme, a host or a leading `//` is ignored), is where the Back control leads and where the
  screen goes after creating, handing `{ createdDocument: { id } }` in the navigation state.
  A malformed origin pair is dropped rather than sent — the request would be refused for it.
  An arriving selection is not "unsaved work". Everything is generic: neither screen contains
  the word CRM, and opened without parameters each sends the request it always sent
  (asserted with `toHaveBeenCalledWith` on the exact body).
- **N-J5 (2026-10-06, T117) — returning to the Opportunity, and the moment the link is not
  there yet.** The redirect was chosen over a "Back to opportunity" affordance on the owners'
  detail screens: it is one branch in each create screen, and `OrderDetail.tsx` /
  `RfqDetail.tsx` are not rows of §B/§C. But the Order's link is written by the deferred
  re-read, 10 ms or more after the commit, and the redirect can win. So CRM's return address
  carries its own marker (`?created=order|quote_request`) and
  `components/CreateFromOpportunity.tsx` shows, in the matching link section, "Linking the new
  order…" while it reads the Opportunity again (after 300, 700, 1500 and 3000 ms), then
  "Order N was created and linked" — or, if the link never comes, that the document exists
  but is not linked here, with a link to it. The last case is real, not theoretical: the
  create screen still lets the user pick a customer of another Organization, and that
  document is created and refused the link (N-J2). The buttons sit in the headings of the two
  link sections (N-H6); each needs `crm:write` **and** the owner's create code —
  `orders:write` for `POST /api/v1/admin/orders`, `rfqs:handle` for
  `POST /api/v1/admin/quote-requests` — and the quote button also needs `quote_requests`
  present.
- **N-J6 (2026-10-06, T117) — N-E8 (g) is closed: a Quote Request an administrator creates is
  now a candidate for automatic creation.** `contracts/events-and-ports.md` §2 gives
  `rfq.created_by_admin.v1` both branches — link by origin, else automatic creation — and it
  is built so: without an origin that holds, the request takes the path of a submitted one
  and, with `crm.auto_create_from_quote_requests` on, gets its Opportunity. The setting's
  description in the manifest said "a quote request a customer submits" and was widened; the
  module page's two tables and its "what is not created" list follow, in both languages. The
  generated reference page prints the setting's name only and did not change.
- **N-J7 (2026-10-06, T114) — an Order's `origin` reaches outbound webhooks.** `webhooks`
  bridges `order.created.v1` and sends the event payload whole (`BRIDGED_EVENT_TYPES`), so a
  subscription to that type receives `origin: { type: 'crm_opportunity', id }` for an Order
  created from an Opportunity — to the receivers that already get the Order's id and
  Organization. It is additive and absent for every other Order; `orders`' page and the
  changeset say so. `rfq.created_by_admin.v1` is not bridged and not offered. Whether an
  opaque cross-module reference belongs in a public webhook payload is a question for the
  owner of `webhooks`' contract; stripping it would be an edit to `webhooks` or to the event.
- **N-J8 (2026-10-06, T110, T112) — which reds were observed.** Before the code existed: the
  owners' two integration files (the echo, the 400s; the new event), CRM's
  `create-from-opportunity.test.ts` (with the setting on, a second Opportunity *was* created;
  with it off, no link — and for Quote Requests the wait for an event nobody emitted), both
  create-screen tests and the CRM button tests. **Not** observed red: the two co-located unit
  files of the origin service and the origin branch (written after the service), and the
  off-state cases, which pass by construction once the positive control does.
- **N-J9 (2026-10-06, T118) — the story walked in a browser.** N-30's arrangement (headless
  Chromium, Playwright 1.60, the admin's Vite dev server over the modules' `dist`, the backend
  test composition on a throw-away `_test` database, created and dropped with its template),
  with **both automatic-creation settings on**. **English, 1440 px — 22 of 22**: both buttons
  on the Overview; *Create order* opens `/orders/new` with the origin, the contact person and
  the sales channel chosen and Back leading to the Opportunity; after saving, the Opportunity
  says "Order 1 was created and linked to this opportunity", lists it, and the number of
  Opportunities has not changed; the same for *Create quote request*; an Opportunity with no
  contact person hands over the Organization alone and its three customers are offered before
  anything is typed; `/orders/new` opened on its own has nothing chosen, Back to the list,
  sends no `origin` and ends on the new Order's screen. **Polish — 16 of 16**, no key on
  screen. No console error, page error or failed request in either. Two things seen and left:
  while the name of an arriving customer is being read, the field shows its placeholder and a
  spinner for a moment; and the first product the search offers for "Example" is one the test
  catalogue cannot sell (409 from `orders`, shown by the form) — the walk names the simple
  product instead. Not verified by eye: 390 px, a screen reader, dark theme.
- **N-R1 (2026-10-06, review finding 1) — an attachment is never a document a browser runs,
  and its link is a download.** The media library serves a private file from the API's
  origin, `inline`, under the stored type and with no content policy of its own, and the CRM
  upload is open to `crm:write` alone — so `offer.html` was a page running with the reader's
  session. CRM's half (`services/attachment-active-content.ts`): the upload **and** the
  attach-by-id refuse a file whose name *or* declared/stored type is HTML, XHTML, SVG, XML/XSL
  (any `+xml`) or JavaScript — either is enough, so `offer.html` declared `text/plain` and
  `offer.txt` declared `text/html` are both refused, before a byte is stored. The answer is
  415 with the library's own `ASSET_UPLOAD_TYPE_NOT_ALLOWED`, not a minted `CRM_*` code: it is
  the refusal this endpoint already passes on when the library's policy says no (N-F1), so a
  caller handles one code. The link handed out carries `download=1`, which the library's
  file route answers with `Content-Disposition: attachment`; a store's own signed address
  (S3/GCS, whose signature covers the query) is handed on untouched. **Not CRM's and still
  open:** the library route itself serves `inline` without `nosniff` or a sandboxing policy
  to anybody who drops the flag from a link, and the type stored is the declared one when
  the content sniff recognises nothing — reported for `assets_library`' owner.
- **N-R2 (2026-10-06, review finding 2) — a bell entry names the Opportunity by number, and
  nobody is assigned or told who cannot reach its Organization.** `admin_notifications`
  rows are read by their target outside the tenant scope, and R-9's "any active
  administrator may be the assignee" let a confined Sales Rep be handed an Opportunity of an
  Organization they cannot open — and then be sent its title and 200 characters of each
  message. Three changes. (a) The title of both entries is the number alone and the message
  entry has no body. (b) The reach of an administrator *other than the caller* **is**
  determinable through a published port: `organizations`' `adminTenantScopePort`
  (`resolveForAdmin`), the one the request-scope hook builds a caller's own scope from —
  wrapped once in `services/admin-reach.ts`; `organizations` is already a declared
  dependency. (c) `assertAssignable` takes the Organization and answers the existing 422
  `CRM_ASSIGNEE_INVALID` for somebody out of reach (assign, create, PATCH), and each
  recipient's reach is asked again when an entry is written, because reach is lost later:
  an assignee whose Sales Rep assignment was removed stays the assignee and is no longer
  told. The default assignee is unaffected — it is drawn from the Organization's own Sales
  Reps. R-9's sentence "the assignee decides nothing about visibility" stays true.
- **N-R3 (2026-10-06, review finding 3) — what of an Order `crm:write` alone reaches, decided
  rather than left as it fell.** A role holding `crm:read` + `crm:write` and not `orders:read`
  could link any Order of an Organization it reaches, read its number, status and total off
  the link, and move it by transitioning the Opportunity. Three decisions. **(a) Choosing
  which Orders follow asks for `orders:read`** (the code `orders`' manifest gates its own read
  surface with): `POST …/links` with `documentKind: 'order'` and `PATCH …/links/:linkId` carry
  a second `requireAdmin('orders:read')` in their `preHandler` and answer 403 without it;
  removing a link asks for nothing more. **(b) A reader without `orders:read` is shown a
  linked Order as `available: false`** — no number, status, total or currency — and a
  propagation outcome with `orderNumber: null`. The check is `services/orders-permission.ts`,
  over `admin_roles`' `permissionService` port (`listPermissions`, wildcard honoured); the
  system — a subscriber, a worker — is nobody's session and is not narrowed. Left as it is
  and worth knowing: the Opportunity's *computed value* is a sum over the linked documents
  and is shown to every `crm:read` holder, so one linked Order's total is derivable from it.
  **(c) The propagation itself is not gated on the acting administrator's `orders:write`,
  on purpose.** Which Order status a transition asks for is workflow configuration, written
  by a `crm:configure` holder; the Sales Rep who moves the Opportunity triggers a rule, and
  `orders` records the change against the actor CRM hands it. Gating it on
  `orders:write` would make "the Order follows the Opportunity" true only for administrators
  who could have moved the Order by hand, which is not the feature (FR-020…FR-022).
  `contracts/admin-api.md` §2 and §3 now say both.
- **N-R4 (2026-10-06, review finding 4) — "a closed Opportunity is never reopened by a
  mapping" is the transition service's rule now, not only the subscriber's.** The reverse
  direction looked at `closedKind` on its own read and then called `apply()`, whose
  re-evaluation after a lost race (N-B's `locked.statusCode !== from → evaluate again`)
  knew nothing of that rule: an Opportunity closed between the two was moved by the Order
  wherever the workflow had an edge out of the closed status (`lost → new` is seeded). For
  `cause: 'order_status'`, `apply()` now refuses on **every** evaluation when the current
  status's kind is not `open`, and again under the lock by the row's own `closedKind` /
  `closedAt`. The refusal is 409 `CRM_INVALID_TRANSITION` carrying `details.closed`, which
  the reverse direction reads as `ignored: closed` — the answer it already gives for an
  Opportunity that was closed all along — rather than as a `skipped` outcome.
- **N-R5 (2026-10-06, review finding 5) — an Order-caused move that fails for a reason
  other than a workflow refusal leaves a `failed` row and an audit entry before it is
  rethrown.** Only the four workflow refusals became a `skipped` outcome (N-B); a throwing
  guard, a failed write or anything else was rethrown into the event bus, which logs a
  handler's error and goes on — so the Order had moved, the Opportunity had not, and nothing
  on the Opportunity said so. The catch now writes a reverse-direction row with
  `outcome: 'failed'` and the message, through the same Command as a skip
  (`crm.opportunity.propagation_skip`, whose audit `stateAfter` gains `outcome`), and then
  throws the original error. **It is not listed in `unresolvedPropagations`, by the model's
  design**: that list is forward-only (`data-model.md`; `isUnresolved`), because retry and
  dismiss mean "ask the Order again", which has no reverse reading. The row and the audit
  entry — which is what the Opportunity's change history is read from — are the record.
  `ModuleDisabledError` is rethrown first, as before, and records nothing.
- **N-R6 (2026-10-06, review finding 6) — a note's or a message's text is not written into
  the audit trail.** `audit_logs` is `@GlobalEntity`: an administrator holding
  `audit_log:read` reads every entry, whatever Organizations their role confines them to,
  while a note is read only under an Opportunity loaded through the tenant-scoped
  EntityManager. `note_add` / `message_add` / `note_update` / `note_delete` carried `body`
  in their audited state, so the trail was a second, unscoped copy of the conversation.
  They now carry the comment's id, its kind, its author and the text's **length** — that
  something was written, by whom, and that an edit changed it — and never the text; a
  deleted note's row is kept, marked, and is still where what it said is read. **Left as it
  is, and the same shape:** the Opportunity's own audited state (`auditSnapshot`) carries
  its title and description, a transition's entry carries the optional `reason`, an
  attachment's entry the file name, and a skipped or failed Order-caused move the guard's
  sentence. Those are the Opportunity's change history (R-16 reads it from the audit trail),
  so removing them is a design change to that story rather than a fix; whether
  `audit_logs` should scope a read by the entry's subject is a question for its owner.
- **N-R7 (2026-10-06, review finding 7) — a date the calendar does not have is refused by
  the contract.** `calendarDateSchema` was the shape `YYYY-MM-DD` and nothing more, so
  `2026-13-45` reached `new Date(…)` in the list and the board (an `Invalid Date` bound into
  a statement) and `2026-02-31` reached a `date` column: 500 each. The schema now also asks
  that the day exists — round-tripped through a UTC date, leap years included, year `0000`
  refused — so every consumer answers the envelope's 400 `VALIDATION_FAILED`: the list's and
  the board's `createdFrom` / `createdTo`, `expectedCloseDate` on create and PATCH, and the
  analytics range, which shares the schema.
- **N-R9 (2026-10-06, review finding 9) — an `If-Match` that cannot be read is 400, not
  "no precondition".** `PATCH /opportunities/:id` read the header with `parseInt` and took
  anything unparseable for an absent header, so a client that sent a garbled version had its
  guarded write applied unguarded — and `"1abc"` was read as `1`. The header is now the
  version exactly, quoted as the `ETag` gives it or bare (`"3"`, `3`), or `*`, which like an
  absent header asks for nothing; a weak validator, a list or anything else answers 400
  `VALIDATION_FAILED` before the service is called. `contracts/admin-api.md` §1's row is
  left as it reads (it names the header and the 409) to keep this change out of a table
  other branches edit; the 400 belongs in it.
- **N-R10 (2026-10-06, review finding 10) — the tag filter is a subquery, not a list of
  ids.** `opportunityIdsCarryingAll` read the id of every Opportunity on the platform
  carrying the tags — unscoped, by design — into the process and bound them all back into
  the list's and the board's statements: one parameter per tagged Opportunity, whoever asked
  and however few of them they reach. `TagService.carryingEvery` now answers conditions: one
  `"id" in (select "opportunity_id" from "crm_opportunity_tags" where "tag_id" = ?)` per
  distinct tag, AND-ed with the rest — which is "every tag named" without a `group by` —
  added to the same scoped read as before, so the tenant constraint is untouched and the
  planner drives from whichever side is smaller. The early "no Opportunity carries them"
  return is gone with the ids; the statement says none. Measured on the test database with
  70 000 Opportunities of another Organization carrying the tag, for a Sales Rep who reaches
  none of them: 1 162 ms before, 36 ms after — what the list takes with no tag filter.
- **N-R11 (2026-10-06, review finding 11) — eleven guards had no test; each has one now,
  and each test was seen red against its guard taken out.** The review removed them one at
  a time with the suite green. `backend/test/integration/crm/review-guards.test.ts` (and one
  case of `review-regressions.test.ts`) hold: the reverse direction ignoring an event whose
  Organization is not the Opportunity's; PATCH refusing a contact person of another
  Organization; a status's `kind` not changing while an Opportunity is in it; the five
  workflow-configuration writes answering 403 to `crm:read` + `crm:write` without
  `crm:configure`; retry refusing once the Opportunity moved on, and for an Order that no
  longer follows (following switched off, and the link gone — two halves of one condition);
  a second dismissal; the echo marker matching only the status the Order was asked for, and
  being consumed once; reopening clearing `closedAt` and `closedKind`; a stale `pending` row
  shown as unresolved. Two things the tests had to learn: a 409 `VERSION_CONFLICT` reaches
  the caller with the envelope's own sentence, so *which* refusal it was is asserted by
  what was not written, never by the message; and a stale `pending` row is rendered
  `failed` — `pending` is not an outcome the contract shows anybody.
- **N-R12 (2026-10-06, review finding 12) — three "likely" defects, taken one at a time.**
  **(a) A bell that cannot be written does not turn a committed write into a 500.** An
  assignment (assign, create, PATCH) and a message are committed before anybody is told, and
  the telling — the reach lookup and `admin_notifications`' port — ran bare after it: a
  failure there answered 500 for a write that had happened, and a client retrying a message
  posted it twice. `tellAfterCommit` (`services/crm-notifier.ts`) is the one place that
  tolerates it: `rethrowIfModuleDisabled` first, as composition item 7 asks of a narrow
  tolerance, then a `console.warn` naming the Opportunity and the error — the module holds
  no logger, and `orders`' own after-commit e-mail helper logs the same way. The notifier
  itself still catches nothing.
  **(b) A status is not deleted, or re-defined, under an Opportunity on its way into it.**
  `crm_opportunities.status_code` is held by value (R-2: no foreign key), "in use" was a
  count, and the count could not see a transition that had not committed — nor could a
  transition see a delete that had: either order left an Opportunity in a status the
  workflow no longer has, or closed/open against what the status now means. The two sides
  now meet on the status's own row. Whoever puts an Opportunity into a status — the
  transition Command, and the create Command for the start status — reads that row
  `for share` inside the Command, after the Opportunity's own lock, and holds it to the
  commit; `updateStatus` and `deleteStatus` read it `for update` before they count. So a
  configuration write waits for a move in flight and then counts it (409
  `CRM_STATUS_IN_USE`), and a move that waited for a configuration write finds the row gone
  or its kind changed, writes nothing and is evaluated again from the top against the
  workflow as it is now — 422 for a deleted target, the new `closedKind` for a re-defined
  one; a creation answers 409 `VERSION_CONFLICT`. One lock order everywhere (Opportunity,
  then status; configuration takes the status alone), so the two cannot deadlock.
  **(c) Left: one `getAsset` call per attachment.** The list signs a link per file through
  `assetsLibraryPort.getAsset`, and that port has no batch read (`upload`, `getAsset`,
  `patchAsset`, `softDelete`); `assetReadPort.findByIds`, which the list already uses for
  the rows, answers no link. Batching it is a method on `assets_library`' port — its
  owner's change, not a loop to restructure here.
- **N-R13 (2026-10-06, after the merge of the review branch) — each fix held to the code
  that did not exist when it was written.** The review ran on `e9157aaae`; quote-request
  links, the computed value, automatic creation, change history, references, custom fields,
  analytics and creation from an Opportunity are all later. `review-extensions.test.ts` and
  `admin/test/modules/crm/owner-permissions.test.tsx` hold what follows; **six of the backend
  cases and all five admin cases were seen red first**, the rest passed on the merged tree
  and are kept as the statement of the rule (one of those, the audit case, was then seen to
  fail with a note's text put back into the audited state).
  **Finding 3 — what another module owns is shown to somebody who may read it there.**
  N-R3 decided it for Orders; one check now answers for three owners
  (`services/owner-read-permissions.ts`, over `admin_roles`' `permissionService`; the system
  is not narrowed). (a) **A Quote Request is read with `rfqs:handle`.** `quote_requests`
  declares exactly one code and gates its admin list and detail with it, so that is what
  "may read a Quote Request" means. A linked Quote Request renders `available: false` without
  it; `POST …/links` with `documentKind: 'quote_request'` and `GET /lookups/quote-requests`
  ask for it beside `crm:write`. **This reverses N-H2 on one point**: the lookup was built so
  that a Sales Rep "needs no code of the quote desk to link", and it now asks for that code —
  it keeps its narrower answer (`id`, `number`, `status`, one Organization) and its place as
  the picker's source. The owner may prefer N-H2; the reversal is one call in the link
  service, one in the lookup service and one line in the link renderer. **The code is asked
  by the services, after presence, and not by `requireAdmin` on a route** — the first version
  gated the two routes, and two things refused it: with `quote_requests` off the routes
  answered 403 where §3 and §10a say 503 `MODULE_DISABLED` (a case holds both axes), and
  `backend/test/unit/admin_roles/foreign-gates.test.ts` (D-173) reports a route gate naming a
  switchable module's code as debt — while its owner is off the code can be granted to
  nobody. `orders` cannot be switched off, so `orders:read` stays a route gate. (b) **`excludedDocuments`** names a document
  only to a reader who may read that kind — an entry says the document's status counts and its
  currency differs. The filter is on what is shown; `#evaluate` is untouched, because a
  recalculation runs under whoever's request caused it and the stored figure must not depend
  on that (a case holds it: the mode switched by a role without `orders:read` stores the
  right sum). **The computed value itself is not narrowed** — N-R3's position stands: it is
  the Opportunity's own figure, the list sorts by it and the board and the analytics add it,
  and one linked Order's total remains derivable from it. (c) **References**: an Order's
  number needs `orders:read` and a Product's name `catalog:read`, in the description and in
  every note and message; the owner's port is not asked at all for a reader without the code.
  This narrows R-21 / N-E14, which asked no catalog permission to read a name. (d) **`GET
  /documents/:kind/:id/opportunity`** asks for the owner's read code as well: 404-versus-200
  says whether a document exists and whether it has an Opportunity. Whoever is on the
  document's screen holds the code already, so no panel changes. (e) **Nothing else needed a
  change, and each was looked at**: the change history returns ids and never a number (a case
  reads the whole response as a role without `orders:read`); the Organization panel lists
  Opportunities; the origin path links by event and renders nothing; `opportunityReadPort`
  answers Opportunities. **Left, and worth knowing:** an Opportunity created automatically is
  titled "`<document number>` — `<organization>`" (R-8), so that number is in a title every
  `crm:read` holder reads. (f) **On the screens** the Order picker and the following switch
  are offered to a holder of `crm:write` and `orders:read`, the Quote Request picker to a
  holder of `crm:write` and `rfqs:handle`; neither list is asked on behalf of anybody else,
  a holder of `crm:write` alone is told why, and unlinking stays with `crm:write`.
  **Finding 2.** `createForDocument` told the default assignee with the title; it now goes
  through the same `notifyAssigned` — number only, reach asked again. Origin linking writes
  no bell entry. **Finding 6.** An edited note still rewrites its references inside its
  Command and audits `length`; the reference rows are ids and never part of an audited state.
  The change-history tab labels `length` and no longer prints `authorAdminUserId` (the
  entry's actor is named above it). **Findings 4, 5, 8, 12.** The value recalculation locks
  the Opportunity alone and writes `computed_value` alone — status, closing and `version`
  untouched, held on a closed Opportunity; a document linked automatically or by origin
  writes a link and takes no lock, so it joins the one order (Opportunity, then status) at
  no point; an automatically created Opportunity that was closed is not reopened by its
  Order. **One change:** the create Command's "start status gone" refusal (N-R12 (b)) is a
  409 a person retries, and nobody retries a subscriber — the placed document would have
  been left without its Opportunity. `createForDocument` reads the workflow again, once, and
  creates in the start status the workflow has by then. **Findings 7, 9, 10.** The five
  analytics ranges, the board's and the list's dates share the refined schema (400 each);
  the history's `limit` and `cursor` already answered 400; `If-Match` is read by `PATCH
  /opportunities/:id` and by nothing else; `sort=value` composes with the tag subqueries, and
  the board's totals with the tag and assignee filters. **Finding 1.** The upload's answer,
  the by-id attach's answer and the list all hand out `download=1`; nothing else hands out a
  link to a file.
- **N-P1 (2026-10-06, T144) — no read-size band refuses the branch.**
  `backend/test/unit/scripts/check-read-size.test.ts` is green on the merged tree: 43 of 47
  recorded entries drift and every one is inside its band, the furthest being
  `check-admin-surface.ts` at 49% of the way to its ceiling (sites 1788 → 2230). Nothing was
  re-recorded and nothing re-measured — a pull request re-records only an entry its band
  refuses (`specs/conventions/check-estate.md` § *When a read size is re-recorded*); the
  release pull request sweeps the drift.
- **N-P2 (2026-10-06, T141) — the page, read end to end, and what it had wrong.** (a) One
  sentence contradicted the page and the code: "Linking does not need the permission to
  handle quotes" — it does (N-R13). (b) **The quote-conversion path was described as working
  and is not effective**: nothing in the platform writes `orders.source_quote_request_id`
  (N-E3), so an Order placed from a linked Quote Request is not linked by itself, gets an
  Opportunity of its own when automatic creation is on, and the pair is added twice to a
  computed value when both are linked by hand. The page now says so in the three places that
  claimed otherwise, with what an operator does meanwhile. (c) Added from the product-owner
  audit: where the automatic-creation switches and the Sales Rep assignments are; bell
  entries and Setting names being English only; who a message notifies (nobody, on an
  unassigned Opportunity's first message); the ranking's *current* assignee and UTC months;
  "most valuable" is value, not profit; `PUT /value-counting-statuses` in the workflow table;
  a value following an Order's status and not its amount; `crm.opportunity.document_linked.v1`;
  the guard example's imports and that a guard runs on an Order-caused move; a *What the
  module does not do* section (import/export, e-mail, global search, profit, demo data).
  (d) The Polish copy was read against the English one section for section and matches;
  its vocabulary was made one (`wyliczana`, `znacznik`, `punkt końcowy`, `Admin UI`,
  `karta`) and the capitals a search-and-replace had left mid-sentence were lowered. The
  sections CRM added to the `orders`, `quote_requests` and `webhooks` pages were read in both
  languages; one capital fixed. The cache script still writes the source hash
  unconditionally, so `check:docs-translations` is no evidence of any of this.
- **N-P3 (2026-10-06, T143) — the board, measured in a browser.** Two recorded observations
  and what was done. *Six lanes do not fit at 1440 px*: lanes were a fixed 288 px, which did
  not fit at 1920 px either. They now share the board's width down to 256 px
  (`min-w-64 flex-1 basis-64`, at most 384 px), so six fit without scrolling from about
  1900 px and the board scrolls sideways below that — at 1440 px four lanes and the edge of a
  fifth are in view, which is the cue. *Lanes have no height of their own*: `KanbanBoard`
  still bounds nothing itself; a lane's list is `overflow-y-auto`, and a caller that gives the
  board a maximum height through `className` gets lanes that scroll under their headers. This
  works because a single-line flex container clamps its line to its own `max-height` and the
  lanes are stretched to the line. CRM passes `max-h-[max(28rem,calc(100dvh-8rem))]`, so the
  board is never taller than the window and its sideways scroll bar is in view with its top.
  **Measured** (headless Chromium, 55 cards in one status): at 1440, 1920 and 390 px the board
  is no taller than the window and the long lane scrolls; keyboard — focusing a handle
  scrolls its lane to it, Space lifts, the right arrow reaches the next lane and, five
  presses on, a lane that was off screen (the board scrolls to it), Space drops, focus
  returns to the handle; mouse drag out of the scrolled lane; touch — a sideways swipe
  scrolls the board and a vertical one the lane. **One thing learned the hard way**:
  `overscroll-behavior: contain` on the lane's list stops a sideways swipe from reaching the
  board, because `overflow-y: auto` makes the list a scroll container on both axes. It is not
  there. Not verified: a physical touch device, a screen reader (T093's hand-off).
- **N-P4 (2026-10-06, T143) — the pass over every screen, by instrument.** axe-core (WCAG 2.0
  to 2.2, A and AA) and a target-size measurement over the seven screens, the Opportunity's
  five tabs and the three contributed panels, at 1440 and 390 px. **Fixed:** (a) status and
  tag badges — the kit's `readableTextColor` chose white by a brightness threshold, giving
  2.1:1 to 3.7:1 on the default workflow's own colours; it now takes the better of black and
  white by contrast ratio, at least 4.58:1 on any colour. A kit change that also re-colours
  the text of order and return status badges on mid-tones; it has its own changeset.
  (b) 28 CRM buttons were 32 or 36 px high on a touch screen; all 76 now carry `min-h-11`
  with a `sm:` step down, held by a source test. (c) The drag handle keeps its 28 px picture
  and has a 44 px hit area (a pseudo-element; the card's gap grew to 8 px to keep it clear of
  the title). (d) The "All opportunities" link under the Organization panel was told from its
  sentence by colour alone. (e) The "Move to…" chevron's transition respects reduced motion.
  **Left, because they are the kit's or another module's, and changing them changes every
  admin screen:** `Input`, `Select`, `Combobox` and the multi-select trigger are 36 px high at
  every width; the combobox's *Clear selection* is 18 px; the status-transition graph's
  *Connect* / layout buttons are 32 px; the shell's back link above a page title is 16 px
  high; the Organization screen has a `<select>` with no accessible name. After the fixes axe
  reports nothing on any CRM screen or panel.
- **N-P5 (2026-10-06, T142) — amounts: one formatter, and it is the kit's.** Every amount CRM
  shows goes through `moneyLabel` → `formatMoney` of `@endora-commerce/admin-kit/lib`, which
  formats in the **currency's home locale** and not in the language on screen — the admin's
  convention, the one the Orders screens follow. `9.800,00 €` is `de-DE` for EUR and
  `2300,00 zł` is `pl-PL` for PLN, where CLDR groups thousands from five digits on
  (`12 300,00 zł`). Correct `Intl` output for each pair, and not an inconsistency of CRM's;
  whether an EUR amount should follow the reader's language instead is a question about the
  kit's map (`EUR → de-DE`), for every screen at once.
- **N-P6 (2026-10-06, T145, T180) — the deletion probe.** In a throw-away worktree
  (`git worktree add … -b probe/143-crm-deletion`, removed with its branch afterwards):
  `git rm -r packages/modules/crm packages/contracts/src/crm.ts packages/contracts/src/crm.test.ts`,
  the `export * from './crm.js'` line, CRM's own host-side tests (`backend/test/{contract,integration}/crm`,
  three `backend/test/helpers/*crm*` files, `admin/test/modules/crm`) and its five generated
  documentation artefacts; `manifests:generate`, `composer:generate`,
  `pnpm install --lockfile-only`. **By hand, beyond deletion:** the application's own
  dependency line in `backend/package.json` (`admin/package.json` is rendered, the backend's
  is not), and two harness files returned to `origin/master`
  (`backend/test/helpers/package-entities.ts`, `test/unit/kernel/contribution-absent-owner.test.ts`
  — each a list of every module the branch had extended by CRM). **Results:**
  `pnpm run build:packages` exit 0; `pnpm -r run typecheck` exit 0 — no production file
  outside the module imports it or its contract; `composer:check` and `manifests:check` up to
  date; admin build exit 0; the admin suites of `orders`, `quote_requests`, `organizations`,
  `custom_fields`, `webhooks`, `admin_users`, `audit_logs`, the shell and `KanbanBoard`
  32 files / 183 tests green, the after-zone tests of the Order and Quote Request screens
  among them (empty zones, screens unchanged); `orders/admin-create-origin` and
  `quote_requests/admin-create-origin` 10 of 10 each (an `origin` is accepted and ignored);
  `webhooks/contributed-events` 11 of 11. `custom_fields`: `GET /entity-types` answers five
  types without `opportunity`, and creating a definition for it answers
  `409 CUSTOM_FIELD_HOST_MANAGED` — observed as the *failures* of
  `custom_fields/entity-owner-presence.test.ts`, which presupposes the module it switches
  off. **What is red without CRM, and why it is not coupling:** `test:unit:fast` 340 of 346
  files — the six are ledgers that enumerate the tree (four over the fifteen `CRM_` members
  of the shared `ERROR_CODES`, the tenancy chain ledger, `check:release-intent` over
  changesets naming the deleted package); the audit-reference and sales-channel-attribution
  owner lists and the OpenAPI baseline, for the same reason. **Residue a full removal also
  takes out**, none of it an import: those fifteen error codes and their ledger entries, the
  `'opportunity'` host type, the `'crm'` navigation section and its shell entry, the
  `crm_opportunity_attachment` reference kind, and one line in `audit_logs` that attributes
  the `crm.` action prefix — the same prefix table every other module is in.
- **N-P7 (2026-10-06) — changesets.** Nine files written wave by wave contradicted each other
  where a later wave reversed an earlier one. Replaced by one entry per package bumped
  (`mod-crm`, `contracts`, `mod-orders`, `mod-quote-requests`, `mod-webhooks`,
  `mod-custom-fields`, `mod-audit-logs`, `admin-shell` with `mod-i18n`) and three for the
  kit's three unrelated meanings. The shell's CRM section had no changeset before.
- **N-S1 (2026-10-06, second review, finding 1) — a Command of this module asks no other
  module, and what replaced the lock's guarantee.** A value recalculation locked the
  Opportunity and then read its documents through `orderReadPort` / `quoteRequestReadPort`.
  A port obtains an EntityManager of its own, so every recalculation held one pooled
  connection while it waited for a second: with as many in flight as the pool has
  connections (ten) each waited for the others until the pool's 60 s timeout. Measured: 14
  at once, 10 rejected after 61.7 s. **Now:** the documents are read *before* the Command;
  the Command locks the Opportunity, re-checks the mode, re-reads the link set and writes.
  The lock used to guarantee "the figure read last is the one that stays"; two checks hold
  that instead. (a) A link set that differs under the lock from the one evaluated writes
  nothing and the Opportunity is evaluated again. (b) After **every write** the Opportunity
  is evaluated once more, and a figure is left only when an evaluation that began after its
  commit agrees with it — so of two overlapping recalculations whichever writes last also
  looks last. (b) is what covers a document changing *status or amount* mid-recalculation,
  which the link set cannot see, and it works across processes (the API and a worker),
  which an in-process mutex would not. Cost: a figure that changes is evaluated twice, one
  that does not, once. Three passes at most (`MAX_PASSES`), then the figure is left and the
  queue is asked for that one Opportunity. **The same rule, one other site:** an
  Opportunity's create and edit called `customFieldValueService.validateAndMerge` inside
  their Commands (a cached read, but a read through another module's EntityManager on a
  cold cache). Both validate before the Command now. An edit merges against the values it
  read; the Command applies the result only if the locked row still holds those values,
  and otherwise the edit validates again against what the row holds — three times at most,
  then 409 `VERSION_CONFLICT`. A consequence for the order of refusals: an invalid custom
  field is refused before an unknown Sales Channel or tag, which the Command still checks.
  **No other site:** every `commandBus.run` body under `src/backend/services/` was read —
  `forwardTargets`, `tags.resolve`, `#saveReferences` and `#messageRecipients` read this
  module's own tables on the Command's EntityManager. **`check:transaction-context` does
  not see this pattern** and a small addition would not make it: the rule finds
  connection-level SQL written inside a transaction, and "this call is another module's
  port" is not lexical — a port is a constructor dependency typed by a contracts interface,
  so the rule would need the type checker or a per-module list of dependency names.
- **N-S2 (2026-10-06, second review, finding 2) — one handler for `order.status_changed.v1`,
  value first; and the announced value is read after the commit.** Two `ctx.subscribe`
  handlers ran in registration order: the reverse mapping moved the Opportunity and
  announced `crm.opportunity.closed.v1` before the value subscriber wrote the figure, so
  the public payload said `0.00` for a win worth `123.00`. One handler now recalculates and
  then applies the mapping, the second from a `finally` so a recalculation that throws does
  not cost the move (the bus used to isolate the two). Still one `ctx.subscribe`, so the
  off-state gating is unchanged; the echo and one-hop rules are the propagation service's
  and are not touched. Independently of that ordering, `OpportunityTransitionService` now
  reads the Opportunity again after its commit and after the Orders were asked, and
  announces *that* effective value: a manual transition whose forward propagation changes
  a linked Order's counting status had the same stale figure. A failed re-read announces
  the figure the Command held. `status_changed.v1` carries no value and is unchanged.
- **N-S3 (2026-10-06, second review, finding 3) — the detail answers a live figure; the
  stored one still lags for everything else.** `quote_requests`' `patchDraft` emits no
  event, so a customer editing a linked Pending request left `computed_value` at the old
  amount (that module is not changed here). The detail already evaluated the documents to
  name the excluded ones; `OpportunityValueService.liveFigure` returns that evaluation's
  value as well, the detail answers it as `value` and `computedValue`, and when it differs
  from the stored column the service asks the queue for that Opportunity — the read writes
  nothing. The request is a job `recalculate-one` on the existing queue whose id is the
  Opportunity's and which is removed the moment it ends, so at most one waits per
  Opportunity however often the screen is opened. No queue in the composition, or Redis
  away: the request is dropped (logged in the second case) and the read is unaffected.
  **What remains:** the list's `sort=value`, the board's totals and every analytics figure
  read the stored column and lag until that job runs or the next announced change; in a
  composition without queues they lag until the next announced change, a link change or
  the next counting save. An Opportunity nobody opens is not corrected by this at all. The
  repair that closes it is an event from `quote_requests` on a draft edit. A second
  consequence: between a counting save and its job the detail already shows the new
  figure while the list shows the old one (`value.test.ts` held the detail to the old one
  and now reads the column).
- **N-S4 (2026-10-06, second review, finding 4) — the cross-Organization guard of FR-027 has
  a test.** `linkOrderPlacedFromQuoteRequest` compares the Opportunity's Organization with
  the Order's; removing the comparison left every suite green. The case: an Order of B
  naming A's linked Quote Request as its source is not linked, and nothing is created in B.
  Mutation confirmed (`'joined'` with the comparison removed).
- **N-S5 (2026-10-06, second review, finding 5) — a refusal's `detail` is the Order's.**
  N-R3 withheld an Order's number from a caller without `orders:read`; the refusal's
  `detail` is the Order workflow's own sentence and names the status the Order is in ("no
  edge from "processing" to "completed""). It is `null` for such a caller in the detail's
  `unresolvedPropagations` and in the answers of `POST …/transition` and `…/retry` — all
  three go through the one `#render`. `orderStatusCode` stays: it is the status *this
  module's mapping* asked for, readable by anybody who reads the workflow.
- **N-S6 (2026-10-06, second review, finding 6) — definitions of an absent owner's type are
  not served.** `custom_fields`' `GET /definitions` and `GET /definitions/:id` now apply
  the registry's `isOwnerPresent` (§ H of the foreign-change list already names the file):
  left out of the list, 404 `CUSTOM_FIELD_NOT_FOUND` by id, served again with the owner.
  Not changed: a mutation of such a definition still answers the 409 it did, which tells a
  holder of `custom_fields:write` that the id exists.
- **N-S7 (2026-10-06, second review, finding 7) — six guards, each with a test confirmed by
  removing the guard.** Saving the counting statuses enqueues a pass, and the function
  BullMQ invokes enters a system scope: both in `value-recalculation-queue.test.ts`, the
  first test of this module that puts a real BullMQ queue and the module's own producer
  and consumer on a real Redis. **A trap met while writing it:** the harness leaves a
  `system` tenant context ambient around a test, so "the pass could read a scoped table"
  proves nothing and neither does the context's mode — the assertion is on the scope's
  *reason*. The other four: the unique-constraint answer of `createForDocument` under three
  concurrent deliveries; the recalculation's row lock (a recalculation with nothing to
  write waits for a transaction that holds the row); the deferred look's presence check;
  the first recalculation of an Opportunity created for an Order that already counts
  (asserted on the stored column — the detail would hide its absence since N-S3).
- **N-S8 (2026-10-06, second review, read-only findings).** (a) `recalculateAll` goes on
  past an Opportunity that throws and fails at the end naming how many it left; a module
  switched off still ends it at once. Jobs are enqueued with `attempts: 3` and a 5 s
  exponential backoff. (b) A failed `enqueue()` after a counting configuration committed
  is logged and the answer stays 202; the 202 body is the workflow and has no field to say
  "not scheduled", and none was added. (c) The deferred look asks `stillPresent()` after
  every pause, before it reads — one check, moved out of the composition's `defer`, where
  it was asked once before up to two seconds of waiting. (d) **Not fixed:** the change
  history at its 500-entry reach answers `hasMore: false`. Saying so needs a field the
  shared collection envelope does not have — a contracts change, an OpenAPI baseline and
  a line in the history tab, on a branch where the contracts are being amended elsewhere.
- **N-S9 (2026-10-06, second review, question 8) — a document created from a closed
  Opportunity is linked to it. Decided: allowed.** A closed Opportunity accepts a link made
  by hand, so it accepts the document created from it; the Opportunity stays closed, and a
  mapping never reopens it (N-R4). Pinned in `create-from-opportunity.test.ts`. The
  contracts are not edited here.

## Questions put to the owner — all decided on 2026-10-05

Nothing is open. The three questions this design raised were answered in the second round,
and the third answer was reversed in the third round the same day.

| # | Question | Owner's decision |
| --- | --- | --- |
| **Q1** | Should switching the Quote Requests module off be refused while CRM is on, or allowed with CRM degrading? | **Allowed; CRM degrades** (R-17) — the default, accepted. |
| **Q2** | When an Order refuses the mapped status, should the Opportunity's own transition still stand? | **Yes — it stands; the refusal is shown and retryable** (R-4) — the default, accepted. |
| **Q3** | Native drag-and-drop for the board, or `@dnd-kit`? | **`@dnd-kit`** — the native default was accepted and then reversed: "it may be useful not only in this module but in the future too". R-20 is rewritten accordingly; the "Move to…" menu stays for WCAG 2.2 SC 2.5.7. |

### Reconciliation after the product-owner audit, 2026-10-06

"Nothing is open" above is true of the three design questions. The audit of 2026-10-06 (T147)
compared every artefact of this directory with the tree; what it found was corrected in the
artefacts, and two things came out of it that only the owner can decide. They are marked
`[NEEDS CLARIFICATION — owner]` in `spec.md` § Clarifications, each with the default now in
force:

| # | Open for the owner | Default written into the spec |
| --- | --- | --- |
| A-1 | Repair the platform so an Order records the Quote Request it was placed from (N-E3), before CRM ships? | No repair inside this feature; FR-027, "counted once" and the second half of FR-061 stand as implemented-but-unreachable and are marked so |
| A-4 | Admit the demo data set to this feature's foreign changes and decide whether the demo gains an Order (N-G5)? | Not built; User Story 14 scenario 3 stays, marked deferred |

The nine decisions taken while implementing (`spec.md` § Clarifications, D-1…D-9) are not
open questions — each is in force — but each is the owner's to reverse.

**Change log — what was amended, and the line of the tree each amendment was checked
against.** Paths are under `packages/modules/crm/src/` unless they start elsewhere.

| Artefact | Amendment | Checked against |
| --- | --- | --- |
| `spec.md` header | `Draft` → `Accepted — …`, the value the three implemented specs of this repository carry | `specs/138-separate-components/spec.md`, `specs/140-instance-upgrade/spec.md`, `specs/141-module-block-renderers/spec.md` — every task ticked, all three `Accepted` |
| `spec.md` FR-071, SC-008 | curated palette, not every screen | `manifest.ts:267-308` (four `actions`); `.specify/memory/constitution.md` Principle XVI, "Curated, not exhaustive" |
| `spec.md` Assumptions | analytics in UTC | `backend/services/analytics-service.ts:71,120` |
| `spec.md` US14 AS3 | deferred | `manifest.ts:313` (`demo: false`); no `backend/demo/` directory |
| `spec.md` FR-072 | two English-only exceptions | `backend/services/opportunity-comment-service.ts:131`, `backend/services/opportunity-assignment-service.ts:162`; `manifest.ts:30-64` |
| `spec.md` FR-027, FR-033, FR-061, US8 AS4/AS6, US9 AS3, SC-009 | implemented, unreachable | no writer of `sourceQuoteRequestId` under `packages/modules/**` outside tests and migrations; readers at `packages/modules/orders/src/backend/services/order-read-port.ts:97`, `backend/services/opportunity-link-service.ts:268`, `backend/domain/value-calculation.ts:125` |
| `spec.md` FR-032 | the triggers that exist | `backend/index.ts:260,502,512` (subscriptions); `packages/modules/orders/src/backend/services/order-service.ts` is the only writer of an Order's `total` found |
| `spec.md` FR-079, FR-080 | added | `backend/services/owner-read-permissions.ts`; `backend/routes/routes.links.ts:41,58`; `backend/routes/routes.attachments.ts:45`; `backend/services/attachment-active-content.ts` |
| `contracts/events-and-ports.md` §5 | the nineteen consumed names, owners and edges | every `lazyPort<` in `backend/index.ts`; `manifest.ts:97-165`; `Container name:` markers in `packages/contracts/src/{organizations,assets-library,admin-roles}.ts`; `check:port-dependencies` run, `violations=0` |
| `contracts/events-and-ports.md` §1–§2 | `closed` in the emit order; one `EventBus.run`; payloads | `backend/events/opportunity-status-events.ts:101-125`; `backend/services/opportunity-transition-service.ts:299`; `packages/contracts/src/crm.ts:925-1055`; `backend/services/opportunity-auto-create-service.ts:259` |
| `contracts/foreign-module-changes.md` | all 55 files of the stated `git diff --stat` are rows; H5 struck; §D2 added | the command at the top of that page, run at `3e4fb441d` |
| `data-model.md` § Audit actions | 28 audited actions, 3 never audited | `backend/services/opportunity-history-labels.test.ts`; `i18n/en.json` `auditLog.*` (28 keys) |
| `data-model.md` § Locking | new | `backend/services/opportunity-transition-service.ts:202,215`; `backend/services/opportunity-service.ts:339`; `backend/services/workflow-config-service.ts:193,250` |
| `contracts/admin-api.md` §2, §4, §10, §13 | refusals of N-19 / N-20; `perColumn` max; how a code is minted | `backend/services/order-status-propagation-service.ts:93,97`; `backend/services/workflow-config-service.ts:32,36`; `backend/routes/routes.workflow.ts:45,70,108`; `manifest.ts:244-251`; `packages/contracts/src/crm.ts:654` |
| `contracts/admin-surfaces.md` §3, §4, §7 | palette rationale; `requires`; key prefixes | `manifest.ts:191`; top-level key prefixes of `packages/modules/crm/i18n/en.json` |
| `plan.md` | four palette actions; seven child tables; one composition file; second migration; no `demo/` | `backend/` directory listing; `migrations/` listing; N-6, N-7 |
| `tasks.md` (prose only) | the migration sentence; a note on T161; a note on `compose/*.ts` | as above |
| this file | "Superseded by" pointers inside N-B8, N-B12, N-B13, N-D8, N-H2, N-H6 | the notes they point at |

**Traceability of the two added requirements** (the table in `tasks.md` is not edited here):
FR-079 — `backend/test/integration/crm/review-extensions.test.ts`,
`backend/test/contract/crm/links-and-transition.contract.test.ts` (the `orders:read` cases),
`admin/test/modules/crm/owner-permissions.test.tsx`,
`backend/test/contract/crm/attachments.contract.test.ts` (the `assets.read` gate);
FR-080 — `backend/test/integration/crm/attachment-upload.test.ts` (the active-content cases
and the size limit), `backend/test/contract/crm/attachment-upload.contract.test.ts`.

**Where the audit's leads did not hold when checked**, so that nobody repeats them:

- *"Constitution XVI asks that the module be reachable"* understates it. The principle also
  **forbids** enumerating every route, so FR-071 as first written could not have been met
  without violating it; the amendment is a correction of the requirement, not a concession.
- *"T023, T050, T062, T117, T169 name five `compose/*.ts` files."* About twenty task lines
  do, one or more in almost every story (`grep -n 'compose/' tasks.md`).
- *"Events emitted … match §1."* One sentence of §1.2 did not: `document_linked` is not
  always a Command's own event — for an automatic creation it is emitted by the service
  after the creating Command commits. Corrected there.
- *"Add `AGENTS.md` / `.specify/feature.json` to §D or drop them from the PR."* Precedent on
  `master` is that both travel with the feature; they are rows of §D2 and stay.
- *The spec's status "off `Draft`"* has no "Implemented" value to move to in this
  repository; `Accepted — …` is what an implemented spec carries here.
- *"[unverified] which module owns `permissionService` and `adminTenantScopePort`"* —
  `admin_roles` and `organizations`. The first is worth knowing: CRM's manifest names no
  `admin_roles` edge, and the check is green because that module is in the dependency
  closure through `admin_users`.
