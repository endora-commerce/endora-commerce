---
'@endora-commerce/mod-tasks': patch
'@endora-commerce/contracts': patch
---

The task screen has the layout of an opportunity (issue #1524). There are three cards instead of up to twelve: a main card with the details, the custom fields and the sub-tasks; a sidebar card with where the task belongs, its linked records, its reminders and its related tasks; and a tabbed card with Comments and Attachments, each with a count, and History. The selected tab is kept in the address as `?tab=attachments` or `?tab=history`. The status is shown once, as the badge beside the title. The Details section offers only the "Move to…" menu, beside Edit (issue #1566).

The `task.detail.after` zone is now the last section of the task screen's sidebar card, not a stack of cards below the page. A contribution built on `EditorSection` takes the zone's `chrome="section"` and is drawn as a section of that card. The zone's name and props are unchanged. A contribution that draws a card of its own should drop it.
