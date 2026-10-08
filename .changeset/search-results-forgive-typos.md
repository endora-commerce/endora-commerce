---
'@endora-commerce/mod-catalog': patch
---

**A misspelled search phrase now finds products on the search results page**, as it already did in
the typeahead popup.

`GET /api/v1/catalog/products` — the listing the storefront's `/search` page reads — answered every
request from the database unless `CATALOG_SEARCH_BACKEND=meilisearch` was set, and a default
instance does not set it. The database matches a substring, so `helmest` found nothing where
`helmets` found the product, while the popup beside it, which always reads the search index,
offered the product for both.

A request that carries a search phrase (`q`) is now answered by the `search` module whenever that
module is switched on, with nothing to configure. A listing without a phrase — browsing a category —
stays on the database, exactly as before.

`CATALOG_SEARCH_BACKEND` keeps its meaning and gains a value:

- unset — a search phrase goes to the search module, everything else to the database (**new
  default**; it used to be the database for everything);
- `meilisearch` — every listing goes to the search module (unchanged);
- `postgres` — every listing goes to the database. Set this to keep the previous behaviour.

What an instance should expect from the change: a text search is ranked by relevance and forgives
one typo in a word of five letters or more and two in a word of nine or more; it matches whole
words and the beginning of the last word typed, so a fragment taken from the middle of a SKU
(`ELMETS-01`) no longer matches where the substring match found it. A search combined with a price
ordering or a price range is still answered by the database, because the index carries no price,
and so still tolerates no typo. The fallback to the database when the index is unreachable or
`search` is switched off is unchanged.
