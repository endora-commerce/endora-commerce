---
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
---

The settings and admin screens show an action's result beside the control that caused it. They no longer show it as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result region.

- Dictionaries (Languages, Currencies, Countries): "Made default", "Saved" and "Deleted" appear in the list toolbar, beside the add button.
- E-mail branding, global search configuration, the ordering defaults panel (when it has its own Save) and the PWA screen: "Saved" appears beside Save. On the PWA screen, each action's result appears beside its own button: reset to global, icon upload, VAPID key generation, and push send. Changing the scope clears them.
- Taxes, admin users and admin roles: the saved tax rule, the reset password and the deleted role appear beside the header's "New …" button.
- Customer groups, payment methods and delivery methods: a save appears beside the form's title. On customer groups, a deletion is announced to screen readers only, because the deleted row is already gone from the list.
- SEO: a regenerated sitemap appears in the sitemap card's header.
- Webhooks: "Replay queued" appears in the deliveries card's toolbar.
