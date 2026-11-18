---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-google-analytics': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-linkedin-ads': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-meta-ads': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-transactional-emails': patch
---

One card implementation with density tokens (issue #1438, UX audit DS-04; SHELL-18 #1502). This
changes how every admin card looks, including the cards third-party modules render.

- `theme.css` declares `--card-pad` (16px), `--card-pad-sm` (12px), `--card-gap` (16px),
  `--section-gap` (24px), `--fs-page-title` (20px), `--fs-section-title` (14px) and `--fs-hint`
  (12px). A client can redeclare them after the import like any other token.
- `Card`, `CardHeader`, `CardContent` and `CardFooter` pad with `--card-pad` (16px) instead of
  `p-6` (24px). `CardContent` drops its top padding only when it follows a `CardHeader`, so a
  card without a header no longer needs `className="pt-6"`. Every part carries a `data-slot`.
- `CardTitle` renders an `h2` by default and takes `as` (`h2`–`h6`, or `div` to stay out of the
  heading outline); its size is `--fs-section-title` (14px, was 16px). A `CardTitle` that wrapped
  its own `<h2>` now nests a heading in a heading: pass the `id` to `CardTitle` and drop the inner
  element. A test that found a card title with `getByText` still does; one that counted headings
  now counts the card titles too.
- `<Card flush>` removes the content padding and clips the corners, for a table that runs to the
  card's edge. New types: `CardProps`, `CardTitleProps`, `CardTitleElement`.
- `.b2b-card`, `.b2b-card--clickable` and `.b2b-card__head` / `__title` / `__sub` / `__body` /
  `__body--flush` / `__foot` are **deprecated** but still published; they read the same tokens.
  The only visible change there is the header's vertical padding, 14px to 12px. Use `Card`.

Every module's card call sites drop the `pt-6` workaround and the redundant `text-base` on
`CardTitle`, and the 14 titles that wrapped their own `<h2>` carry the `id` themselves.
