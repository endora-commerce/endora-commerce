---
'@endora-commerce/mod-search': patch
---

`POST /api/v1/admin/search/reindex` answers `503 SEARCH_BACKEND_UNAVAILABLE` in the error envelope
when Meilisearch is unreachable or refuses the request (a rejected API key, for example), with the
client's own message. It used to answer an untyped `500 INTERNAL`, while the storefront's suggest
route already gave a buyer the typed refusal for the same condition. A failure that is not the
search engine's is still a 500.
