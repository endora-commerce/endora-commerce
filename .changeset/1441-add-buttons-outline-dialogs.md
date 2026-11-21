---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-newsletter': patch
---

In-editor "Add" buttons are outline, not filled, so they no longer compete with the screen's one primary action (issue #1441): the transition graph's "Add transition" (`StatusTransitionGraph`), the channel membership panel's "Add" and the CMS hook panel's "Add". The order status configuration no longer draws its new-status form open under the table: "Add status" in the Statuses card header opens a dialog (issue #1439). The newsletter tags and fields screen does the same for "Add tag" and "Add field", and an empty tag or field list shows an empty state with an icon and a line of explanation instead of a grey sentence (issue #1448).
