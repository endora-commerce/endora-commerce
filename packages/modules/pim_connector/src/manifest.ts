import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Shared PIM connector infrastructure — feature 089.
 *
 * Owns mutual-exclusion registry and field-path grammar shared by UnoPim now
 * and future PIM connectors. No import pipeline.
 */

export const manifest = defineModuleManifest({
  id: 'pim_connector',
  name: 'PIM connector shared layer',
  description:
    'Shared operator behaviours for PIM connectors: mutual exclusion, run/issue vocabulary and field-protection path grammar.',
  version: '1.0.0',
  dependencies: ['settings', 'admin_users'],
  activation: {
    nonDeactivatable: true,
    reason:
      'The shared PIM connector registry must stay available so operator activation of a PIM connector can be refused when another is already active.',
  },
  i18n: { bundlesDir: 'i18n' },
  errorCodes: [{ code: 'PIM_CONNECTOR_ALREADY_ACTIVE' }],
});
