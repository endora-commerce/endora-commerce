---
'@endora-commerce/mod-crm': minor
---

**Custom fields on Opportunity notes** (issue #2005). A note is the `opportunity_note` custom-field host: a new migration adds `crm_opportunity_comments.custom_field_values` (`jsonb not null default '{}'`). `POST /api/v1/admin/crm/opportunities/:id/comments` and `PATCH …/comments/:commentId` take `customFieldValues`, validated with the administrator's rules (`422 CUSTOM_FIELD_VALUE_INVALID`), written by `crm.opportunity.note_add` / `.note_update`, whose audit entries name the changed keys (`changedCustomFields`) and never a value. A message with a non-empty bag is refused `422 VALIDATION_FAILED`. The comment list, `opportunityCommandPort.addComment` and `opportunityReadPort.listNotes` carry the values; both writes are declared in `customFieldWrites`. In the Admin UI the *Notes* tab offers the fields in the composer and in a note's edit form, and shows each note's values, to a holder of `custom_fields:read`.
