---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/cli': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/contracts': minor
'@endora-commerce/email-components': minor
'@endora-commerce/mod-addresses': minor
'@endora-commerce/mod-admin-actions': minor
'@endora-commerce/mod-admin-notifications': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-auth': minor
'@endora-commerce/mod-autopay': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-credentials': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-currencies': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-dhl-parcel': minor
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-email': minor
'@endora-commerce/mod-google-analytics': minor
'@endora-commerce/mod-google-tag-manager': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-import-export': minor
'@endora-commerce/mod-infakt': minor
'@endora-commerce/mod-inpost': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-languages': minor
'@endora-commerce/mod-linkedin-ads': minor
'@endora-commerce/mod-megamenu': minor
'@endora-commerce/mod-meta-ads': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-payments': minor
'@endora-commerce/mod-paypal': minor
'@endora-commerce/mod-payu': minor
'@endora-commerce/mod-pim-akeneo': minor
'@endora-commerce/mod-pim-connector': minor
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-prompt-actions': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-returns': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-shipments': minor
'@endora-commerce/mod-shopping-lists': minor
'@endora-commerce/mod-stripe': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-tpay': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/platform': minor
'@endora-commerce/test-kit': minor
---

Require Node >= 22.18.0.

The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
`import()`s is the client's own `.ts`. On 22.17.x that import throws
`ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
while the divergence derivation admits both, so the sibling doubles every seam site in the
report.

Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
no flag; 22.18.0 is the lowest that loads it.

If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.
