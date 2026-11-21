---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-tasks': minor
'@endora-commerce/mod-i18n': minor
---

The admin kit publishes `ViewModeToggle` from `@endora-commerce/admin-kit/components`: the *List | Board* switch that Tasks and My Tasks used, now named from the shared `common.viewMode.*` strings. The Tasks module no longer ships its own copy, and its `view.label`, `view.list` and `view.board` strings are removed.

CRM's Opportunities list and board are one page. `/crm/opportunities` shows the list, and `/crm/opportunities?view=board` shows the board, switched by the toggle in the page header. The two views share one address: the search, organization, assignee, tag, sales-channel and creation-date filters carry over when the view changes. The list's state, status, sort and custom-field filters are now in the address too, so a reload or a shared link keeps them. **Clear all filters** clears the filters of both views. The sidebar loses its *Board* row. `/crm/board`, and the command palette's *Opportunity board* that targets it, redirect to the board view and keep the filters a bookmark carried. The CRM strings `nav.board.label` and `board.title` are removed.
