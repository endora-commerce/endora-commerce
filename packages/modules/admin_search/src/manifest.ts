import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Global search — find records of every type from the admin's command palette,
 * and decide which fields each type is searched by
 * (`specs/150-admin-global-search/`).
 *
 * The module owns no table. It hosts the provider registry the owning modules
 * push their record types into, the federated search endpoint, the search
 * configuration (Settings rows) and the two screens. It is operator-toggleable
 * (Constitution XVII): `admin_search.enabled` is its activation control, and
 * switching it off withdraws record search from the palette, the results page,
 * the configuration screen and the API — nothing is deleted.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'admin_search',
  groups: [
    {
      code: 'admin_search',
      name: 'Global search',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'admin_search.enabled',
      name: 'Global search enabled',
      description:
        'Switches record search in the admin on or off: the record groups in the command palette, the full results page, the searchable-fields configuration and their API. The command palette keeps finding screens and actions either way. Nothing is dropped — the configuration stays in the database and applies again when you switch it back on.',
      groupCode: 'admin_search',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // FR-002 / FR-028 — below it the palette searches screens and actions only.
      // Range 2–10, enforced by this module's settings write validator.
      code: 'admin_search.minimum_query_length',
      name: 'Minimum search length',
      description:
        'How many characters an administrator has to type in the command palette before records are searched (2 to 10). Shorter texts match too many records to be useful; order numbers, tax IDs and SKUs are all longer than the default of 3.',
      groupCode: 'admin_search',
      valueType: 'number',
      defaultValue: 3,
    },
    {
      // FR-004 / FR-028 — the palette's per-type limit. Range 1–10, enforced by
      // this module's settings write validator. The results page shows up to 20
      // per type whatever this says.
      code: 'admin_search.results_per_entity',
      name: 'Results per record type',
      description:
        'How many records of each type the command palette shows (1 to 10). When more match, the palette says so and offers the full results page, which shows up to 20 of each type.',
      groupCode: 'admin_search',
      valueType: 'number',
      defaultValue: 5,
    },
    {
      // FR-018 – FR-023 — which fields each record type is searched by, and
      // whether it takes part. Hidden: it is edited on the Global search
      // configuration screen, which shows the offered fields with their labels;
      // a JSON text box is the wrong editor for a checklist (research R-5).
      // An empty `entities` map means every record type uses its defaults.
      code: 'admin_search.entity_fields',
      name: 'Searchable fields',
      description:
        'Which fields each record type is searched by, and whether it takes part in global search. Edited on the Global search configuration screen.',
      groupCode: 'admin_search',
      valueType: 'json',
      defaultValue: { version: 1, entities: {} },
      hidden: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'admin_search',
  name: 'Global search',
  description:
    'Find organizations, customers, orders, quote requests, sales opportunities, products and categories from the admin command palette, with configurable searchable fields.',
  version: '1.0.0',
  // The ports this module resolves: `requireAdmin` (`auth`), the caller's
  // permission list (`admin_roles`), server-side label resolution (`_i18n`) and
  // the settings store its configuration lives in (`settings`). All four are
  // non-deactivatable, so this module holds no other module's switch.
  dependencies: ['_i18n', 'auth', 'admin_roles', 'settings'],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'admin_search.enabled', default: true },
  // `admin_search:configure` gates the searchable-fields configuration — its
  // read and its write, the screen, its sidebar entry and its palette action
  // (research R-20). Searching itself needs no code of its own: each record
  // type is checked against the code its own admin list enforces (R-4).
  permissions: [{ code: 'admin_search:configure', label: 'Configure global search' }],
  i18n: { bundlesDir: 'i18n' },
  // Principle XVI — the results page and the configuration are reachable from
  // ⌘K (contracts/admin-ui.md §2.3); the record groups themselves are the
  // palette's own.
  actions: [
    {
      id: 'open-global-search',
      labelKey: 'actions.openGlobalSearch.label',
      descriptionKey: 'actions.openGlobalSearch.description',
      icon: 'Search',
      targetRoute: '/global-search',
      keywords: ['search', 'find', 'records'],
      keywordsKey: 'actions.openGlobalSearch.keywords',
      weight: 50,
    },
    {
      id: 'open-global-search-configuration',
      labelKey: 'actions.openConfiguration.label',
      descriptionKey: 'actions.openConfiguration.description',
      icon: 'Settings',
      targetRoute: '/global-search/configuration',
      // The code the configuration routes enforce (check:action-route-permissions).
      requiredPermission: 'admin_search:configure',
      keywords: ['search', 'fields', 'configuration'],
      keywordsKey: 'actions.openConfiguration.keywords',
      weight: 900,
    },
  ],
  docs: { dir: 'docs' },
  demo: false,
});
