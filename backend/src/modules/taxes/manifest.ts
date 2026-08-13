import { defineModuleManifest } from '@b2b/contracts';

/**
 * Taxes module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'taxes',
  name: 'Taxes',
  description:
    'Tax rate configuration and order tax computation.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by;
  // `dictionaries` owns the validator that checks country and region codes.
  // Feature 072 made both container resolutions rather than optional arguments.
  dependencies: ['auth', 'dictionaries'],
  settings: {
    moduleCode: 'taxes',
    groups: [{ code: 'taxes', name: 'Taxes' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'taxes.enabled',
        name: 'Taxes enabled',
        description:
          'Switches the tax-rate admin screen, its API and order tax computation on or off. Nothing is dropped: configured rates stay in the database and apply again exactly as before when you switch it back on.',
        groupCode: 'taxes',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 073 — the operator's activation control. Platform-wide. A platform
  // without configurable tax rates is a smaller platform, not a broken one:
  // rates stay in the database and reappear when it is switched back on.
  activation: { settingCode: 'taxes.enabled', default: true },
});
