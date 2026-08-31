---
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

`promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
icon map the glyph behind it.

Each of the four module packages now exports `contributions` from
`@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
`/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
ten `/product-feeds*` paths.

Six things a consumer has to know:

- **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
  `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
  not run `pnpm run build:packages` cannot resolve it.
- **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
  dependencies of all four.** They were backend-only packages before this. The kit is where
  every screen's design-system import now resolves, and React is peered rather than depended on
  so the application resolves one copy.
- **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
  for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
  `product_feeds:read` — in each case the code the screen's own API enforces on its entry
  handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
  operator without the code now gets the admin's not-found treatment where the screen used to
  render and its API answered 403. The write codes each of these modules also owns
  (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
  `product_feeds:write`) gate controls **inside** a screen and are unchanged.
- **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
  `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
  `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
  name rather than substituting one already on the allowlist.
  `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
  producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
  in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
  `Rss` are already on the list, each added by an earlier palette action of that same module.
- **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
  `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
  `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
  own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
  `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
  deliberate, because the only place two modules could share it is the admin kit and the kit
  holds no module knowledge.
- **`product_feeds`' download anchors now read the API origin from
  `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
  directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
  and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
  variable is set the two are identical, so this is a repair to the unset case and not a change
  to any configured one.

Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
`nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
breadcrumb trails the admin holds for the payment-gateway settings screens.

Nothing is removed and no existing export changes shape, so a consumer of any of the four
`./backend`, `./migrations`, `./ports` or root subpaths is unaffected.
