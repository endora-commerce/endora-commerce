import { defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Built-in settings manifest for the search module — feature 006 / T001.
 *
 * Reserves the `search` setting group so the storefront-side knobs
 * (popup suggestion count, minimum query length) and the admin-side
 * LLM-augmented-search opt-in (toggle + embedder url/api-key/model)
 * have a stable home. The actual settings are populated in T019 once
 * US2 lands.
 */
export const searchManifest = defineModuleSettingsManifest({
  moduleCode: 'search',
  groups: [
    {
      code: 'search',
      name: 'Search',
    },
  ],
  settings: [],
});
