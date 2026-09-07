---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/email-components': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-autopay': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-credentials': minor
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-dhl-parcel': minor
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-google-analytics': minor
'@endora-commerce/mod-import-export': minor
'@endora-commerce/mod-inpost': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-ksef': minor
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
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-returns': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-stripe': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-tpay': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/page-builder-core': minor
---

Every package that ships scannable UI now publishes its own Tailwind `@source`
declarations at a new `./tailwind.css` subpath.

A host compiling this package's utility classes no longer has to know where the
package's sources are. Import the subpath from the stylesheet that builds your
admin, and the package names its own layers:

```css
@import "tailwindcss";
@import "@endora-commerce/mod-blog/tailwind.css";
```

`@source` resolves relative to the stylesheet that declares it, so the paths hold
wherever the package is installed. The file is generated from the package's layer
inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
that matters to you — the `src` line beside it is inert in a published package and
exists so that a checkout of this repository keeps scanning source in `dev`.

**Nothing is removed or renamed**: every existing subpath resolves exactly as before.
What is new is the obligation on the *host* side, and it is a build error rather than a
silent one. Before this, a host reached these packages with a glob over the monorepo
(`@source "../../packages/**"`), which named a directory no installed tree has —
and Tailwind reports nothing at all about a source that matches nothing, so such a host
built green and rendered every screen unstyled. A host that now names a package that is
not installed gets `Can't resolve`, and one whose tarball omits the file gets
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

`@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
its host.
