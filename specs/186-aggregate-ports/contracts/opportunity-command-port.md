# Contract: `opportunityCommandPort` (Opportunity, #1827)

Owner `crm` (**deactivatable**). Declared in `packages/contracts/src/crm.ts`.

## Inventory (T008, issue #1827, 2026-11-26)

Measured on `origin/master` `d936722d5`. **Every operation is a Command already** — `crm` has 33
`commandBus.run` sites and no hand-written audit — so nothing converts (R-2's row stands). The
Commands are not factories under `src/backend/commands/`: each is built inline by the service method
its route calls, and that method also does everything the route does around the write. The port
therefore calls **the same service method** the route calls, with the caller's `source` and
`extensions` added by `withCallerOptions` (research R-21.1).

| Method | Command action (kept) | Admin route (`/api/v1/admin/crm/opportunities…`) | Service method (route and port) | Readiness | Side effects outside the write (on both paths) |
| --- | --- | --- | --- | --- | --- |
| `create(input, options?)` | `crm.opportunity.create` | `POST` (`crm:write`) | `OpportunityService.create` | C | `crm.opportunity.created.v1` on commit; assignee notice and mention notices after commit; the route alone adds the `ETag` and the detail read |
| `update(id, patch, options?)` | `crm.opportunity.update` | `PATCH /:id` (`crm:write`, `If-Match`) | `OpportunityService.update` | C | `crm.opportunity.assigned.v1` when the assignee changes; assignee and mention notices; value recalculation when the mode becomes `computed` |
| `setCustomFieldValues(id, merge, options?)` | `crm.opportunity.update`, values only | none of its own — `PATCH /:id` with `customFieldValues` alone records the same entry | `OpportunityService.setCustomFieldValues` (**new**: the update Command with the caller's merge run under the row lock) | C | none |
| `assign(id, { adminUserId }, options?)` | `crm.opportunity.assign` | `POST /:id/assign` (`crm:write`) | `OpportunityAssignmentService.assign` | C | `crm.opportunity.assigned.v1`; the assignee's notice; the same assignee writes nothing |
| `transition(id, { to, reason }, options?)` → `OpportunityTransitionOutcome` | `crm.opportunity.transition` | `POST /:id/transition` (`crm:write`) | `OpportunityTransitionService.apply` | C | guards, the two `.before` events, linked Orders asked to follow after commit, the `.after` events, `crm.opportunity.status_changed.v1` / `.closed.v1`; the route alone re-reads the detail with the propagation outcomes |
| `setTags(id, { tagIds }, options?)` | `crm.opportunity.tag_set` | `PUT /:id/tags` (`crm:write`) | `OpportunityService.setTags` | C | none; the same set writes nothing |
| `link(id, input, options?)` → `OpportunityLink` | `crm.opportunity.link_add` | `POST /:id/links` (`crm:write`, `orders:read` for an Order) | `OpportunityLinkService.add` | C | `crm.opportunity.document_linked.v1`; value recalculation after commit |
| `unlink(id, linkId, options?)` | `crm.opportunity.link_remove` | `DELETE /:id/links/:linkId` (`crm:write`) | `OpportunityLinkService.remove` | C | value recalculation after commit |
| `addComment(id, input, options?)` → `OpportunityComment` | `crm.opportunity.note_add` / `crm.opportunity.message_add` (by `kind`) | `POST /:id/comments` (`crm:write`) | `OpportunityCommentService.add` | C | mention notices; a message's participants told |
| `delete(id, options?)` | `crm.opportunity.delete` | `DELETE /:id` (`crm:configure`) | `OpportunityService.delete` | C | none (children cascade) |

**Findings that shaped the interface** (each proposed in research R-21):

1. **The Commands live in the services** (R-21.1): the port calls the route's service method rather
   than a factory under `commands/`; extracting ten factories would move code without changing what
   either path runs.
2. **The transition actor and cause** (R-21.2): the deprecated port's input `actor` is no longer read;
   the cause is `manual` under an administrator and `system` under none, as that port derived it.
3. **A note has an author** (R-21.3): `crm_opportunity_comments.author_admin_user_id` is required, so
   `addComment` under a bare system scope is refused `403 FORBIDDEN`, as the route refuses a request
   with no administrator; a worker writes one acting for an administrator.
4. **`OpportunityRecord.customFieldValues` is optional on the type** (R-21.4), always filled.
5. **Extension keys are refused before anything is read** (R-21.5): no `crm` action is hookable, and a
   transition's guards and `.before` events run before its Command.
6. **`source` meets the create entry's own `source`** (R-21.7): the create's `stateAfter.source` is the
   Opportunity's origin; the caller's code replaces it there, and the Change history tab drops the
   caller's code from every other entry.
7. **`expectedVersion`**: honoured by `update` (the route's `If-Match`, `409 VERSION_CONFLICT`); every
   other route has no version rule, so the option is ignored there (R-5, R-16.6).
8. **`transition`'s input** follows the published transition port, not the route's body schema: `to`
   is any string and an unknown one is the `unknown_status` outcome (FR-008); `reason` is not
   length-checked by the port, as the published port did not check it (R-21.8).

## Interface (shape)

As declared (`packages/contracts/src/crm.ts`):

```ts
export interface OpportunityCommandPort {
  create(input: CreateOpportunityRequest, options?: AggregateCommandOptions): Promise<OpportunityRecord>;
  update(id: string, patch: UpdateOpportunityRequest, options?: AggregateCommandOptions): Promise<OpportunityRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<OpportunityRecord>;
  assign(id: string, input: { adminUserId: string | null }, options?: AggregateCommandOptions): Promise<OpportunityRecord>;
  transition(id: string, input: OpportunityTransitionInput, options?: AggregateCommandOptions): Promise<OpportunityTransitionOutcome>;
  setTags(id: string, input: { tagIds: readonly string[] }, options?: AggregateCommandOptions): Promise<OpportunityRecord>;
  link(id: string, input: CreateOpportunityLinkRequest, options?: AggregateCommandOptions): Promise<OpportunityLink>;
  unlink(id: string, linkId: string, options?: AggregateCommandOptions): Promise<void>;
  addComment(id: string, input: CreateOpportunityCommentRequest, options?: AggregateCommandOptions): Promise<OpportunityComment>;
  delete(id: string, options?: AggregateCommandOptions): Promise<void>;
}
```

Input types are the admin routes' body contracts, parsed with the same schemas (a refusal is
`422 VALIDATION_FAILED`). `transition` answers refusals as `OpportunityTransitionOutcome`, as
`opportunityTransitionPort` does (FR-008); a concurrent move (`409 CRM_TRANSITION_CONFLICT`) and the
module switched off are thrown.

**Not offered**: attachments (upload flow), events/reminders, propagation retry/dismiss, value
recalculation, a link's follow flag (`crm.opportunity.link_sync_set`) — sub-entities and maintenance;
additive later. Status, tag and mapping configuration.

## Owner off

Fails closed (503 `MODULE_DISABLED`). The guard registry `opportunityTransitionGuardRegistry` is
unaffected.

## Deprecated by this port

`opportunityTransitionPort.applyStatus` → `transition`. It delegates; no caller in this repository or
in `../paid-modules` (read 2026-11-26).

## Tests

`backend/test/contract/crm/opportunity-command-port.test.ts` (parity per method, the guard veto and
the other refusals as outcomes, `source`, extension and `source` refusals before anything is read,
`expectedVersion`, the comment with no administrator, delegation of the deprecated port, off state),
`backend/test/integration/crm/opportunity-command-port.worker.test.ts` (the lifecycle from a worker
with the `system` actor and a `source`), `packages/contracts/src/crm.command-port.test.ts` (the
published shape), `packages/modules/crm/src/admin/lib/history-fields.test.ts` (R-21.7).
