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
  dependencies: ['catalog', 'organizations', 'settings'],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base, and one of the
  // escalation answers. B2B *is* contract pricing. The deciding fact is the
  // same shape as `taxes`: absent, the resolution falls back to the base price
  // silently, so every buyer pays list and nothing on any surface says so. A
  // platform where that happens is a B2C shop, not a reduced B2B one.
  //
  // As with `taxes` this closes the operator route only; the platform route —
  // a deployment that never installs the module — is a separate follow-up.
  //
  // `price_lists.enabled` goes with the control it backed: one of the nineteen
  // that never accepted a deactivation. The existing rows are removed by a core
  // data migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'B2B is contract pricing. Absent, every buyer silently pays base price, which makes the ' +
      'platform a B2C shop rather than a reduced B2B one.',
  },
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const priceListsManifest = settings;
