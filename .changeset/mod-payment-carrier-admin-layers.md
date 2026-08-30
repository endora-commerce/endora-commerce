---
'@endora-commerce/mod-dhl-parcel': minor
'@endora-commerce/mod-inpost': minor
'@endora-commerce/mod-autopay': minor
'@endora-commerce/mod-paypal': minor
'@endora-commerce/mod-payu': minor
'@endora-commerce/mod-stripe': minor
'@endora-commerce/mod-tpay': minor
---

Two carriers and five payment gateways ship their admin surfaces, on a new `./admin` subpath
each.

Each package now exports `contributions` from `@endora-commerce/mod-<id>/admin` — one route,
no sidebar entry, no zone — as an `AdminContributions` object whose component is a
dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
downloaded by an operator who cannot reach the screen. The routes are unchanged:
`/delivery-methods/dhl-parcel`, `/settings/inpost`, and `/settings/{autopay,paypal,payu,stripe,tpay}`.

Four things a consumer has to know:

- **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
  `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
  not run `pnpm run build:packages` cannot resolve it.
- **`@endora-commerce/admin-kit` and `react` become peer dependencies of all seven.** They were
  backend-only packages before this. The kit is where every screen's design-system import now
  resolves, and `react` is peered rather than depended on so the application resolves one copy.
- **Each route carries a `requiredPermission`, and the admin enforces it.** `dhl_parcel:read`,
  `inpost:manage` and `<gateway>:read` — in every case the code the screen's own configuration
  endpoint enforces. A host `<Route>` was ungated, so a consumer who deep-links one of these
  paths for an operator without the code now gets the admin's not-found treatment where the
  screen used to render and its API answered 403.
- **The five gateway packages each publish a `listCountries()` beside their admin client.** It
  calls `GET /api/v1/admin/dictionary/countries?pageSize=250&sort=label` and returns
  `DictionaryCountriesPageResponse`. It is duplicated across the five deliberately: the only
  place they could share it is the admin kit, and the kit carries no module knowledge — that
  route is `dictionaries`'.

Nothing is removed and no existing export changes shape, so a consumer of any of the seven
`./backend`, `./migrations` or root subpaths is unaffected.
