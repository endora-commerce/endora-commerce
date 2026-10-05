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
| M1 | "`@dnd-kit` is already in the stack" | **It is not installed.** No `package.json` in the workspace names it, and `packages/admin-kit/src/components/reorder/useReorderList.ts` says so in its header: drag-reorder there is native HTML5 drag-and-drop, "the in-repo idiom". `AGENTS.md` § Stack is stale on this point. **[verified]** |
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
feature 093 has landed a key/params variant since; T076 checks before writing the call.

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
restrict`. **[unverified]** the exact descriptor shape — T058 reads
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
how an admin fetches a private one — T084 reads `assets-api.ts` and the returns flow, and the
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

**Alternatives rejected.** *Binding `quote_requests`* — see above; it is one line to change if
the owner prefers it (open question Q1). *`acknowledgedDependencies`* — exists to break
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

## R-20. Board view

**Decision.** A new CRM admin page built with **native HTML5 drag-and-drop**, the idiom
`useReorderList.ts` already uses, plus a per-card **"Move to…" menu** listing exactly the
transitions the graph permits. Both call the one transition endpoint. No new runtime
dependency (M1).

**Rationale.** WCAG 2.2 SC 2.5.7 (Dragging Movements) requires a non-drag alternative anyway
(`.claude/skills/ux-laws/SKILL.md` sets WCAG 2.2 AA as the floor), so the menu is not
optional; once it exists, a drag library buys animation and touch polish only.

**UX justification for a net-new component (Principle IX).** No board / column / card-lane
primitive exists in `@endora-commerce/admin-kit`; `ResponsiveTable` and the reorder list model
one ordered list, not N lists with moves between them. The board is written as
`OpportunityBoard` inside the module and is a candidate for promotion to admin-kit if a second
consumer appears.

**Alternatives rejected.** *Adding `@dnd-kit/core` + `@dnd-kit/sortable`* — a new runtime
dependency in a peer set the generator derives for every consumer; justified only if native
drag proves inadequate on touch devices, which the designer agent should judge on a device
(open question Q3). *A table grouped by status* — not a board.

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
| `custom_fields` (Principle XIV) | **Later** | `supportedEntityTypeSchema` (`packages/contracts/src/custom-fields.ts`) is a closed enum in contracts; adding `opportunity` would show the type in the custom-fields admin even while CRM is off (a Principle XVII leak) until that enum becomes manifest-contributed. Nothing in this design blocks it: one JSONB column and one validation call. |
| `import_export` | **Later** | Opportunities are created by people and by events; a bulk import has no asking user yet. |
| `webhooks` | **Later** | CRM emits versioned events (`crm.opportunity.created.v1`, `.status_changed.v1`, `.closed.v1`) from day one, so exposing them outbound is the webhooks module's catalogue entry, not a CRM change. **[unverified]** how that catalogue is populated. |
| `transactional_emails` | **Not** | Messages and assignment use the admin bell (R-11); nothing here addresses a customer. |
| `search` (Meilisearch) | **Not** | The list filters in Postgres on indexed columns at this volume; an index is a second copy to keep tenant-scoped. |
| `prompt_actions` | **Later** | Assistant tools ("move opportunity X to won") are a `contributes-to` push into `promptActionToolRegistry` once the transition port exists (User Story 14 publishes it). |
| `admin_actions` (palette) | **Now** | Two manifest `actions` (R-23). |
| `audit_logs` | **Now** | Commands + reference resolver (R-16). |
| `assets_library` | **Now** | R-15. |
| `admin_notifications` | **Now**, degrading | R-11. |
| `organizations` admin screen | **Now** | A panel in the existing `organization.detail.after` zone (User Story 14) — no change to `organizations`. |
| `orders` admin screen | **Later** | Showing "linked Opportunity" on the Order detail needs a zone that does not exist (`order.detail.payment` is the payment tab only); adding one is a change to `orders` and `AdminZoneNameSchema` nobody asked for. |

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

---

## Open questions for the owner

Each has the recommended default already applied in the artifacts; none blocks implementation.

| # | Question | Default applied | If the owner chooses otherwise |
| --- | --- | --- | --- |
| **Q1** | Should switching the Quote Requests module off be *refused* while CRM is on (a hard dependency, as the brief's dependency list reads), or allowed with CRM degrading? | **Allowed; CRM degrades** (R-17). | Move `quote_requests` from `nonBindingDependencies` to `dependencies` and delete the presence checks — task T096 is the only one that changes shape. |
| **Q2** | When an Order refuses the mapped status, should the Opportunity's own transition still stand? | **Yes — it stands, the refusal is shown and retryable** (R-4). | All-or-nothing needs a "would this apply?" method on `orderTransitionPort`, i.e. a change to `orders`, and still cannot be atomic. |
| **Q3** | Is native drag-and-drop acceptable for the board, or should `@dnd-kit` be added for touch devices? | **Native + a "Move to…" menu, no new dependency** (R-20). | Add the dependency with a Complexity Tracking entry in `plan.md`; only `OpportunityBoard.tsx` changes. |
