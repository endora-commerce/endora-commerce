# Contract: CRM events, ports and the transition-hook seam

**Feature**: `specs/143-crm-sales-opportunities/` · normative for
`packages/contracts/src/crm.ts` and `packages/modules/crm/src/backend/index.ts`.

Everything another module may use to cooperate with CRM is on this page. Nothing else is
public: no entity class, no service class and no file under `packages/modules/crm/` may be
named by another module (`check:module-boundary`).

## 1. Events CRM emits (in-process `EventBus`)

Every payload extends `EventBase` (`eventId`, `occurredAt`). Payload types are exported from
`@endora-commerce/contracts`.

### 1.1 Status change — the transition hooks (FR-015)

For a transition `x → y` (status codes), in this order:

| # | Event name | When | Can it refuse? |
| --- | --- | --- | --- |
| 1 | *guards* (§3) | before any write | **yes** |
| 2 | `crm.opportunity.status.from_<x>_to_<y>.before` | before the write, after the guards passed | no — passive |
| 3 | `crm.opportunity.status.from_<x>.before` | same | no |
| 4 | — the write commits — | | |
| 5 | — Order propagation runs (research R-4) — | | |
| 6 | `crm.opportunity.status_changed.v1` | after commit | no |
| 7 | `crm.opportunity.status.from_<x>_to_<y>.after` | after commit | no |
| 8 | `crm.opportunity.status.to_<y>.after` | after commit | no |
| 9 | `crm.opportunity.closed.v1` (§1.2) | after commit, only when `y` is a `won` or `lost` status | no |

Payload `OpportunityStatusEvent`: `opportunityId`, `organizationId`, `salesChannelId | null`,
`from`, `to`, `fromKind`, `toKind` (`open | won | lost`), `actor` (`{ kind: 'admin' |
'system', adminUserId? }`), `cause` (`manual | order_status | system`), `causeOrderId?`,
`reason | null`. The coarse `…status_changed.v1` additionally carries `number`.

Names are built by `opportunityStatusEventName(kind, { from, to })`, exported from
`@endora-commerce/contracts` — the one place the scheme is written. Status codes are
`^[a-z][a-z0-9_]*$`, so a name never needs escaping.

Subscribing (any module, any overlay): `ctx.subscribe(opportunityStatusEventName('toAfter',
{ to: 'won' }), handler)`. Handler errors are isolated by the bus and never undo the
transition.

**Order matters at 5 → 6**: after-events are emitted once propagation has been attempted, so a
subscriber that reads the linked Orders sees their new statuses — the ordering
`OrderTransitionService` keeps between its follow-ups and its announcement.

**Rows 6–9 are delivered inside one `EventBus.run`** (as built — research N-E19;
`services/opportunity-transition-service.ts`, step 5). The bus holds them back and dispatches
them one after another, each to all of its subscribers before the next, so the order above is
the order every subscriber sees, whoever else subscribes — emitted bare, each event starts a
dispatch chain of its own and an awaiting subscriber of row 6 would receive it after rows 7
and 8. Two consequences a caller meets: **the transition answers once its after-subscribers
have run**, and they are emitted in a `finally`, so they are announced even when asking the
Orders threw. A subscriber's failure is still isolated by the bus and neither undoes nor fails
the transition. Rows 2–3 are emitted bare: they are passive and nothing is promised about
them beyond "ahead of the write". *A coordinator decision, owner informed, reversible
(`spec.md` § Clarifications, D-5).*

### 1.2 Lifecycle

| Event | Payload beyond `EventBase` |
| --- | --- |
| `crm.opportunity.created.v1` | `opportunityId`, `number`, `organizationId`, `source` (`manual \| order \| quote_request`) |
| `crm.opportunity.closed.v1` | `opportunityId`, `organizationId`, `outcome` (`won \| lost`), `value \| null` (the effective value when it closed), `currency` |
| `crm.opportunity.assigned.v1` | `opportunityId`, `organizationId`, `assignedAdminUserId \| null`, `previousAdminUserId \| null` |
| `crm.opportunity.document_linked.v1` | `opportunityId`, `organizationId`, `documentKind` (`order \| quote_request`), `documentId`, `linkSource` (`manual \| auto \| created_from_opportunity \| quote_conversion`) |

