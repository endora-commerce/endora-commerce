import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  PRICING_SETTING_CODES,
} from '@b2b/contracts';

/**
 * Settings manifest for the Price Lists module — feature 011.
 *
 * Two settings (FR-037). Setting codes follow the foundation regex
 * `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'price_lists',
  groups: [{ code: 'pricing', name: 'Pricing' }],
  settings: [
    {
      code: PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE,
      name: 'Default price display mode',
      description:
        'How storefront product surfaces render prices for signed-in customers: gross_only / net_only / both / none.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
    {
      code: PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
      name: 'Unauthenticated price display mode',
      description:
        'Display mode for anonymous (not signed in) visitors. Defaults to the same as `default_display_mode` — set to `none` to hide prices until login.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'price_lists',
  name: 'Price Lists',
  description:
    'Customer-group pricing, brackets, display modes, and rule-based engine.',
  version: '1.0.0',
  dependencies: ['catalog', 'settings'],
  settings,
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const priceListsManifest = settings;
