---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-settings': patch
---

Saving content in the Admin UI now reaches the storefront on the next request. Until now a saved CMS
page, block, template or hook — and an edited megamenu — appeared only after the storefront's own
60-second cache window, and the **Cache** screen could not shorten that: it cleared Redis, which the
save had already done, and never told the storefront.

- **`@endora-commerce/contracts`** exports the cache-tag vocabulary both sides must spell alike:
  `CMS_STOREFRONT_CACHE_TAGS`, `MEGAMENU_STOREFRONT_CACHE_TAG`, the event name
  `CMS_CONTENT_CHANGED_EVENT` (`cms.content_changed.v1`) and its payload type `CmsContentChange`.
  The tag strings are the ones the storefront already used, with one addition: the published-page
  index (the sitemap's source) is tagged `cms:page-index` instead of `cms:page`.
- **`@endora-commerce/mod-cms`** publishes `cms.content_changed.v1` on the EventBus after every page,
  block, template and hook write has committed, and answers it by posting the matching tags to the
  storefront's `/api/revalidate`. A block save now also drops the cached hooks that inline that
  block, which it did not before.
- **`@endora-commerce/mod-megamenu`** revalidates the `megamenu` tag on every menu write, and
  subscribes to `cms.content_changed.v1` so a saved block or page drops the menus that embed or link
  to it.
- **`@endora-commerce/mod-blog`** drops its cache when a category is created and when a tag is
  renamed without a code change; both used to leave the old listing in place for five minutes.
- **`@endora-commerce/mod-settings`** — clearing the `cms` or `megamenu` namespace on the Cache
  screen, or with `settings cache-clear`, now revalidates the storefront's copy too.

Nothing to configure beyond what an instance already sets: revalidation runs when
`STOREFRONT_BASE_URL` and `REVALIDATE_SECRET` are present on the backend and the same secret is on
the storefront, is skipped otherwise, and never fails a save when the storefront cannot be reached.

**An existing storefront tree** keeps working — its tags are the same strings — with one exception
worth taking: change the tag on its `getCmsPageIndex` fetch from `cms:page` to
`CMS_STOREFRONT_CACHE_TAGS.pageIndex`, or a newly published page reaches `sitemap.xml` only when the
60-second window runs out.