The names are the members of `CRM_EVENTS` in `packages/contracts/src/crm.ts`; the payload
types are `OpportunityCreatedEvent`, `OpportunityClosedEvent`, `OpportunityAssignedEvent` and
`OpportunityDocumentLinkedEvent` there. `status_changed`, `created` and `closed` have strict
Zod schemas because they are offered to outbound webhooks (§6); `assigned` and
`document_linked` are in-process only and are plain interfaces.

`created`, `assigned` and `document_linked` are declared through their Command's
`event(result)`, so each is dispatched exactly once per committed Command and never for a
rolled-back one (Principle XIII). `closed` accompanies a status change and is emitted by the
transition service after commit, as row 9 of §1.1.

As built, three refinements:

- **`assigned` is not emitted on create.** A Command declares one event and the create
  Command declares `created`; `assigned` is emitted by `POST …/assign` and by a `PATCH` that
  changes the assignee, and not when the assignee named is the one already there (research
  N-B8).
- **`document_linked` for an automatically created Opportunity is emitted by the service,
  after the creating Command has committed** — that Command has already declared `created`
  (`services/opportunity-auto-create-service.ts`, `#announceLink`; `linkSource: 'auto'`). For
  a link written by hand, by `origin` or by quote conversion it is the link Command's own
  event.
- **No event is emitted for an unlink**, for a tag, a note, a message or an attachment, or
  for a value recalculation. A consumer that needs those reads the Opportunity.

## 2. Events CRM consumes

All registered with `ctx.subscribe` in `packages/modules/crm/src/backend/index.ts` (never
`eventBus.on` — `check:subscribe-seam`), so none runs while CRM is off. Each handler does its
work inside `enterSystemScope('crm: <what>', …)` and constrains by `organizationId` itself.

| Event (owner) | Handler | Story |
| --- | --- | --- |
| `order.status_changed.v1` (`orders`) | echo suppression and reverse mapping; value recalculation — **two** `ctx.subscribe` calls, run by the bus in registration order, so the value is recalculated after the Opportunity has moved (research N-E6) | US2, US8 |
| `order.created.v1` (`orders`) | link by `origin`; link by quote conversion; automatic creation | US8, US9, US10 |
| `rfq.created.v1` (`quote_requests`) | automatic creation | US9 |
| `rfq.created_by_admin.v1` (`quote_requests`, **new** — see `foreign-module-changes.md`) | link by `origin`; automatic creation | US9, US10 |
| `rfq.approved.v1`, `rfq.canceled.v1`, `rfq.modified.v1`, `rfq.expired.v1` (`quote_requests`) | value recalculation | US8 |

Handlers are idempotent: linking is guarded by the unique `(document_kind, document_id)`
constraint, recalculation is a pure function of current state, and the reverse mapping is a
no-op when the Opportunity is already at its target.

Payloads as consumed (as built):

- `order.created.v1` — `orderId`, `organizationId` and, new with this feature, an optional
  `origin: { type, id }` (`OriginReference`, `packages/contracts/src/common.ts`). It names
  **no actor**, which is why the origin link cannot ask whether the Order's creator holds
  `crm:write` (research N-J2; `spec.md` § Clarifications, D-9). `orders` emits it inside the
  placing transaction, so the handler re-reads the Order after its commit (research N-E7,
  N-E18).
- `rfq.created_by_admin.v1` — `RfqCreatedByAdminEventPayload` in
  `packages/contracts/src/quote-requests.ts`: `rfqId`, `organizationId`, `adminUserId`,
  `origin: OriginReference | null`. Emitted by `quote_requests`, once per Quote Request
  created through the admin path; the customer path stays `rfq.created.v1` and never this.
