---
'@endora-commerce/mod-google-analytics': minor
'@endora-commerce/mod-i18n': minor
---

`google_analytics` ships its admin surface, on a new `./admin` subpath.

The package now exports `contributions` from `@endora-commerce/mod-google-analytics/admin`
— three routes (`/google-analytics`, `/google-analytics/new`, `/google-analytics/:id`) and
one sidebar entry — as an `AdminContributions` object. Every component is a dynamic-import
factory, so a consumer's bundler splits the screens without being asked; the two editor
routes share one factory, so they are one chunk and not two.

Two things a consumer has to know:

- **The sidebar label moved namespace.** It was `appShell.nav.googleAnalytics` in
  `@endora-commerce/mod-i18n`'s shared `core` bundle and is now
  `nav.googleAnalytics.label` in this package's own `i18n/`, resolved in the
  `google_analytics` scope. Anything reading the old key gets a raw key back.
- **The package peers on `@endora-commerce/admin-kit`, `react` and
  `react-router-dom`.** They are peers rather than dependencies for the reason
  `page-builder-core` is: the application must resolve exactly one copy, and a provider in
  one copy against a consumer in the other is a `null` context at runtime rather than a type
  error.
