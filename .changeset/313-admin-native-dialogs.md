---
'@endora-commerce/admin-shell': patch
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-linkedin-ads': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
---

Admin screens confirm destructive and consequential actions in the kit's `ConfirmDialog` rather
than the browser's `window.confirm()` (issue #313). This covers deleting, revoking, removing and
resetting across these modules, switching a module off on the Modules screen, undoing a bulk
edit, making a sales channel the default, and preparing a customer's basket from a quote. The
dialog names the action on its confirm button (for example *Delete*, *Revoke*, *Unassign*), and a
destructive question opens with focus on Cancel.

The three native `alert()` calls are now notices on the page: deleting an attachment type that is
still in use (`catalog`), unassigning a channel's default warehouse (`inventory`), and activating a
megamenu binding that replaces another (`megamenu`, announced through a live region). Renaming a
setting group (`settings`) uses a one-field dialog instead of `prompt()`. Removing a colour from
the page builder's palette (`page-builder-admin`) is confirmed inline in its row, because the
palette is already a modal.

Several of these questions were untranslated English literals. They are now bundle keys in
English and Polish: the country, currency and language deletes (`dictionaries`), the e-mail block
and template deletes (`transactional_emails`), the setting-group delete and rename and the setting
reset (`settings`), and the sales-channel delete and rebind questions (`sales_channels`). The
assets-library folder delete no longer says "OK = … / Cancel = …". `mod-i18n` adds
`common.confirm.title` and the subscription-cancel button labels.

Two native dialogs stay on purpose: the unsaved-changes navigation guard
(`use-unsaved-changes-prompt`), which has to answer synchronously inside the click it intercepts,
and the settings screen's discard-on-channel-switch guard, which is the same kind of guard. They
will be replaced together in a later change.
