---
'@endora-commerce/mod-linkedin-ads': minor
'@endora-commerce/mod-meta-ads': minor
'@endora-commerce/mod-i18n': minor
---

`linkedin_ads` and `meta_ads` ship their admin surfaces, on a new `./admin` subpath each.

Each package now exports `contributions` from `@endora-commerce/mod-linkedin-ads/admin` and
`@endora-commerce/mod-meta-ads/admin` — three routes (the mapping list, `/new` and `/:id`)
and one sidebar entry — as an `AdminContributions` object. Every component is a
dynamic-import factory, and the two editor routes share one factory value, so a consumer's
bundler emits one chunk for the editor rather than two.

Three things a consumer has to know:

- **The sidebar label moved namespace.** `appShell.nav.linkedinAds` and
  `appShell.nav.metaAds` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
  are now `nav.linkedInAds.label` and `nav.metaAds.label` in each package's own `i18n/`,
  resolved in the module's own scope. Anything reading an old key gets a raw key back. The
  text itself is unchanged in both languages. The screens' own keys did not move — they
  were already in each module's bundle.
- **Each admin API client gains `listSalesChannels()`.** The two screens label a mapping's
  channel, and they used to do it by importing `sales_channels`' admin client out of the
  admin application. They now call `GET /api/v1/admin/sales-channels?activeOnly=false&pageSize=100`
  themselves and type the answer with `SalesChannelListResponse` from
  `@endora-commerce/contracts`. It is deliberately duplicated in the two packages rather
  than shared: the only place two modules could share it is `@endora-commerce/admin-kit`,
  and the kit holds no module knowledge.
- **Each package peers on `@endora-commerce/admin-kit`, `react` and `react-router-dom`.**
  They are peers rather than dependencies for the reason `page-builder-core` is: the
  application must resolve exactly one copy, and a provider in one copy against a consumer
  in the other is a `null` context at runtime rather than a type error.
