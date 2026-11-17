---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-i18n': patch
---

A status is no longer changed by a select that writes as soon as an option is picked (issue #1435).

- `@endora-commerce/admin-kit/components` exports `StatusChangeControl` and the types `StatusChangeControlProps` and `StatusChangeOption`. It shows the current value as a badge with a "Change…" button. The button opens a dialog that lists only the allowed targets as radio options. The write runs only after a confirmation step that names the change from one value to the other. `onConfirm(to)` does the write. If it rejects, the dialog stays open and shows `errorMessage(error)`. While the write runs, the dialog is busy. With no targets, or with a `disabledReason`, the button is disabled and the reason is shown as its description.
- `@endora-commerce/mod-i18n` ships the control's strings under `common.statusChange.*` (en, pl), and the order detail screen's under `orderDetail.statusChange.*`.
- `@endora-commerce/mod-orders`: the order detail screen changes the order status and the payment status through this control (issue #1470). The order status dialog offers the configured transition graph's outgoing transitions. The payment status dialog offers the values `POST /api/v1/admin/orders/:id/payment-status` accepts, except the current one. The payment status stays editable by hand when the `payments` module is on, for bank transfers. Both changes are disabled, with the reason shown, for an administrator without `orders:write`. The routes, their permissions and their audit entries are unchanged. Status names follow the admin language. The helper `paymentStatusOptions` in the module's admin layer is replaced by `paymentStatusTargets`; it was not exported from the package.
