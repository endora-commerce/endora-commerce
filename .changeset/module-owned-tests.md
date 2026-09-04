---
'@endora-commerce/mod-addresses': patch
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-autopay': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-currencies': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dhl-parcel': patch
'@endora-commerce/mod-email': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-inpost': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-ksef': patch
'@endora-commerce/mod-languages': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-pim-connector': patch
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-pim-pimcore': patch
'@endora-commerce/mod-pim-unopim': patch
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
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-stripe': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
---

Each of these packages now carries the unit tests that cover its own sources,
and a `vitest` configuration and `test` script to run them.

For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
`manifests:generate` from the package's own layer inventory, so they follow the
test files rather than being declared by hand. Nothing exported moves: the test
files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
so the published tarball is byte-identical apart from the manifest.

Running them needs nothing but the package — that is the property that decided
which files moved. A test that composes a backend server, reads a live Postgres
or Redis, or names anything under `backend/` stayed where it was.
