# Contract: events and webhooks

## 1. Domain events (EventBus, dispatched on commit of the finalize Command)

```ts
// packages/contracts/src/organizations.ts
export const ORGANIZATION_EVENTS = { …, MERGED: 'organization.merged.v1' } as const;
export interface OrganizationMergedEventV1 {
  organizationId: string;          // the survivor: the tenant key the webhook bridge reads
  mergedOrganizationId: string;    // the archived loser
  mergeId: string;
  mergedAt: string;                // ISO instant
  source: string | null;           // D-293.6 source of the start, if any
}

// packages/contracts/src/projects.ts
export const PROJECT_EVENTS = { …, MERGED: 'project.merged.v1' } as const;
export interface ProjectMergedEventV1 {
  projectId: string; mergedProjectId: string; mergeId: string; mergedAt: string; source: string | null;
  organizationIds: readonly string[];   // the survivor's Organizations after the merge
}
```

The rules for these events:

- **Ids only.** No names, tax IDs or values.
- **Exactly once per merge.** It is dispatched by the finalize Command, so a resumed merge whose
  finalize already committed does not re-dispatch it. Trailing and deferred steps that finish later
  emit nothing.
- **No per-record events from participant batches** (R-13). 191's
  `customer_account.organization_changed.v1` is still emitted per account, with `mode: 'merge'`,
  because it is that Command's own event.
- `organization.merge.start` is a hookable action (176). Its `afterCommit` outbox data is
  `{ mergeId, survivorId, loserId, source }`, which deployments use to start their own work early.

## 2. Webhooks

- `ORGANIZATION_WEBHOOK_EVENT_TYPES = ['organization.merged.v1']` is the first Organization webhook
  type, registered in the webhooks event registry beside the existing per-module lists.
- `project.merged.v1` is added to the projects webhook list. If `projects` exposes none today, a
  `PROJECT_WEBHOOK_EVENT_TYPES` list is introduced the same way.
- **Delivery.**
  - Platform-wide subscriptions receive it.
  - Organization-bound subscriptions receive it when bound to the survivor (bridge rule
    `subscriptionReceivesOrganization`, `packages/modules/webhooks/src/backend/services/event-bridge.ts`).
  - Subscriptions bound to the loser were re-pointed by the `webhooks` participant before finalize,
    so they receive it too.
- **Payload.** The event payload above, unchanged.
- `bridged-equals-offered.test.ts` and `webhook-event-registry.test.ts` gain the new types.

**As implemented (MR-G).** The Project event lives in `packages/contracts/src/projects.merge.ts`
as `PROJECT_MERGE_EVENTS.MERGED` with `ProjectMergedEventV1`
(`{ eventId, occurredAt, projectId, mergedProjectId, mergeId, mergedAt, source, organizationIds }`),
beside `PROJECT_WEBHOOK_EVENT_TYPES = ['project.merged.v1']`, which `projects` registers from a
contribution-only boot hook. A Project belongs to no single Organization, so its payload carries no
`organizationId`: the bridge delivers it to **platform-wide** subscriptions only, never to an
Organization-bound one.

## 3. Admin notifications

On `needs_attention`, holders of `organizations:merge` (or `projects:merge`) who reach the pair
are notified through `admin_notifications` (a non-binding dependency, which degrades to nothing
when off), with a link to the progress view. On completion, the starting administrator is
notified.

As implemented (MR-F): the platform cannot name `admin_notifications`, so the runner calls the
host's optional `MergeHostImplementation.onStateChanged({ mergeId, hostType, survivorId, loserId,
state })` after it committed and announced `needs_attention` or `completed`; a throw is logged and
changes nothing. The host decides whom to tell. `organizations` asks for the bell's presence
first, de-duplicates a stop announced twice by two failing steps, and records `admin_user`
entries of kind `organization.merge.needs_attention` / `organization.merge.completed`
(`packages/modules/organizations/src/backend/merge/organization-merge-notifier.ts`). A merge
started by server code notifies nobody on completion.
