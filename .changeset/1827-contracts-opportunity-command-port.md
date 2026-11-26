---
'@endora-commerce/contracts': minor
---

New `OpportunityCommandPort` (issue #1827, container name `opportunityCommandPort`, owner `crm`): the Opportunity aggregate's write port for server-side code — `create`, `update`, `setCustomFieldValues`, `assign`, `transition`, `setTags`, `link`, `unlink`, `addComment` and `delete`. Each takes the matching admin route's body type (`CreateOpportunityRequest`, `UpdateOpportunityRequest`, `CreateOpportunityLinkRequest`, `CreateOpportunityCommentRequest`, …) and `AggregateCommandOptions` last; `transition` takes the new `OpportunityTransitionInput` and answers an `OpportunityTransitionOutcome`.

`OpportunityRecord` gains `customFieldValues?: Record<string, unknown>`, always filled by `crm` — optional on the type so a record your own test double builds keeps compiling.

**Deprecated:** `OpportunityTransitionPort.applyStatus` (since 0.113.0, removed in 0.114.0). Replace

```ts
await lazyPort<OpportunityTransitionPort>(ctx, 'opportunityTransitionPort').applyStatus({ opportunityId, to, actor, reason });
```

with

```ts
await lazyPort<OpportunityCommandPort>(ctx, 'opportunityCommandPort').transition(opportunityId, { to, reason }, { source: 'your-module' });
```

The outcome is the same; the actor is the ambient one instead of the `actor` you passed.
