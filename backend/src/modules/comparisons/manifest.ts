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
  dependencies: ['settings', 'catalog'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [{ code: 'comparisons:read', label: 'View product comparisons' }],
});

/** Legacy export retained for backward compatibility. */
export const comparisonsManifest = settings;
