import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Built-in settings manifest for the search module — feature 006.
 *
 * Reserves the `search` group and registers the search knobs
 * (`data-model.md §2`; embedder credentials via feature 058):
 *
 *   1. search.popup.suggestion_count       (number 0..50)
 *   2. search.popup.minimum_query_length   (number 1..32)
 *   3. search.llm.enabled                  (boolean)
 *   4. search.llm.embedder_credentials     (credential_ref → `llm`: Base URL +
 *                                           API key + model; the single embedder
 *                                           credential source)
 *   5. search.reindex_interval_minutes     (number)
 *
 * The Settings module's value-type registry only recognises a handful of
 * primitives (`string`, `number`, `boolean`, `json`, `string_list`) — range
 * bounds are enforced by the Search module's own LlmToggleService and the
 * suggest endpoint's parser, not by the manifest.
 */
export const SEARCH_SETTING_CODES = {
  POPUP_SUGGESTION_COUNT: 'search.popup.suggestion_count',
  POPUP_MINIMUM_QUERY_LENGTH: 'search.popup.minimum_query_length',
  LLM_ENABLED: 'search.llm.enabled',
  // Feature 058 — the single embedder credential source: a reusable `llm`
  // credential configuration supplying the embedder URL (Base URL), API key and
  // model.
  LLM_EMBEDDER_CREDENTIALS: 'search.llm.embedder_credentials',
  REINDEX_INTERVAL_MINUTES: 'search.reindex_interval_minutes',
} as const;

export const DEFAULT_POPUP_SUGGESTION_COUNT = 8;
export const DEFAULT_POPUP_MINIMUM_QUERY_LENGTH = 3;
export const DEFAULT_REINDEX_INTERVAL_MINUTES = 10;

const settings = defineModuleSettingsManifest({
  moduleCode: 'search',
  groups: [
    {
      code: 'search',
      name: 'Search',
    },
  ],
  settings: [
    {
      code: SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
      name: 'Suggestion popup — result count',
      description:
        'How many products the storefront shows in the typeahead popup. Set to 0 to suppress the popup; the explicit "Search" action still works.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_POPUP_SUGGESTION_COUNT,
    },
    {
      code: SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
      name: 'Suggestion popup — minimum query length',
      description:
        'How many characters the customer must type before the typeahead popup is requested. Below the threshold the storefront fires no request and the analytics-record endpoint silently no-ops.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_POPUP_MINIMUM_QUERY_LENGTH,
    },
    {
      code: SEARCH_SETTING_CODES.LLM_ENABLED,
      name: 'LLM-augmented search — enabled',
      description:
        'When on, Meilisearch runs hybrid lexical + semantic search using the configured embedder. Enabling this requires the three embedder.* values below to be non-empty.',
      groupCode: 'search',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS,
      name: 'LLM-augmented search — embedder credentials',
      description:
        'Reference a reusable LLM credential configuration (Credentials screen). Its Base URL, API Key and Model provide the embedder endpoint, credential and model. Required to enable LLM-augmented search.',
      groupCode: 'search',
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
    },
    {
      code: SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
      name: 'Product reindex interval (minutes)',
      description:
        'How often the background worker rebuilds every sales-channel Meilisearch index so the catalogue stays in sync. Set to 0 to disable the periodic sweep — manual reindexing from the admin remains available.',
      groupCode: 'search',
      valueType: 'number',
      defaultValue: DEFAULT_REINDEX_INTERVAL_MINUTES,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'search',
  name: 'Search',
  description:
    'Per-channel Meilisearch indexes, suggest popup, and optional LLM-augmented search.',
  version: '1.0.0',
  dependencies: ['credentials', 'sales_channels', 'settings'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [{ code: 'search:write', label: 'Configure search (LLM / indexing)' }],
});

/** Legacy export retained for backward compatibility. */
export const searchManifest = settings;
