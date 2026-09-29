---
'create-endora-commerce': patch
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/cli': patch
'@endora-commerce/cms-components': patch
'@endora-commerce/contracts': patch
'@endora-commerce/email-components': patch
'@endora-commerce/mod-addresses': patch
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-admin-roles': patch
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
'@endora-commerce/mod-currencies': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-email': patch
'@endora-commerce/mod-erp-connector': patch
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
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/page-builder-core': patch
'@endora-commerce/platform': patch
'@endora-commerce/test-kit': patch
---

The package's `repository` now points at the canonical source repository,
`https://github.com/endora-commerce/endora-commerce`, instead of the historical GitLab host, which
nobody outside the team can open. The `directory` field still names the package's own path in that
repository, so the registry's "Repository" link lands on the package's source, and npm's
provenance check can match the publishing repository against it.

Metadata only: no export, no runtime behaviour and no dependency range changes. Nothing to do when
upgrading.
