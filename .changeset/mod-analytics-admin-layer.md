---
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-i18n': minor
---

`analytics` ships its admin surface, on a new `./admin` subpath.

The package now exports `contributions` from `@endora-commerce/mod-analytics/admin` — one
route (`/analytics`) and one sidebar entry — as an `AdminContributions` object. The
component is a dynamic-import factory, so a consumer's bundler splits the screen without
being asked.

Three things a consumer has to know:

- **Every string the dashboard renders moved namespace.** The fourteen `analytics.*` keys
  and `appShell.nav.analytics` were in `@endora-commerce/mod-i18n`'s shared `core` bundle;
  they are now `page.title`, `range.7days`, `nav.analytics.label` and so on in this
  package's own `i18n/`, resolved in the `analytics` scope. Anything reading an old key
  gets a raw key back. The text itself is unchanged in both languages.
- **The module declares a command-palette action, `open-analytics`.** It had an admin
  screen and a sidebar entry since feature 018 and no ⌘K entry, which Principle XVI says is
  not enough. It gates on `analytics:read`, the code `GET /api/v1/admin/analytics/summary`
  enforces.
- **The package peers on `@endora-commerce/admin-kit`, `react` and `lucide-react`.** They
  are peers rather than dependencies for the reason `page-builder-core` is: the application
  must resolve exactly one copy, and a provider in one copy against a consumer in the other
  is a `null` context at runtime rather than a type error.
