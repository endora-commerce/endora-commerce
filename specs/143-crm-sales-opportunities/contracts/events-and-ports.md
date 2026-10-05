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

### 1.2 Lifecycle

| Event | Payload beyond `EventBase` |
| --- | --- |
| `crm.opportunity.created.v1` | `opportunityId`, `organizationId`, `number`, `source` |
| `crm.opportunity.closed.v1` | `opportunityId`, `organizationId`, `outcome` (`won|lost`), `value`, `currency` |
| `crm.opportunity.assigned.v1` | `opportunityId`, `organizationId`, `assignedAdminUserId | null`, `previousAdminUserId | null` |
| `crm.opportunity.document_linked.v1` | `opportunityId`, `organizationId`, `documentKind`, `documentId`, `linkSource` |

`created`, `assigned` and `document_linked` are declared through their Command's
`event(result)`, so each is dispatched exactly once per committed Command and never for a
rolled-back one (Principle XIII). `closed` accompanies a status change and is emitted by the
transition service after commit, beside the status events of §1.1.

## 2. Events CRM consumes

All registered with `ctx.subscribe` in `packages/modules/crm/src/backend/index.ts` (never
`eventBus.on` — `check:subscribe-seam`), so none runs while CRM is off. Each handler does its
work inside `enterSystemScope('crm: <what>', …)` and constrains by `organizationId` itself.

| Event (owner) | Handler | Story |
| --- | --- | --- |
| `order.status_changed.v1` (`orders`) | echo suppression, reverse mapping, value recalculation | US2, US8 |
| `order.created.v1` (`orders`) | link by `origin`; link by quote conversion; automatic creation | US8, US9, US10 |
| `rfq.created.v1` (`quote_requests`) | automatic creation | US9 |
| `rfq.created_by_admin.v1` (`quote_requests`, **new** — see `foreign-module-changes.md`) | link by `origin`; automatic creation | US9, US10 |
| `rfq.approved.v1`, `rfq.canceled.v1`, `rfq.modified.v1`, `rfq.expired.v1` (`quote_requests`) | value recalculation | US8 |

Handlers are idempotent: linking is guarded by the unique `(document_kind, document_id)`
constraint, recalculation is a pure function of current state, and the reverse mapping is a
no-op when the Opportunity is already at its target.

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

| Port (owner) | Used for | Edge |
| --- | --- | --- |
| `orderReadPort` (`orders`) | validate and render linked Orders; value | `dependencies` |
| `orderTransitionPort` (`orders`) | forward propagation | `dependencies` |
| `organizationDetailsPort`, `salesRepAssignmentPort` (`organizations`) | validate the Organization; default assignee | `dependencies` |
| `customerAccountReadPort` (`customer_accounts`) | validate and render the contact person | `dependencies` |
| `adminUserReadPort` (`admin_users`) | assignee validation, author and actor names | `dependencies` |
| `catalogProductReadPort` (`catalog`) | reference labels | `dependencies` |
| `settingsReadPort` (`settings`) | the two automatic-creation settings | `dependencies` |
| `requireAdmin` (`auth`) | every route | `dependencies` |
| `assetReferenceRegistry` (`assets_library`) | deletion protection | `dependencies` (also read for attachment metadata — **[unverified]** which read port; T080) |
| `salesChannelAttributionRegistry` (`sales_channels`) | channel-delete guard | `dependencies` |
| `auditReferenceRegistry` (`audit_logs`) | recent-activity labels | `contributes-to` |
| `adminNotificationRecordPort` (`admin_notifications`) | assignment and message notifications | `degrades-without` |
| `quoteRequestReadPort` (`quote_requests`) | linked Quote Requests; value | `degrades-without` |

`whenAbsent` sentences (rendered to the operator switching the owner off):

- `admin_notifications` — "CRM stops notifying people about assignments and messages;
  everything else in CRM keeps working."
- `quote_requests` — "Quote Requests linked to Opportunities show as unavailable, stop
  counting toward computed Opportunity values, and can no longer be linked or created from an
  Opportunity. Opportunities and their Orders keep working."

The kernel's `AuditPort` (cradle name `auditLogService`) and `CommandBus` are platform
services, not module ports, and need no manifest edge.

Two more edges since the second ruling of 2026-10-05:

| Port (owner) | Used for | Edge |
| --- | --- | --- |
| `customFieldValueService` (`custom_fields`, type `CustomFieldValuePort`) | validate and project an Opportunity's custom values | `dependencies` — the owner is non-deactivatable, so there is no off state to degrade into |
| `webhookEventRegistry` (`webhooks`, **new** — §6) | offer CRM's events for outbound delivery | `contributes-to` — a push at boot; nothing degrades, so no `whenAbsent` |

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
