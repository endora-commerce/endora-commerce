import { CAPABILITY_KEYS, defineModuleManifest } from '@endora-commerce/contracts';

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
  /**
   * Feature 132 — this module **owns** the ERP connector capability and declares it
   * mutually exclusive (`contracts/module-capabilities.md` R3.1).
   *
   * This is the family whose old shape carried a live Principle XV violation: one
   * of its members is a per-deployment **overlay** module, and it had to be written
   * into `packages/contracts/src/erp-connector.ts` — a core file the deployment does
   * not own — to be seen by the exclusion at all. There was no other way in. After
   * this, it declares membership in its own manifest and core is untouched, which
   * `backend/test/integration/erp_connector/overlay-joins.test.ts` asserts directly.
   */
  exclusiveCapabilities: [
    {
      key: CAPABILITY_KEYS.ERP_CONNECTOR,
      errorCode: 'ERP_CONNECTOR_ALREADY_ACTIVE',
    },
  ],
  errorCodes: [{ code: 'ERP_CONNECTOR_ALREADY_ACTIVE' }],
});
