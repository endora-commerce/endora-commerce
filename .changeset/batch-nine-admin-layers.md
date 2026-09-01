---
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-custom-fields': minor
---

`assets_library` and `custom_fields` ship their admin surfaces.

**New `./admin` subpath on both packages.** `@endora-commerce/mod-assets-library` and
`@endora-commerce/mod-custom-fields` each export `contributions` — an `AdminContributions`
object — from `@endora-commerce/mod-<id>/admin`, and nothing else. Each declares one route
and one sidebar entry; the route components are dynamic-import factories, so a consumer's
bundler emits one chunk per screen. The routes are unchanged: `/assets-library` and
`/custom-fields`, gated on `assets.read` and `custom_fields:read` respectively — the codes
the hand-written host registrations carried.

Four things a consumer has to know about that half:

- **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
  each package's new `tsconfig.ui.json`; a checkout that has not run
  `pnpm run build:packages` cannot resolve it. Both packages' `build` and `typecheck`
  scripts now run two `tsc` invocations.
- **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of
  both**, and `react-router-dom` of `mod-custom-fields`. The kit is where every screen's
  design-system import resolves; `react` is peered rather than depended on so the
  application resolves one copy.
- **Each package's `i18n/` bundle gains its own `nav.*.label`** — `nav.assetsLibrary.label`
  and `nav.customFields.label` — resolved in the module's own namespace instead of the
  shared `core` one. `appShell.nav.assetsLibrary` and `appShell.nav.customFields` are
  removed from `@endora-commerce/mod-i18n`'s bundle with the host rows that named them.
- **`mod-custom-fields`' screen no longer reads the `core` namespace at all.** It rendered
  `customFields.title` and `customFields.description` out of the shared bundle beside four
  keys of its own; both were already written in this package's `i18n/{en,pl}.json`, so the
  shared reads were a second copy of two strings. `customFields.title` and
  `customFields.save` stay in `mod-i18n` because `@endora-commerce/admin-kit`'s
  `CustomFieldValuesPanel` renders them.

**One repair inside `mod-assets-library`, and it is a deduplication a consumer can see.**
`AssetDetailDrawer` carried a private `toAbsoluteAssetUrl` over its own
`import.meta.env.VITE_API_BASE_URL` read with a `http://localhost:3001` fallback — a
fourteenth copy of the function `@endora-commerce/admin-kit/lib` publishes. It takes the
kit's now, which is the binding `LibraryPage` two files away was already taking. There is
one implementation of it in the tree again.

**Nothing is removed and no existing export changes shape**, so a consumer of either
package's `./backend`, `./migrations`, `./ports` or root subpath is unaffected. Both
modules declare `activation.nonDeactivatable`, so neither gains an operator-facing switch:
what the new subpath adds is where the screens live, not whether they can be withdrawn.
