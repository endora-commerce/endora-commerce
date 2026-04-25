---
title: search
---

# `search`

Meilisearch-backed catalog search. Owns the indexer that mirrors Catalog
events into per-Sales-Channel indexes and the query bridge that translates
storefront search requests into Meilisearch calls.

## Status

Module skeleton exists; the indexer (`search-indexer.ts`) and query
service (`search-query.service.ts`) are tracked under tasks T067 and T068
and not yet shipped. Until they are, `GET /api/v1/catalog/products` runs
its filters against Postgres directly via `catalog-query.service.ts`.

## Planned surface

- **Indexer** — subscribes to `product.created.v1`, `product.updated.v1`,
  `product.archived.v1`, `attribute.updated.v1`. Upserts documents into a
  per-Sales-Channel index.
- **Query service** — translates `?q=…&filter[attr.X]=…` into a
  Meilisearch query, merges results with Postgres for fields the index
  does not hold (e.g. live stock).

## Extension points (when shipped)

- **Custom rankers** — Meilisearch supports custom ranking rules per
  index; the indexer will push the rule set so admins can tune weighting
  per Sales Channel.
- **Reserved-fallback** — if Meilisearch is unavailable, the query
  service degrades to the Postgres path so search is never fully broken
  (R-08).
