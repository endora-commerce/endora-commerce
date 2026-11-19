---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-i18n': patch
---

Action results beside the control that caused them, and at most one banner above a detail screen (issue #1499, UX audit SALES-17; owner decision DEC-12 a).

- `@endora-commerce/admin-kit/components`: `DetailHeaderActions` takes `status` — normally `useInlineStatus().props` — and mounts an always-present polite `InlineStatus` before the header's buttons, so the last header action's result is said there. Given `status`, the group renders even when the record has no action left. `@endora-commerce/admin-kit/ui`: `InlineStatus` gains a `warning` tone (icon and warning colour) for a result that went through only in part.
- `@endora-commerce/mod-quote-requests`: the quote-request detail no longer stacks up to six banners. Approve, Cancel, the customer's basket, the PDF outcome and a copied number are said beside the header's buttons; a stored revision in the Modify save bar. The cancellation reason leads the header's meta line. Above the tabs there is at most one banner: an error, else the lapsed deadline with its remedy, else the unsaved draft — the last only away from the Modify tab, where the save bar already says "Unsaved changes".
- `@endora-commerce/mod-orders`: Issue invoice (a warning when the e-mail was not sent), Reorder, Clone to quote and a copied order number are said beside the header's buttons. A status or payment-status change adds no banner: the control announces it and its badge shows it.
- `@endora-commerce/mod-organizations`: "Saved" and the results of the header's dialogs are said beside the header's buttons, a member write right above the Members section.
- `@endora-commerce/mod-i18n`: `core`'s `rfq.detail.validity.lapsed.remedyEditable` and `remedyLocked` shortened to one sentence; `orderDetail.messages.orderMoved` and `orderDetail.messages.paymentMoved` removed.
