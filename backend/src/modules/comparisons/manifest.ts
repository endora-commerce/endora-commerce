import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Built-in settings manifest for the comparisons module — feature 007.
 *
 * Reserves the `compare` group. The single `compare.max_products`
 * setting is added in T013 (foundational), so US1 has a real cap to
 * read from day one. Range bounds (`1..16`) are enforced by
 * `ComparisonService.addProduct(...)` per research.md R-7, not by the
 * manifest — the Settings module's value-type registry only recognises
 * primitive shapes.
 */
export const COMPARE_SETTING_CODES = {
  MAX_PRODUCTS: 'compare.max_products',
} as const;

export const DEFAULT_COMPARE_MAX_PRODUCTS = 4;

const settings = defineModuleSettingsManifest({
  moduleCode: 'comparisons',
  groups: [
    {
      code: 'compare',
      name: 'Compare',
    },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'comparisons.enabled',
      name: 'Product comparison enabled',
      description:
        'Switches the product-comparison feature on or off: the storefront compare list, the shareable comparison links and the admin screens. Nothing is dropped — saved comparisons stay in the database and their share links work again when you switch it back on. While it is off, a comparison list an anonymous visitor built is no longer adopted when they sign in, and expires with its own cookie.',
      groupCode: 'compare',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: COMPARE_SETTING_CODES.MAX_PRODUCTS,
      name: 'Maximum products per comparison',
      description:
        'Upper bound on how many products a customer can place in a single Comparison. The Compare page and PDF export are sized for this number; the storefront refuses to add a (max+1)-th product. Sensible range 1..16; defaults to 4.',
      groupCode: 'compare',
      valueType: 'number',
      defaultValue: DEFAULT_COMPARE_MAX_PRODUCTS,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'comparisons',
  name: 'Compare Products',
  description:
    'Customer-facing product comparison feature with shareable links and PDF export.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than an optional argument that
  // decided whether the admin surface existed at all.
  //
  // `price_lists` joined in issue #132: a comparison column shows a price, and
  // it now resolves that price through the `pricingService` port instead of
  // projecting the catalogue's legacy attribute. The edge binds — comparing
  // products on prices the platform is refusing to serve is exactly the
  // failure the port gate exists to prevent.
  dependencies: [
    'catalog',
    'customer_accounts',
    'price_lists',
    'sales_channels',
    'settings',
    'auth',
  ],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [{ code: 'comparisons:read', label: 'View product comparisons' }],
  activation: { settingCode: 'comparisons.enabled', default: true },
});

/** Legacy export retained for backward compatibility. */
export const comparisonsManifest = settings;
