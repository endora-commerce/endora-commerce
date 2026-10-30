# Contract: search document and query (FR-033)

Owner: `search`. Decision and size estimate: research R11. Data: `data-model.md` §12.

## 1. Document (one index per sales channel, unchanged)

```ts
interface IndexedDocument {
  id; sku; type; status; visibility; slug; primaryAssetUrl; categoryIds; categorySlugs;
  attributes: Record<string, number | boolean | string | null>;     // non-text attributes only
  createdAt; updatedAt;
  liveLanguages; publishFromMs; publishUntilMs; allowedOrganizationIds; // 163, unchanged
  texts: Record<string /* language the channel offers */, {
    name: string;                       // effective at (C, L); '' for an empty override
    description: string;                // idem
    attributes: Record<string, string>; // searchable scopable/non-scopable text attributes, effective
    options: string[];                  // option labels of searchable select attributes, in L
  }>;
}
```

Removed: `name`, `description`, `localizedNames`, `searchableOptions`, text values inside `attributes`.

## 2. Indexer

`effectiveTexts` / attribute resolution at (C, L) for every L in the channel's languages — not only live ones, so a
language that turns live needs no reindex of text; option labels per L from the attribute read model. Settings:
`searchableAttributes: ['sku', 'texts', 'attributes']`, filterable unchanged. The 163 "index not yet reindexed"
fallback (`search-availability.ts`) is extended: an index whose searchable set lacks `texts` is reindexed by the
plugin's boot check, and until then queried without `attributesToSearchOn` (pre-168 behaviour), logged.

## 3. Query

`attributesToSearchOn = ['texts.<L>.name', 'texts.<L>.description', 'texts.<L>.attributes', 'texts.<L>.options',
'sku', ...searchableNonTextAttributes.map(k => 'attributes.' + k)]` with `L = searchScopeLanguage(channel,
preferredLanguage)` (163). Hit display text: `texts.<L>.name` (and description where shown). A Polish shopper's
query never reads `texts.en-US.*` (US3, FR-033): test `backend/test/integration/search/language-restricted-match.test.ts`.

## 4. Measurement

Perf task (tasks.md, Polish phase): index bytes per channel and p95 query latency before / after on the 163 perf
fixture with 1 and 3 channel languages; results recorded in `quickstart.md` § *Measurements*.