- The four value events carry `rfqId` only, so the handler finds the link by document.
- **Quote conversion** ("link by quote conversion" above) reads
  `OrderRecord.sourceQuoteRequestId`. `orders` writes it at placement since 2026-10-08, in
  the row the placing transaction commits, after reading the Quote Request back through
  `quoteRequestReadPort` — same Organization, still `Approved`, an agreed line still on the
  basket (`spec.md` FR-100 … FR-103; research N-QS1 … N-QS4). So the id is there on the
  handler's first successful read of the Order, the deferred one included, and CRM's own
  Organization check in `linkOrderPlacedFromQuoteRequest` is the second of two.
- A Quote Request reaching `Completed` announces nothing, so there is no handler for it
  (research N-E4 (f)).

## 3. The guard registry — refusing a transition

**Container name `opportunityTransitionGuardRegistry`. Owner `crm`. Type
`OpportunityTransitionGuardRegistryPort`** (in `packages/contracts/src/crm.ts`).

```ts
export interface OpportunityTransitionGuard {
  /** The contributing module — required; an absent owner's guard is skipped. */
  readonly ownerModuleId: string;
  /** Omit a field to match any status. `{}` matches every transition. */
  readonly match: { readonly from?: string; readonly to?: string };
  /** Throw OpportunityTransitionVetoError to refuse. Anything else thrown is a 500. */
  guard(event: OpportunityStatusEvent): void | Promise<void>;
}

export interface OpportunityTransitionGuardRegistryPort {
  register(guard: OpportunityTransitionGuard): void;
  /** Contributing modules, in registration order — for diagnostics and composition tests. */
  owners(): readonly string[];
}

export class OpportunityTransitionVetoError extends Error {
  constructor(message: string, readonly from: string, readonly to: string) { … }
}
```

- **A contribution seam**, like `auditReferenceRegistry`: registered with `ctx.di.register`
  (ungated, a plain singleton), because a contributor pushes from `ctx.onBoot` and a boot hook
  that resolved a gated port would stop the backend from starting whenever CRM is switched
  off.
- **Contributor's side**: push from a **contribution-only** `ctx.onBoot` hook (no presence
  probe — `module-activation.md`, the boot-hook split), and declare
  `nonBindingDependencies: [{ moduleId: 'crm', name: 'opportunityTransitionGuardRegistry',
  kind: 'contributes-to' }]`. An instance that never installed CRM drops the push
  (`contribution-sinks.ts`).
- **Enumeration policy**: at dispatch CRM skips a guard whose `ownerModuleId` is not
  effectively present. A switched-off module does not veto.
- A veto surfaces as 409 `CRM_TRANSITION_VETOED` whose `message` is the error's message — the
  guard author writes the sentence the Sales Rep reads.
- Guards run for **every** cause, including a transition requested by the reverse mapping; a
  veto there is recorded as a `skipped` propagation, not an HTTP error.

## 4. Ports CRM publishes (US14)

Registered with `ctx.di.providePort`, so a consumer resolving them through `lazyPort` gets 503
`MODULE_DISABLED` while CRM is off. A consumer declares `crm` in its manifest — `dependencies`
if it cannot work without CRM, otherwise `nonBindingDependencies` with a `whenAbsent`
sentence.

### `opportunityReadPort` — `OpportunityReadPort`

```ts
export interface OpportunityRecord {
  id: string; number: string; title: string;
  organizationId: string; customerAccountId: string | null; salesChannelId: string | null;
  statusCode: string; statusKind: 'open' | 'won' | 'lost';
  assignedAdminUserId: string | null;
  value: string | null; valueMode: 'manual' | 'computed'; currency: string;
  closedAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface OpportunityReadPort {
  findById(id: string): Promise<OpportunityRecord | null>;
  findByDocument(kind: 'order' | 'quote_request', documentId: string): Promise<OpportunityRecord | null>;
  listOpenForOrganization(organizationId: string): Promise<OpportunityRecord[]>;
}
```

Reads run under the **caller's** ambient tenant context; no entity leaves.

### `opportunityTransitionPort` — `OpportunityTransitionPort`

