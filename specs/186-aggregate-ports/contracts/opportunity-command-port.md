# Contract: `opportunityCommandPort` (Opportunity, #1827)

Owner `crm` (**deactivatable**). Declared in `packages/contracts/src/crm.ts`. Every operation is a
Command today (`crm`: 33 `commandBus.run` sites, no hand-written audit).

## Operations

| Method | Command action (kept) | Admin route (`/api/v1/admin/crm/opportunities…`) |
| --- | --- | --- |
| `create(input, options?)` | `crm.opportunity.create` | `POST` |
| `update(id, patch, options?)` | `crm.opportunity.update` | `PATCH /:id` |
| `setCustomFieldValues(id, merge, options?)` | `crm.opportunity.update` (values-only) — T008 confirms | `PATCH /:id` |
| `assign(id, { adminUserId }, options?)` | `crm.opportunity.assign` | `/:id/assign` |
| `transition(id, { to, reason }, options?)` → `OpportunityTransitionOutcome` | `crm.opportunity.transition` | `/:id/transition` |
| `setTags(id, { tagIds }, options?)` | `crm.opportunity.tag_set` | `/:id/tags` |
| `link(id, input, options?)` | `crm.opportunity.link_add` | `/:id/links` |
| `unlink(id, linkId, options?)` | `crm.opportunity.link_remove` | `/:id/links/:linkId` |
| `addComment(id, input, options?)` | `crm.opportunity.note_add` | `/:id/comments` |
| `delete(id, options?)` | `crm.opportunity.delete` | `DELETE /:id` |

`transition` answers refusals as `OpportunityTransitionOutcome`, as `opportunityTransitionPort` does
(FR-008); its actor becomes ambient and the old `actor` input's source becomes `options.source`.

**Not offered**: attachments (upload flow), events/reminders, propagation retry/dismiss, value
recalculation — sub-entities and maintenance; additive later. Status, tag and mapping configuration.

## Owner off

Fails closed (503 `MODULE_DISABLED`). The guard registry `opportunityTransitionGuardRegistry` is
unaffected.

## Deprecated by this port

`opportunityTransitionPort.applyStatus` → `transition`.

## Tests

`backend/test/contract/crm/opportunity-command-port.test.ts` (parity; guard veto outcome),
`backend/test/integration/crm/opportunity-command-port.worker.test.ts`, off-state test, delegation test.
