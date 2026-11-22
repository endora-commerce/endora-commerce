---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
---

Adds `InlineEdit` and `InlineEditTitle` to the admin kit's `./components`: the admin's one model for editing a record's facts where they are shown (issue #1453). Each fact has its own pencil, *Save* and *Cancel*, and sends only itself. `InlineEdit` takes a `group` option for an editor of several controls, which names itself through the new `labelId`. `MultiSelect` and `TagMultiSelect` take an optional `id` for the trigger. The copy is in `core`: `common.inlineEdit.edit`, `common.inlineEdit.saved` and `common.inlineEdit.error`.

CRM now uses the kit's component (its own copy is removed), and the Opportunity's assignee is edited the same way as the facts beside it, instead of through an always-open lookup. On a Task, the page-wide *Edit* form is replaced: the title, description, due date, start date, priority, tags and assignees are each edited in place. On a Project's *Overview*, the description, the start date and who sees the Project are edited in place. The start date could not be changed there before (issue #1525).
