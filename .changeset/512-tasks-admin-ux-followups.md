---
"@endora-commerce/mod-tasks": patch
---

Tasks admin UX follow-ups:

- The filter bar always shows search, status, assignees and the due range. The other filters sit behind *More filters*, which shows how many of them are in use while it is closed.
- The Tasks list pages with the kit's `CursorPagination`. The rows-per-page choice goes up to 100 and is remembered for each admin, so the default page is now the kit's 20 instead of 50.
- Task links and *Add task* on a record's Tasks panel carry `?returnTo=`. *Back* on the task screen and the create screen, and the screen shown after deleting a task, lead back to that record.
- *Configure card* scrolls to the board-card section once the workflow screen has loaded.
- On the create form, the *Private* switch comes before the assignees and says whom it removed. *Remove from the record* asks first, because it changes who can see the task.
- A refused submit focuses the first invalid field: on the create form, the edit form, and the status, priority and tag dialogs.
- *Make sub-task of…* sits on the *Sub-task of* line. *Create task* and *Save as draft* each show busy only when they are the one pressed. The board-card editor asks before you leave it with unsaved changes. The digest control's load error offers *Retry*.
- Polish copy calls the workflow "przebieg zadań" throughout, and the list's assignee column and filter are plural.

The i18n keys `list.previous` and `list.next` are removed.
