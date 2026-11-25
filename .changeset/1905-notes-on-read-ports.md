---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-projects': minor
---

`OpportunityReadPort` and `ProjectReadPort` gain `listNotes(query)` (issue #1905), so a module can list the notes of many opportunities and projects — for a cross-record notes list or an export — without reading another module's tables. The query takes an optional `organizationId`, `authorAdminUserId`, `createdFrom` (included) and `createdBefore` (excluded), a `cursor` and a `limit` of at most `OPPORTUNITY_READ_PORT_NOTES_MAX` / `PROJECT_READ_PORT_NOTES_MAX` (100). The answer is `{ items, nextCursor }`, oldest first; pass `nextCursor` back as `cursor` for the next page, and it is `null` on the last. Each item is an `OpportunityNoteRecord` (`id`, `opportunityId`, `organizationId`, `author { id, name }`, `body`, `createdAt`, `editedAt`) or a `ProjectNoteRecord` (the same with `projectId` and the Project's `organizationIds`). Only notes are listed, never messages or deleted notes, and only under the caller's reach, as for every other method of each port; the notes of an organization's projects are those of every project linked to it. A cursor the port did not issue, or an invalid `Date`, is refused with 422 `VALIDATION_FAILED`. Adding a method is compatible for a caller; a test double typed as either port must now implement it.
