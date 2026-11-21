---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-tasks': patch
---

The workflow configuration screens say plainly which changes are saved at once and which wait for *Save* (issue #1559, UX audit WORK-08).

- **CRM › Workflow** is four tabs instead of five stacked cards: **Statuses & moves** (`/crm/workflow`), **Order sync** (`/crm/workflow/order-sync`), **Value** (`/crm/workflow/value`) and **Board card** (`/crm/workflow/board-card`). Each tab has one save model. On *Statuses & moves*, the statuses and the allowed status changes are two sections of one card, both marked "Applies immediately", with no Save. *Order sync* holds both mapping tables in one card under one *Save mappings*, and *Value* holds its two lists under one *Save counting statuses*. Both Saves sit in the admin's sticky action bar with "Unsaved changes" and the result beside the button, and leaving the tab with unsaved choices asks first. The board's *Card fields* link, `/crm/workflow#board-card`, now opens the *Board card* tab. The three new routes are gated on `crm:configure`, as the screen is.
- **Tasks › Settings › Workflow**: the statuses and the moves between them are two sections of one card, both marked "Applies immediately". The board card stays in a card of its own, with its own Save.

New CRM i18n keys: `workflow.tab.statuses`, `workflow.tab.orderSync`, `workflow.tab.value`, `workflow.tab.boardCard`. The API is unchanged.
