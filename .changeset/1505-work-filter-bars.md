---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
---

The CRM board, the opportunity list, the Projects list and the Tasks screens use the kit's list toolbar (issue #1505). Each shows a few filters in one row and folds the rest behind **More filters**. While the panel is closed, the button counts the folded filters in use, as **More filters (2)**.

- **Opportunity board**: search, assignee and Organization. Tags, Sales Channel, creation range and the card-field filters are behind *More filters*.
- **Opportunity list**: search, state, status and assignee, with the sort on the right. Organization, tags, Sales Channel, creation range and **every** custom-field filter are behind *More filters*. The list no longer keeps the first three custom-field filters always open.
- **Projects list**: search, state, Organization, **My projects** and member, with the sort on the right. Role, template, stage name and custom-field filters are behind *More filters*.
- **Tasks and My Tasks**: search, status, assignee, the due range and **Overdue**. The sort and saved views are on the right.
- On/off filters (*Overdue*, *My drafts*, *Private*, *My projects*) are now toggle chips that report their state with `aria-pressed`, instead of checkboxes. Their labels are shorter.
- **Clear filters** is now the kit's **Clear all filters**, and focus moves to the search box after it.
