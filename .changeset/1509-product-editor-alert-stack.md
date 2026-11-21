---
'@endora-commerce/mod-catalog': patch
---

The product editor no longer stacks notices between its header and its tabs (issue #1509, UX audit CAT-09).

- An archived product says so in the header: the Archived pill beside the title and a Restore button beside the Product menu. The warning banner above the tabs is gone; its sentence ("This product is archived. Only Restore brings it back.") is now Restore's description for screen readers. After a restore, focus moves to the Product menu, beside which "Product restored." appears.
- Related products, Grouped children and Bundle slots report an add or a remove in the panel header, in a polite status region that screen readers announce, instead of a notice above the panel's content. A refused action is still an error banner, and it clears the last result.
- "Link added" names the link kind in the admin's language ("Up-sell", "Cross-sell") instead of its internal code.
