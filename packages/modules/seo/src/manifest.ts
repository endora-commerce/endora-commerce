import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * SEO module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'seo',
  name: 'SEO',
  description:
    'SEO metadata management for catalog, CMS, and blog surfaces.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by. Feature
  // 072 made it a container resolution rather than a constructor argument.
  //
  // `catalog` and `cms` arrived with feature 075 Phase C. Both edges were
  // always real — the meta-tag resolver and the sitemap read their tables
  // directly — and both are **binding**: a sitemap that silently drops every
  // product or page URL still parses as a sitemap, and a crawler cannot tell
  // it from a shop that genuinely sells nothing. Refusing is the honest
  // answer. Meta tags likewise describe a page a customer can reach, which a
  // switched-off `catalog` or `cms` no longer serves.
  dependencies: ['auth', 'catalog', 'cms'],
  settings: {
    moduleCode: 'seo',
    groups: [{ code: 'seo', name: 'SEO' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'seo.enabled',
        name: 'SEO enabled',
        description:
          'Switches the meta-tag override screens, their API and the generated sitemap on or off. Nothing is dropped: overrides stay in the database and the sitemap regenerates from them when you switch it back on.',
        groupCode: 'seo',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 091 (Phase 4, batch 8) — this module ships a bundle now: its
  // sidebar entry's `labelKey` is module-relative (R8) and resolves in this
  // module's own namespace. Its screen's copy stays in `_i18n`'s `core`
  // scope, which is batch 4's shape and not a new one.
  i18n: { bundlesDir: 'i18n' },
  activation: { settingCode: 'seo.enabled', default: true },
});
