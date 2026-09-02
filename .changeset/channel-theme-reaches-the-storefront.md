---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-sales-channels': minor
---

`sales_channels.theme_code` is read. It had not been, since 2026-04-30.

**`@endora-commerce/mod-sales-channels`** registers `GET
/api/v1/storefront/sales-channel`, the public read `PublicSalesChannelSchema`
has described since feature `005-sales-channels` and that no route implemented.
It answers `{ data: PublicSalesChannel }` for the channel the resolver picked
for the request — code, display name, language and currency scopes, `themeCode`,
`logoUrl` — and drops `id`, `active`, `systemDefault` and `version`. The channel
comes from `getResolvedChannel()`, so the endpoint re-resolves nothing and
writes no query of its own. `logoUrl` is `null`, as it is on the admin detail
shape; resolving an asset id to a URL is a separate change.

**`@endora-commerce/contracts`** adds, to `sales-channels.ts`:

- `PublicSalesChannelResponseSchema` / `PublicSalesChannelResponse` — the
  envelope of the route above.
- `STOREFRONT_THEME_CODES`, `StorefrontThemeCodeSchema`, `StorefrontThemeCode`,
  `DEFAULT_STOREFRONT_THEME_CODE` and `isStorefrontThemeCode` — the storefront
  themes that exist (`industria`, `nordic`). The admin's channel form renders a
  list from this instead of a free-text box, because a free-text box could store
  a code nothing implements, which is what it had been doing.

Nothing is removed and no existing shape changes. **`SalesChannelCreateBodySchema`
and `SalesChannelEditBodySchema` still validate `themeCode` against the
`^[a-z][a-z0-9_-]*$` regex and not against the new enum**, deliberately: a
deployment that forks the storefront owns its own theme codes, and a backend that
refused them would make the field unusable for exactly those deployments. A code
this storefront does not implement renders in the default theme and is reported
in the storefront's log; it is never guessed at and never silently rewritten.
