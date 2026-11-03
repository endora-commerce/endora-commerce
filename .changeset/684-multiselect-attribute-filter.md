---
'@endora-commerce/mod-search': patch
'@endora-commerce/mod-catalog': patch
---

`GET /api/v1/catalog/products?filter[attr.<key>]=<option>` answers every product whose multiselect attribute `<key>` holds `<option>` among its options, on both listing backends. With `CATALOG_SEARCH_BACKEND=meilisearch` such a filter answered `[]`: the search document stored a multiselect as its JSON text (`"[\"s-146\"]"`), which no option filter can match. On the Postgres backend a multiselect was compared as its comma-joined text, so a one-option value matched and a value holding `a` and `b` matched neither `a` nor `b`.

A multiselect now matches when any of its options is among the requested values; several values for one key stay OR-ed (`filter[attr.k]=a&filter[attr.k]=b`), and an empty multiselect matches nothing. Scalar values (string, number, boolean) are compared exactly as before. The search document's `attributes.<key>` holds a multiselect as `string[]` (each option as `String` renders it), and `IndexedDocument['attributes']` admits `string[]`.

**Upgrade step:** run one reindex per sales channel (the `search_reindex` bulk operation or the reindex CLI). Documents indexed before the upgrade still hold the JSON text, and a multiselect filter on the Meilisearch backend matches none of them until they are rewritten.