```ts
export type OpportunityTransitionOutcome =
  | { applied: true; from: string; to: string }
  | { applied: false; reason: 'already_there'; from: string }
  | { applied: false; reason: 'not_found' | 'unknown_status' | 'not_permitted' | 'vetoed';
      from: string | null; detail: string };

export interface OpportunityTransitionPort {
  applyStatus(input: {
    opportunityId: string; to: string;
    actor: { kind: 'admin' | 'system'; adminUserId?: string };
    reason?: string | null;
  }): Promise<OpportunityTransitionOutcome>;
}
```

Deliberately the shape of `OrderTransitionPort` (`packages/contracts/src/orders.ts`): a
refusal is a value, the graph is consulted before `apply` so `not_permitted` and `vetoed` stay
distinguishable, and it must be called **after the caller's own commit** — it obtains its own
EntityManager.

## 5. Ports CRM consumes

Every one resolved with `lazyPort<T>(ctx, '<literal name>')`, `T` from
`@endora-commerce/contracts`, never captured in a singleton, never wrapped in a bare `catch`.

The table is the complete set as built: every `lazyPort<…>(ctx, '…')` in
`packages/modules/crm/src/backend/index.ts` (the one composition file — research N-6), with
the owner each name's `Container name:` marker or `providePort` call states, and the edge as
`packages/modules/crm/src/manifest.ts` declares it. `pnpm --filter backend run
check:port-dependencies` holds the two together.

| Port — container name (owner) | Type | Used for | Edge |
| --- | --- | --- | --- |
| `orderReadPort` (`orders`) | `OrderReadPort` | validate and render linked Orders; value; references; automatic creation | `dependencies` |
| `orderTransitionPort` (`orders`) | `OrderTransitionPort` | forward propagation | `dependencies` |
| `organizationDetailsPort` (`organizations`) | `OrganizationDetailsPort` | validate and name the Organization | `dependencies` |
| `organizationSalesRepScopePort` (`organizations`) | `SalesRepAssignmentPort` | the default assignee — the Sales Reps assigned to the Organization. **The container name is not the type's name** (research N-B5) | `dependencies` |
| `adminTenantScopePort` (`organizations`) | `AdminTenantScopePort` | whether an administrator *other than the caller* can reach an Organization: assignee validation, who is told by the bell, the creator's reach on the `origin` path (research N-R2, N-J2) | `dependencies` |
| `customerAccountReadPort` (`customer_accounts`) | `CustomerAccountReadPort` | validate and render the contact person | `dependencies` |
| `adminUserReadPort` (`admin_users`) | `AdminUserReadPort` | assignee validation, author and actor names, the acting administrator's language | `dependencies` |
| `permissionService` (`admin_roles`) | `PermissionReadPort` | whether the reader holds the *owner's* read code for a linked Order, a linked Quote Request or a referenced Product — `orders:read`, `rfqs:handle`, `catalog:read` (research N-R3, N-R13) | none of its own: `admin_roles` is in the dependency closure through `admin_users`, which is what the check asks for; both are non-deactivatable |
| `catalogProductReadPort` (`catalog`) | `CatalogProductReadPort` | reference labels | `dependencies` |
| `settingsReadPort` (`settings`) | `SettingsReadPort` | the two automatic-creation settings | `dependencies` |
| `assetReadPort` (`assets_library`) | `AssetReadPort` | an attachment's metadata (name, type, size) | `dependencies` |
| `assetsLibraryPort` (`assets_library`) | `AssetsLibraryPort` | `upload` for the CRM-owned upload; `getAsset` for a download link; `softDelete` for a file stored and then not attached (research N-F1) | `dependencies` |
| `assetReferenceRegistry` (`assets_library`) | `AssetReferenceRegistryPort` | deletion protection — a push from a contribution-only boot hook | `dependencies` |
| `salesChannelAttributionRegistry` (`sales_channels`) | `SalesChannelAttributionRegistryPort` | channel-delete guard — a push from a contribution-only boot hook | `dependencies` |
| `auditReferenceRegistry` (`audit_logs`) | `AuditReferenceRegistryPort` | recent-activity labels — a push from a contribution-only boot hook | **`dependencies`**, not `contributes-to` as this page first said: the check refuses a `contributes-to` edge into a registry whose absent-contributor policy is not on its ledger, and a binding edge to a non-deactivatable owner is what the registry's four other contributors declare (research N-G6) |
| `customFieldValueService` (`custom_fields`) | `CustomFieldValuePort` | validate and project an Opportunity's custom values | `dependencies` — the owner is non-deactivatable, so there is no off state to degrade into |
| `adminNotificationRecordPort` (`admin_notifications`) | `AdminNotificationRecordPort` | assignment and message notifications | `degrades-without` |
| `quoteRequestReadPort` (`quote_requests`) | `QuoteRequestReadPort` | linked Quote Requests; value; the Quote Request lookup | `degrades-without` |
| `webhookEventRegistry` (`webhooks`, **new** — §6) | `WebhookEventRegistryPort` | offer CRM's events for outbound delivery | `contributes-to` — a push at boot; nothing degrades, so no `whenAbsent` |

