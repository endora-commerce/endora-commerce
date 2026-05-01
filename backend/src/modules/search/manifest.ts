import { defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Built-in settings manifest for the search module — feature 006.
 *
 * Reserves the `search` group and registers the six knobs described in
 * `data-model.md §2`:
 *
 *   1. search.popup.suggestion_count       (number 0..50)
 *   2. search.popup.minimum_query_length   (number 1..32)
 *   3. search.llm.enabled                  (boolean)
 *   4. search.llm.embedder_url             (string; URL when set)
 *   5. search.llm.embedder_api_key         (string; secret in admin UI)
 *   6. search.llm.embedder_model           (string)
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
  LLM_EMBEDDER_URL: 'search.llm.embedder_url',
  LLM_EMBEDDER_API_KEY: 'search.llm.embedder_api_key',
  LLM_EMBEDDER_MODEL: 'search.llm.embedder_model',
} as const;

export const DEFAULT_POPUP_SUGGESTION_COUNT = 8;
export const DEFAULT_POPUP_MINIMUM_QUERY_LENGTH = 3;

export const searchManifest = defineModuleSettingsManifest({
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
      code: SEARCH_SETTING_CODES.LLM_EMBEDDER_URL,
      name: 'LLM-augmented search — embedder URL',
      description:
        'REST endpoint Meilisearch calls to obtain embeddings. Required when LLM-augmented search is enabled.',
      groupCode: 'search',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY,
      name: 'LLM-augmented search — embedder API key',
      description:
        'Secret credential Meilisearch presents to the embedder service. The admin UI masks the input; the value is still readable through the universal-getter for the indexer.',
      groupCode: 'search',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL,
      name: 'LLM-augmented search — embedder model',
      description:
        'Model identifier the embedder service uses (e.g. text-embedding-3-small). Required when LLM-augmented search is enabled.',
      groupCode: 'search',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});
