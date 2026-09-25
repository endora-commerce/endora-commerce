---
title: search
description: Meilisearch indexer + query bridge
---

# `search`

Meilisearch-backed catalog search. Owns the indexer that mirrors Catalog
events into per-Sales-Channel indexes, the typed query bridge, the
typeahead-popup feed, the analytics ingest for committed search phrases,
and the LLM-augmented-search opt-in.

The module composition root subscribes to Catalog events
(`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`) and to Settings events
(`settings.value_changed`) without imports into either module's
internals.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/search/suggest?q=…&limit=N` | storefront (no auth) | Typeahead popup feed; returns up to `limit` `ProductSummary` rows ordered by Meilisearch relevance |
| `POST /api/v1/search/record` | storefront (no auth) | Fire-and-forget analytics ingest; persists one verbatim row in `search_phrase_records` per committed search |
| `POST /api/v1/admin/search/llm/toggle` | admin (`search:write`) | Cross-setting-validating wrapper around `search.llm.enabled`; refuses to enable when any embedder.* field is empty for any targeted channel |

The full search results page reuses `GET /api/v1/catalog/products?q=…` —
catalog owns that contract, and the storefront `/search` route just
re-exports `CatalogPage`. There is no parallel results-page contract.

## Settings

Six knobs live under the `search` group, registered by
`packages/modules/search/src/manifest.ts`:

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `search.popup.suggestion_count` | `number` | `8` | How many products the storefront popup shows; `0` suppresses the popup but committed search still navigates |
| `search.popup.minimum_query_length` | `number` | `3` | Minimum characters before the storefront fires a suggest request and before the recorder persists a row |
| `search.llm.enabled` | `boolean` | `false` | Enables Meilisearch's hybrid lexical + semantic search on this channel |
| `search.llm.embedder_url` | `string` | `""` | OpenAI-compatible embedder endpoint URL (used by Meilisearch) |
| `search.llm.embedder_api_key` | `string` | `""` | Embedder API key (admin UI masks the input) |
| `search.llm.embedder_model` | `string` | `""` | Embedder model identifier (e.g. `text-embedding-3-small`) |

All six are sales-channel-scoped via the existing Settings model. The
storefront popup reads its count + threshold per request via the
universal getter (`SettingsService.get`); on any read error (cache
miss, `SettingNotRegistered`) the suggest service falls back to the
manifest defaults so a Settings hiccup never 500s the popup.

## LLM-augmented search

Toggling `search.llm.enabled` on for a channel attaches a Meilisearch
embedder to that channel's index. We register the embedder under the
well-known name `default` with `source: 'openAi'`; the `url` parameter
makes it work against any OpenAI-compatible endpoint (OpenAI itself,
Azure OpenAI, Ollama's OpenAI shim, …).

The toggle wrapper (`POST /api/v1/admin/search/llm/toggle`) refuses to
flip `enabled=true` for any channel whose three embedder.* fields
aren't all populated. The error envelope's `details[]` lists
every missing `(channelCode, settingCode)` pair so the admin UI can
highlight the gaps.

The reactor (in `SearchEventSubscriber`) is belt-and-braces: a power
user PUTting `search.llm.enabled=true` directly through the generic
Settings admin route (bypassing the wrapper) does **not** poison
Meilisearch — the reactor warn-logs and leaves the index alone if the
embedder.* triplet is incomplete.

Disabling never refuses; the reactor calls `index.resetEmbedders()` so
the channel falls back to plain lexical ranking.

Meilisearch v1.11 gates `embedders` behind the `vectorStore`
experimental feature; v1.13+ treats embedders as stable. Both are
supported transparently — the admin endpoint does not gate on the
Meilisearch version.

## Analytics ingest

Every committed storefront search lands one row in
`search_phrase_records` for the future Analytics module to aggregate:

| Column | Notes |
| --- | --- |
| `phrase` | Verbatim — no typo correction or LLM expansion |
| `phrase_normalized` | `lower(trim(phrase))`, maintained at insert time; supports case-insensitive aggregation without rewriting the verbatim phrase |
| `sales_channel_id` | FK → `sales_channels.id` (`ON DELETE RESTRICT` — dropping a channel must surface as a deliberate decision rather than silently delete history) |
| `result_count` | Number of products the search returned; `0` for dead-end phrases |
| `recorded_at` | `timestamptz default now()` |

Indexes:

- `idx_search_phrase_records_aggr` on `(sales_channel_id, phrase_normalized, recorded_at desc)` — supports the analytics-module's "phrases by channel and frequency over a window" query.
- `idx_search_phrase_records_recent` on `(recorded_at desc)` — for ops dashboards.

The recorder is fire-and-forget (`SearchPhraseRecorder.record(...)`):
it returns once the row has been queued, not once persisted, and
swallows every exception via warn-log. The route hands off the
promise without awaiting (`void recorder.record(...)`) and returns
`202 { ok: true }` immediately. The storefront response is therefore
never delayed or failed by analytics persistence.

Below-threshold phrases (shorter than the channel's
`minimum_query_length`) are silently no-op'd server-side as a
belt-and-braces against a UI bug flooding the table with stub
phrases.

## Indexer + event subscriber

`SearchIndexer` writes one document per product into a per-channel
index named `products_<channel_code>`. Document shape carries the
catalog product surface (id, sku, name, description, type, status,
slug, primaryAssetUrl, categoryIds, categorySlugs, attributes,
searchableOptions, createdAt, updatedAt). The indexer also drives
Meilisearch's `searchableAttributes` + `filterableAttributes` from the
live `product_attributes.is_searchable` + `is_filterable` flags, and
its `sortableAttributes` from `SORTABLE_ATTRIBUTES` (see *Sorting*).

**A document carries no price.** It used to carry one, copied from the
legacy `attributes.defaultPrice` catalogue attribute — not any price
list's figure — and read by nothing on the query path, which resolves
the viewer's price from `price_lists` at hydrate time so the index
cannot decide what a buyer pays. A per-buyer price cannot be indexed
in any case: one index per sales channel and one document per product
means pricing the document would multiply the corpus by the customer
base. The legacy attribute is still indexed under
`attributes.defaultPrice`, where its name says what it is.

### Sorting

Meilisearch refuses a sort on any field outside the index's
`sortableAttributes`, so the fields the query path may sort on are
declared once, in `SORTABLE_ATTRIBUTES` (`search-indexer.ts`):
`createdAt` and `name`. That constant is both what the indexer applies
to every channel index and the alphabet `buildSort` may emit — its
return type is built from it, so a sort naming a field the indexer
never declared does not compile.

The listing contract's four sorts map as follows:

| `?sort=` | Meilisearch |
| --- | --- |
| `relevance` (or absent) | none — the engine's ranking rules |
| `-createdAt` | `createdAt:desc` |
| `name` | `name:asc` |
| `-name` | `name:desc` |

The indexed `name` is resolved in the channel's own default language,
which is the language the listing renders, so the order a buyer sees
is the order they were sorted by.

**Upgrading an index built before the sort settings were applied** needs a reindex: the
settings were never applied (`sortableAttributes` was `[]` on every
index, and every sorted listing was silently answered by the Postgres
fallback), and `createdAt` was never written into a document. A full
reindex applies both. That happens automatically on the next periodic
sweep in the worker role (`search.reindex_interval_minutes`, default
10); a deployment that runs no sweep needs the operator step — the
admin **Reindex products** action or `pnpm --filter backend run
search:reindex`. An `attribute.updated.v1` refresh reapplies the
settings but writes no documents, so it restores `name` sorting and
not `-createdAt`.

### `searchableOptions` — option-list search

For attributes flagged `isSearchable` AND with a select-style
`valueType` (`select`, `enum`, `multiselect`), the indexer resolves
the per-locale option label and includes it in the document's
`searchableOptions: string[]` field. Meilisearch settings include
`searchableOptions` in `searchableAttributes` so a customer searching
for the rendered text they see (e.g. "Czerwony") hits products whose
raw value is the option key (e.g. "red"). Toggling `isSearchable` off
removes the option labels from `searchableOptions` on the next refresh
within the existing event-driven cadence.

`SearchEventSubscriber` keeps the indexes in sync:

| Event | Handler |
| --- | --- |
| `product.created.v1` | `indexer.upsertProduct(productId)` |
| `product.updated.v1` | `indexer.upsertProduct(productId)` |
| `product.archived.v1` | `indexer.deleteProduct(productId)` |
| `attribute.updated.v1` | `indexer.refreshAttributeSettings()` |
| `settings.value_changed` (when `settingCode === 'search.llm.enabled'`) | `indexer.attachEmbedderForChannel` / `detachEmbedderForChannel` |

All handlers swallow their own errors — a transient Meilisearch
outage does not break the catalog write path. The reserved fallback
in the read path (`catalog/routes.public.ts`) keeps storefront search
functional with a stale index until the next offline `search:reindex`.

### When the index does not answer

The fallback stays a fallback — a public catalogue must not 503
because search is unhappy — but it distinguishes two facts that used
to be fused into one:

- **unreachable** — the engine is down, unroutable or timing out.
  Transient. `catalog` logs it per request and re-runs the listing
  through Postgres; nothing else is expected of anybody.
- **refused** — the engine answered, in milliseconds, that it will not
  run *this* query: `invalid_search_sort`, `index_not_found`, a
  rejected API key. Deterministic, will not pass on its own, and a
  defect in how this module configured the index. The reason string
  the caller logs names Meilisearch's own error code, and `search`
  reports it itself at `error` level — once per code, because an index
  setting is a deployment fact and a public listing would otherwise
  report it on every request.

That distinction is the whole reason the defect could survive on five
live indexes: every sorted listing was falling back to Postgres, and
the only trace of it was a line reading `meilisearch unavailable`
about an engine that was up and healthy.

## Storefront integration

The page header (`storefront/components/Header.tsx`) renders a
`<form action="/search" method="GET">` with a progressively-enhanced
`<SearchAutocomplete>` client component inside it:

- 200 ms debounce; AbortController cancels stale fetches.
- Below the channel's `minimum_query_length`, no request fires.
- Keyboard model: ArrowUp/Down to move selection, Enter to navigate
  to the selected suggestion, Escape to close, click outside to
  dismiss.
- 503 from `/search/suggest` surfaces a "search temporarily
  unavailable" item in the popup without breaking the static form.
- With JS disabled, the form posts `?q=…` to `/search` natively
  (no JS required for crawlability).

The `/search` page (`storefront/app/(catalog)/search/page.tsx`)
re-exports `CatalogPage` — the listing, filters, sort, pagination,
and empty state are identical to `/catalog`. The only search-specific
behaviour is the analytics fire-and-forget: when `?q=` is present,
the page awaits `listProducts` (so `resultCount` is meaningful), then
`void recordPhrase(...)` BEFORE delegating to `CatalogPage`.

## Reindex CLI

`search reindex` walks every Sales Channel and pushes its public
product surface into Meilisearch. Idempotent — safe to run after a
fresh `endora demo seed` or whenever the index drifts from Postgres.

It is a command this module declares in its `manifest.ts` and the host
runs, so it reindexes through the one `SearchIndexer` the composition
holds rather than building a second one:

```bash
pnpm --filter backend run search:reindex
# or, addressing the host binary directly:
pnpm --filter backend exec tsx src/cli.ts search reindex
```

The body is `packages/modules/search/src/backend/cli/reindex.ts`.

## Testing

- `backend/test/contract/search/public-suggest.contract.test.ts` (7 cases) — happy path, limit override, threshold, oversize, missing q, limit OOB.
- `backend/test/contract/search/public-record.contract.test.ts` (7 cases) — happy path, default `result_count`, channel pinning, empty/oversize/negative validation, below-threshold no-op.
- `backend/test/contract/search/admin-llm-toggle.contract.test.ts` (5 cases) — incomplete-config refusal (every embedder.* permutation), full-config success, disable always succeeds, unauthenticated → 401.
- `backend/test/integration/search/manifest-reconcile.test.ts` (2 cases) — group + 6 settings seeded with correct defaults; idempotent re-apply.
- `backend/test/integration/search/embedder-reactor.test.ts` (3 cases) — attach on enable=true, detach on flip-back-to-false, no event-fire when wrapper refuses the toggle.
- `backend/test/integration/search/event-subscriber.test.ts` (existing) — catalog-event-driven indexing.
- `backend/test/integration/search/catalog-via-meilisearch.test.ts` (existing) — env-flag-dispatched read path.
- `backend/test/integration/search/sort-order.test.ts` (6 cases) — each of the four sorts served by Meilisearch (`x-search-backend` is the load-bearing assertion: Postgres answers all four, so the order alone cannot tell a served page from a fallback), the declared `sortableAttributes`, and the absence of the indexed `price`.
- `backend/test/unit/search/search-sort-attributes.test.ts` (4 cases) — `buildSort` emits only fields `SORTABLE_ATTRIBUTES` declares.
- `backend/test/unit/search/search-degrade-observability.test.ts` (3 cases) — a refused query names the engine's error code and is reported once; an unreachable one is not reported twice.

The last two need no services; the rest run against real Postgres +
real Meilisearch.

## Extension points

- **Custom rankers** — Meilisearch supports custom ranking rules per
  index; the indexer can push the rule set when the admin UI grows a
  per-channel weighting affordance.
- **Embedder-source enum** — `search.llm.embedder_source` with values
  `openAi | huggingFace | rest | userProvided` would let a single
  channel pick a non-OpenAI-compatible provider without renaming the
  three credential settings.
- **Reserved fallback** — already implemented: when Meilisearch is
  unavailable, the catalog read path degrades to Postgres ILIKE
  search via `catalog-query.service.ts` so the storefront is never
  fully broken.
