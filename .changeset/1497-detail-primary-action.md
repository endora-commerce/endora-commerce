---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
---

The order and quote-request headers have one primary action (issue #1497, UX audit SALES-12).

- `@endora-commerce/admin-kit/components`: `DetailHeaderActions` takes `moreBusy`, which disables the "More" trigger, marks it `aria-busy` and shows a spinner while an entry of the menu runs. An entry that opens a dialog (a `useConfirmDialog` question, a `ModalDialog`) now runs only after the menu has given focus back to its trigger, as `RowActionMenu` already did, so the dialog keeps focus and returns it to "More" when it closes. Before, focus went back to the trigger behind the dialog.
- `@endora-commerce/mod-orders`: on the order detail, **Issue invoice** is the one filled button while the order has no invoice, and the header has no primary once it has one. **Reorder**, **Clone to quote**, the **Invoice PDF** download and a repeat **Issue invoice** are in the "More" menu. While one of these requests runs, every header action is disabled and the control that started it shows a spinner, so a double press no longer sends the request twice.
- `@endora-commerce/mod-quote-requests`: on the quote-request detail, the next step of the status is the one filled button: **Approve** on a Pending request, **Prepare the customer's basket** on an Approved one, none otherwise. **Export PDF**, **Send PDF** and **Cancel RFQ** are in the "More" menu, with Cancel last, after a separator. **Approve** now asks for confirmation first, because it locks the agreed prices and notifies the customer.
- `@endora-commerce/mod-i18n`: `core`'s `rfq.detail.approveConfirm.title` and `rfq.detail.approveConfirm.message`, in English and Polish.
