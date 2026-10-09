---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/platform': patch
---

The storefront product list cuts its page from the products that match. On the default listing
path of `GET /api/v1/catalog/products` — no price ordering, no price range, not served by the
search engine — sales-channel membership, the caller's audience (`visibility` and the organisation
allow-list), `filter[category]` and every `filter[attr.<key>]` were applied to a page **after**
`limit + 1` rows had been fetched and `hasMore` and the cursor read off that cut. A page whose rows
were all filtered away was answered `data: []` with `hasMore: true`, and one where some were was
simply short: with two sales channels and the newest hundred products on one of them, the other's
first page of a hundred was empty.

All four are now conditions of the statement the page is cut from, so a page holds `limit` matching
products whenever that many exist, `hasMore` is `true` only when another matching product exists,
and walking the cursors yields each matching product exactly once. The response shape, the
ordering and the cursor format are unchanged, and a cursor issued before the upgrade still resumes
at the same row.

Two visible differences beyond the page size:

- `filter[category]` naming a category that does not exist, is inactive or is deleted answers one
  empty page with `hasMore: false`. It used to answer a run of empty pages with `hasMore: true`,
  one per `limit` rows of the catalogue.
- A consumer that worked around the defect by requesting further pages after an empty one keeps
  working; it simply never meets an empty page before the last.

The two price-ordered paths (`sort=price`, `sort=-price`, `minPrice` / `maxPrice`) are not changed
by this release: they already collect matching rows before cutting a page, bounded by their scan
budget.

`@endora-commerce/platform`: `SalesChannelMembershipPort` gains
`entityIdsInChannelSubquery(channelId, entityType)`, which returns the membership set as a
`{ sql, params }` subquery (`select <entity id> from <bridge> where sales_channel_id = ?`) for a
module to place inside its own statement as `<id column> in (…)`. It executes nothing. Use it where
a listing has to be channel-scoped before its page is cut; `filterEntityIdsInChannel` remains the
accessor for narrowing ids already held. **Breaking for a hand-written implementation of the
port** — a test double typed as `SalesChannelMembershipPort` must add the method; code that only
calls the port is unaffected.

No setting, permission or migration changes.
