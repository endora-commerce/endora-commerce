---
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/cli': patch
'@endora-commerce/cms-components': patch
'@endora-commerce/contracts': patch
'create-endora-commerce': patch
'@endora-commerce/demo-composition': patch
'@endora-commerce/email-components': patch
'@endora-commerce/llm-client': patch
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/page-builder-core': patch
'@endora-commerce/platform': patch
'@endora-commerce/test-kit': patch
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
---

Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
about a third of a tarball's unpacked size. Each package's `files` list now ends with
`"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
every export. A stack trace from an installed package now names the compiled `dist` file rather
than a source path that does not exist in the install.
