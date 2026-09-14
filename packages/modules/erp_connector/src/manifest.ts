import { defineModuleManifest } from '@endora-commerce/contracts';

/** Shared ERP connector infrastructure — feature 119. */

export const manifest = defineModuleManifest({
  id: 'erp_connector',
  name: 'ERP connector shared layer',
  description:
    'Shared operator behaviours for ERP connectors: mutual exclusion and sync job vocabulary.',
  version: '1.0.0',
  dependencies: ['settings', 'admin_users'],
  activation: {
    nonDeactivatable: true,
    reason:
      'The shared ERP connector registry must stay available so operator activation of an ERP connector can be refused when another is already active.',
  },
  i18n: { bundlesDir: 'i18n' },
  docs: false,
  errorCodes: [{ code: 'ERP_CONNECTOR_ALREADY_ACTIVE' }],
});
