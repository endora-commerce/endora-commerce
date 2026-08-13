import { defineModuleManifest } from '@b2b/contracts';

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
  dependencies: ['auth'],
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
  activation: { settingCode: 'seo.enabled', default: true },
});
