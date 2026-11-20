---
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-returns': patch
---

More sales screens show an action's result beside the control that caused it, not as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result.

- Orders and Returns lists: the result of a bulk status change or a bulk authorization appears beside the header's actions. The bulk bar goes away with the selection, so the header is what is still on screen. A result that skipped orders or cases is shown as a warning.
- Customers list: the result of resetting two-step verification for an organization appears beside the reset button. It is a warning when some accounts were not reset.
- Credit limits: a granted or adjusted limit appears under the organization's panel. Opening another organization clears it.
- Invoice detail: "PDF regenerated" and the result of resending the e-mail appear beside the header buttons. The screen shows at most one banner above the invoice: an error first, then "PDF not ready".
