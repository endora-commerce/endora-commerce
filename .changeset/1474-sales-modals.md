---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-credentials': patch
---

The bulk order-status dialog, the order-status delete confirmation, the quote-request cancel dialog and the credential configuration preview are the kit's `ModalDialog` / `ConfirmDialog` instead of hand-drawn overlays (issue #1474, SALES-09; #1444): each is named by its title, holds focus and returns it to the control that opened it, and closes on Escape. The bulk status dialog opens with no status chosen each time and announces a failure inside the dialog; the cancel dialog keeps a typed reason on a stray click on the scrim and shows a refused cancellation inside the dialog; the delete confirmation opens on *Cancel*; the credential preview's button reads *Close*.