`requireAdmin` (`auth`, a `dependencies` entry) gates every route; it is read from the cradle
in each `ctx.routes` body rather than through `lazyPort`.

`whenAbsent` sentences (rendered to the operator switching the owner off), as the manifest
has them:

- `admin_notifications` — "CRM stops notifying people about assignments and messages;
  everything else in CRM keeps working"
- `quote_requests` — "Quote Requests linked to Opportunities show as unavailable, stop
  counting toward computed values, and can no longer be linked or created from one.
  Opportunities and their Orders keep working" (shortened from this page's first wording to
  fit the manifest schema's 200 characters — research N-E5).

Platform services read from the cradle, which are not module ports and need no manifest
edge: the kernel's `AuditPort` (cradle name `auditLogService`), `commandBus`, `eventBus`,
`emFactory`, `moduleQueueRedis` and `processRunsWorkers`. `effectiveState` and
`enterSystemScope` are imported from the platform's barrels.

## 5a. Ports the Event reminder consumes (US21) — *built 2026-10-08*

Three names join the table of §5, each resolved with `lazyPort` like the rest — **except
`transactionalEmailSenderAccessor`, which as built is read off the cradle per send**: it is
a function, and `lazyPort` forwards method calls only (`research.md` N-CAL15 (a)). The hard
edge on `transactional_emails` is recorded as an open point in `spec.md` § Clarifications,
OP-1. All three
owners declare themselves non-deactivatable, so each edge is a `dependencies` entry and
none can deaden an operator's switch (`auth` is one already).

| Port — container name (owner) | Type | Used for | Edge |
| --- | --- | --- | --- |
| `authSessionReadPort` (`auth`) | `AuthSessionReadPort` — **one method added**, `lastSeenByAdminUser(adminUserIds, since)` (`foreign-module-changes.md` §CAL-B) | is the recipient online: an admin session of theirs seen in the last five minutes | `dependencies` (present) |
| `transactionalEmailSenderAccessor` (`transactional_emails`) | `() => TransactionalEmailSender \| undefined` | sending `crm_event_reminder`; `undefined`, and every outcome other than `sent`, means "no e-mail went out" and costs nothing else | `dependencies` (**new**: `transactional_emails`) |
| `emailDefaultsPort` (`transactional_emails`) | `EmailDefaultsRegistryPort` | registering the default subject and body of `crm_event_reminder`, English and Polish, from a contribution-only `ctx.onBoot` — the ungated seam seven modules already push into | same edge |

`adminNotificationRecordPort` (already consumed, `degrades-without`) carries the bell entry
through the existing `crm-notifier.ts`, which gains one kind and two sentences;
`adminUserReadPort` (already consumed) gives the recipient's e-mail address, status and
`preferredLanguage`; `adminTenantScopePort` (already consumed, through `AdminReach`) says
whether the recipient may still see the Opportunity's Organization; and `permissionService`
(already consumed, by the mention service) says whether they still hold `crm:read` — the
three conditions a mention is held to, applied to a sentence that says more than a mention
does (review of 2026-10-08, research N-CALR1).

