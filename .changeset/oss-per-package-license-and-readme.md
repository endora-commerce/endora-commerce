---
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
'@endora-commerce/mod-autopay': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-currencies': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dhl-parcel': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-email': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-google-tag-manager': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-infakt': patch
'@endora-commerce/mod-inpost': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-ksef': patch
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
'@endora-commerce/mod-paypal': patch
'@endora-commerce/mod-payu': patch
'@endora-commerce/mod-pim-akeneo': patch
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
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-shipments': patch
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-stripe': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-tpay': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/page-builder-core': patch
'@endora-commerce/platform': patch
'@endora-commerce/test-kit': patch
---

Every published package now ships its own `LICENSE` and `README.md`.

npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
whatever `files` says, so the text has to be in the package directory and not only at the
repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
**14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
pages would have rendered empty.

Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
when stale by `manifests:check` in the `quality` job:

- the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
  the `license: MIT` field is already rendered from. A package that declares a licence of its
  own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
- the `README.md` is rendered from what the package's own manifest declares: its description,
  its module id where it has one, every published subpath with what that layer holds, its peer
  dependencies with the optional ones marked, the locales its `i18n/` carries and what the
  tarball ships. A `README.md` **without** the generated marker on its first line is a human's
  and is never rewritten — the fourteen that existed are untouched.

Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
`mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
the note written when they were moved out of `backend/src/modules` — *"the first module to
leave backend/src/modules … the manifest id stays identity of record"* — as the sentence a
registry shows under the package name. Each now carries the sentence its own module manifest
declares, which is where `descriptionFor` seeds one from in the first place.

No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
and what a package page says.
