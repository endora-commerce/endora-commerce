---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-dictionaries': patch
---

The admin dictionary screens put their *Add* in one place, the page header (issue #1562, UX audit WORK-13).

- **Tasks › Tags** and **Tasks › Priorities**: *Add tag* / *Add priority* is the filled button in the page header instead of an outline button in a card header, and the card title that repeated the page title ("Tags", "Priorities") is gone. The count column now reads "Tasks (visible to you)", as does the workflow screen's status count, because the server counts only the Tasks the operator can see. A row's delete button is drawn in the destructive tone.
- **CRM › Tags**: the empty list shows the admin's empty state (icon, title, one line, *Add tag*), and the header's *Add tag* is hidden while the list is empty, so the screen has one primary action. The count column reads "Opportunities (visible to you)".
- **Projects › Roles** and **Loss reasons**: the same empty state with its *Add* replaces the bare "Nothing to show.", and the header's *Add* is hidden while the dictionary is empty.
- **Dictionaries** (Countries, Currencies, Languages): the active tab's *Add country* / *Add currency* / *Add language* moves from the tab's card into the page header, opens the editor and moves focus to its code field. The card no longer repeats the tab's name above the table; the table is named by it. The empty state carries the *Add* while a dictionary is empty. A row's *Edit*, *Set default* and red *Delete* buttons become one row menu, "Actions for PL", with *Delete* last; on the default row *Delete* and *Set default* are disabled and *Delete* says why.

The i18n keys `tags.list.title` and `priorities.list.title` (tasks) and `dictionary.empty` (projects) are removed. The CRM `tags.empty` is now a short title, with the sentence moved to the new `tags.emptyBody`. The API is unchanged.
