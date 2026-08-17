/**
 * Cross-module imports still standing in `search` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/search/plugin.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/plugin.ts:settings/services/settings-admin.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/routes.admin.ts:settings/services/settings-admin.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/scripts/reindex.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/scripts/reindex.ts:custom_fields/services/custom-field-definition.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/scripts/reindex.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/llm-toggle.service.ts:settings/services/settings-admin.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-indexer.ts:catalog/entities/product-value-override.entity':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-indexer.ts:catalog/entities/product.entity':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-indexer.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-indexer.ts:catalog/services/system-attribute-scopes':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-query.service.ts:catalog/entities/product.entity':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/search-query.service.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/suggestion-pricing-enricher.ts:catalog/entities/product.entity':
    'F3 Phase C — search. Retired by the search cut merge request.',
  'modules/search/services/suggestion-pricing-enricher.ts:organizations/entities/organization.entity':
    'F3 Phase C — search. Retired by the search cut merge request.',
};
