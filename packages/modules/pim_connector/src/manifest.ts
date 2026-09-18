import { CAPABILITY_KEYS, defineModuleManifest } from '@endora-commerce/contracts';

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
  /**
   * Feature 132 — this module **owns** the PIM connector capability and declares
   * it mutually exclusive, minting the code an operator meets
   * (`contracts/module-capabilities.md` R3.1).
   *
   * The owner declares exclusivity and a member never can, which is what keeps
   * three things from coming loose. The refusal code stays on the semantic owner,
   * so a member raises `PIM_CONNECTOR_ALREADY_ACTIVE` and must **not** declare it
   * (D-95.2, and `pim_akeneo`'s manifest carries the paragraph explaining that).
   * A connector cannot make the family exclusive by accident and cannot un-make
   * it. And a deployment that installs a connector without this shared layer has
   * a family that is simply not exclusive there (R3.5) — the honest answer, since
   * without this module there is no lock row and nothing to enforce with.
   *
   * This module is **not** a member of the key it owns: an owner that were also a
   * member would exclude itself from its own family, and `defineModuleManifest`
   * refuses the pair (R3.3 / R4.4).
   */
  exclusiveCapabilities: [
    {
      key: CAPABILITY_KEYS.PIM_CONNECTOR,
      errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE',
    },
  ],
  errorCodes: [{ code: 'PIM_CONNECTOR_ALREADY_ACTIVE' }],
});
