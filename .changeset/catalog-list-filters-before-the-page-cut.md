---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/platform': minor
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

`filter[attr.<key>]` matches what it matched before: the stored value is compared as the string
JavaScript prints for it, numbers included (`1e+21`, `1e-7`, `1.5` for a stored `1.50`), and an
array as its comma-joined elements. Two stored shapes no attribute type produces compare
differently from the previous release: an array nested inside an array (it used to be flattened into
the join), and a number in `[1e15, 1e21)` or `[1e-6, 1e-4)` that was written with more than 17
significant digits by something other than JavaScript.

The two price-ordered paths (`sort=price`, `sort=-price`, `minPrice` / `maxPrice`) are not changed
by this release: they already collect matching rows before cutting a page, bounded by their scan
budget.

`@endora-commerce/platform`: `SalesChannelMembershipPort` gains
`entityIdsInChannelSubquery(channelId, entityType)`, which returns the membership set as a
`{ sql, params }` subquery (`select <entity id> from <bridge> where sales_channel_id = ?`) for a
module to place inside its own statement as `<id column> in (…)`. It executes nothing. Use it where
a listing has to be channel-scoped before its page is cut; `filterEntityIdsInChannel` remains the
accessor for narrowing ids already held.

**Breaking, hence `minor`: a hand-written implementation of `SalesChannelMembershipPort` no longer
type-checks until it adds `entityIdsInChannelSubquery`.** That is a test double or an overlay's own
stand-in typed as the port; code that only *calls* the port is unaffected, and the platform's own
`SalesChannelMembershipService` already implements it. A minimal addition for a double that is
never asked for it:

```ts
entityIdsInChannelSubquery: () => {
  throw new Error('entityIdsInChannelSubquery is not stubbed');
},
```

No setting, permission or migration changes.
