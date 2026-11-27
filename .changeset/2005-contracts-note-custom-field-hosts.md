---
'@endora-commerce/contracts': minor
---

**Breaking change** (issue #2005, per the owner ruling on #1983 that a new required member on a published type is recorded as breaking): `OpportunityComment`, `ProjectComment`, `OpportunityNoteRecord` and `ProjectNoteRecord` gain a new **required** member, `customFieldValues: Record<string, unknown>`, and `SupportedEntityType` gains two members.

**Notes as custom-field hosts.** `supportedEntityTypeSchema` and `CUSTOM_FIELD_HOST_BINDINGS` gain `opportunity_note` (table `crm_opportunity_comments`, owner `crm`, entity `CrmOpportunityComment`, port `opportunityCommandPort`) and `project_note` (table `project_comments`, owner `projects`, entity `ProjectComment`, port `projectCommandPort`). Being hosts, both are side-table hosts too (`crm.CrmOpportunityComment`, `projects.ProjectComment`). A note's aggregate port is its parent's: the values are written with the note, through `addComment`.

- `CreateOpportunityCommentRequestSchema`, `UpdateOpportunityCommentRequestSchema`, `CreateProjectCommentBodySchema` and `UpdateProjectCommentBodySchema` accept an optional `customFieldValues` bag. On a create it is validated with the administrator's rules, `required` included, also when absent; on an edit it is merged key by key. A message with a non-empty bag is refused `422 VALIDATION_FAILED`.
- `OpportunityCommentSchema` and `ProjectCommentSchema` answer `customFieldValues` (`{}` on a message); `OpportunityReadPort.listNotes` and `ProjectReadPort.listNotes` answer it on each note record.

**Upgrading to 0.113.0:** code that only reads these types needs no change. Code that constructs an `OpportunityComment`, `ProjectComment`, `OpportunityNoteRecord` or `ProjectNoteRecord` of its own (a test double, a fake read port) fails to type-check until each object gains `customFieldValues` (`{}` will do). Code holding an exhaustive `Record<SupportedEntityType, …>` or a `switch` over it must add `opportunity_note` and `project_note`.