**The transactional e-mail** — declared in the manifest's `transactionalEmails`, like
`shipments`' `shipment_created`:

| | |
| --- | --- |
| `code` | `crm_event_reminder` |
| `name`, `group` | "Event reminder", `crm` |
| `variables` | `event.name`, `event.when` (as the bell's `when`), `opportunity.number`. **`opportunity.url` is not declared and the e-mail has no link** — T339 stopped (`spec.md` § Clarifications, EC-2; `foreign-module-changes.md` §CAL-C) |
| Sent with | `salesChannelId: null` (the platform-wide content — an administrator is not a channel's customer), `language` from the recipient's `preferredLanguage` (`pl` → `pl-PL`, anything else and `null` → `en-US`), `to` their address, `messageId: crm_event_reminder:<eventId>:<remindAt as epoch ms>`, `document: { type: 'crm_opportunity', id }` |
| Operator's control | the e-mail templates screen: editable per language, and deactivatable — a deactivated reminder e-mail is the `deactivated` outcome, and the bell entry is unaffected |

CRM emits **no new event** for Events: nothing subscribes to "an Event was added", and the
webhook contribution of §6 is unchanged.

## 6. Outbound webhooks (US16)

Three events are offered to the platform's webhooks capability. **The webhook payload is the
event payload**: the delivery bridge serialises the event whole. Each therefore has a strict,
versioned Zod schema in `packages/contracts/src/crm.ts`, and a test holds every emitted event
to it — adding a field is a reviewed change to a public contract; removing or renaming one is
a new `.v2` event offered beside the old.

| Event type | Schema | Fields beyond `eventId`, `occurredAt` |
| --- | --- | --- |
| `crm.opportunity.status_changed.v1` | `OpportunityStatusChangedEventV1Schema` | `opportunityId`, `number`, `organizationId`, `salesChannelId \| null`, `from`, `to`, `fromKind`, `toKind`, `actor { kind, adminUserId? }`, `cause`, `causeOrderId?`, `reason \| null` |
| `crm.opportunity.created.v1` | `OpportunityCreatedEventV1Schema` | `opportunityId`, `number`, `organizationId`, `source` |
| `crm.opportunity.closed.v1` | `OpportunityClosedEventV1Schema` | `opportunityId`, `organizationId`, `outcome` (`won \| lost`), `value \| null`, `currency` |

`reason` on a status change is the short text a user typed for that transition; no
description, note, message or title is in any payload. `organizationId` is always present,
which is what lets a subscription bound to one Organization receive only its own events.
Closed-won and closed-lost are one event with `outcome`, not two types.

The seam in `webhooks` (owner `webhooks`, container name `webhookEventRegistry`, type in
`packages/contracts/src/webhooks.ts`):

```ts
export interface WebhookEventDescriptor {
  /** The contributing module — an absent owner's event types are not offered. */
  readonly ownerModuleId: string;
  /** A versioned EventBus event name, e.g. `crm.opportunity.status_changed.v1`. */
  readonly eventType: string;
}
export interface WebhookEventRegistryPort {
  register(descriptor: WebhookEventDescriptor): void;
  owners(): readonly string[];
  /** Event types whose owner is effectively present. */
  list(): readonly WebhookEventDescriptor[];
}
```

A contribution seam: registered ungated, pushed to from a contribution-only boot hook,
bridged by `webhooks`' own gated subscription. `webhooks` names no contributor's event.
`GET /api/v1/admin/webhooks/event-types` serves `list()` to the subscription form.

| State | What an operator observes |
| --- | --- |
| both on | CRM's three events are offered; matching subscriptions receive them |
| `webhooks` off | Opportunities work unchanged; nothing is delivered; events emitted meanwhile are not delivered later |
| `crm` off | its events are not offered; existing subscriptions naming them stay stored and receive nothing |
