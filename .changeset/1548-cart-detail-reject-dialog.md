---
'@endora-commerce/mod-carts': patch
---

The admin cart detail asks for a rejection in a dialog (issue #1548, UX audit 2026-11-17, SALES-26). *Reject cart* moved from a card of its own between the lines and the history into the header's "More" menu. It opens a dialog with the required reason; an empty reason is refused with an error on the field, and a refusal from the server is shown inside the dialog. After the rejection, the header says "Cart rejected" and focus moves to the recorded reason. The screen refreshes in place instead of showing the loading line again. The recorded reason now names who rejected the cart by role ("Platform admin", "Organization admin") instead of the stored `admin:<id>` value.

Translation keys in the `carts` catalogue, in both `en` and `pl`: added `carts.reject.title`, `carts.reject.message`, `carts.reject.reasonRequired` and `carts.reject.done`; removed `carts.reject.submitting`. `carts.reject.confirm` now reads "Reject cart" and `carts.reject.cancel` reads "Keep cart". A deployment that overrides `carts.reject.submitting` can drop the override.
