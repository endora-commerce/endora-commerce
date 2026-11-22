---
'@endora-commerce/admin-shell': patch
'@endora-commerce/cli': patch
'@endora-commerce/contracts': minor
'@endora-commerce/mod-addresses': patch
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-admin-feedback': patch
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-auth': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-currencies': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customer-notifications': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-email': patch
'@endora-commerce/mod-erp-connector': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-google-tag-manager': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-languages': patch
'@endora-commerce/mod-linkedin-ads': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-pim-connector': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-related-payers': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-search': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/platform': patch
---

The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

- **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
- **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
- **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
- **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.
