---
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
---

`mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
new `./admin` subpath each.

Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
`AdminContributions` object — six routes and three sidebar entries between them. Every
component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

Six things a consumer has to know:

- **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
  `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
  `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
  `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
  advertise it. All three arrays of `AdminContributions` are optional and a nav-only
  contribution is supported; a consumer rendering the registry needs both packages for the
  roles screen to be both reachable and advertised.

- **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
  `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
  are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
  package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
  a raw key back. The text is unchanged in both languages, and the screens' own keys did not
  move.

- **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
  directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
  A consumer that mirrored `files` by hand needs the new directory.

- **Three packages declare `actions` for the first time**: `open-admin-users`,
  `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
  server against the effective enabled-set, and they pay three of the fifteen remaining
  entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
  neither contributes a sidebar entry, which is that debt's population.

- **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
  `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
  and a consumer validating an icon name against the old enum keeps working. It is needed
  because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
  drew meant adding the name rather than substituting one already on the list.

- **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
  routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
  for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
  provider in one copy against a consumer in the other is a `null` context at runtime rather
  than a type error.
