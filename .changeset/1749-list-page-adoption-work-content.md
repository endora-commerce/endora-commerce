---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-transactional-emails': patch
---

Fifteen work and content list screens now use the kit `ListPage` (issue #1749). They are the Opportunities list and the CRM tags; Projects, Project templates, Project roles and loss reasons; Tasks, My tasks, Task priorities and Task tags; the newsletter's campaigns, automations, subscribers and e-mail blocks; and the transactional e-mail templates and blocks. Each one now has the kit loading skeleton, a load error with **Retry**, the result count at the end of the toolbar row, and its filters in a toolbar row instead of a card. A reload keeps the rows on screen. When the server refuses a custom-field filter, the list says so and offers **Remove filter**.

- **Tasks, My tasks, Projects, Opportunities:** the pager is the kit list footer, with the same *Previous* / *Next* and rows per page as before.
- **Newsletter subscribers:** the list is paged. It used to show the first 50 and stop. The search and the tag filter run as you type.
- **Newsletter e-mail blocks:** the block editor is no longer open above the list. **New block** opens it in place of the list, as *Edit* does.
- **Transactional e-mail templates and blocks:** the create form that stood above the list is a dialog behind **Create template** / **Create block**. A row's *Delete* is in its menu, and the delete runs inside the confirmation.
- New `en` / `pl` keys: `crm` `tags.count`; `projects` `templates.list.toolbar`, `templates.list.count`, `dictionary.toolbar`, `dictionary.count`, `list.count`; `tasks` `tags.count`, `priorities.count`, `mine.count`; `newsletter` `campaigns.count`, `automations.count`, `subscribers.toolbar`, `emailBlocks.count`; `transactional_emails` `templates.count`, `templates.empty`, `templates.rowActions`, `blocks.count`, `blocks.empty`, `blocks.rowActions`.
