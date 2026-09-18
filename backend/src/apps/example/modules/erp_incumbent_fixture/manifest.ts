import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/** Example deployment — stands in for a second ERP connector in integration tests. */

export const ERP_INCUMBENT_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'erp_incumbent_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'erp_incumbent_fixture',
  groups: [{ code: 'erp_incumbent_fixture', name: 'ERP incumbent fixture' }],
  settings: [
    {
      code: ERP_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'ERP incumbent fixture enabled',
      description:
        'Switches this example-deployment ERP fixture on or off. It exists only to exercise ERP-to-ERP mutual exclusion in integration tests.',
      groupCode: 'erp_incumbent_fixture',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'erp_incumbent_fixture',
  name: 'ERP incumbent fixture',
  description:
    'Example-deployment fixture representing a second ERP connector for mutual-exclusion tests.',
  version: '1.0.0',
  /**
   * Feature 132 — **the whole point of that feature, from this file's side.**
   *
   * This is an overlay module: it belongs to the `example` deployment, not to the
   * platform. To be seen by the ERP exclusion it used to need two declarations —
   * `erpConnector: true` here, *and* an entry in `ERP_CONNECTOR_MODULES` inside
   * `packages/contracts/src/erp-connector.ts`, which is core. That second edit is
   * Principle XV failing in the only way it can fail quietly: the overlay was
   * written correctly and the core edit was made anyway, because there was no other
   * way in.
   *
   * Membership is now declared here and only here. Core is untouched, and the same
   * sentence is true for a connector installed from npm — the population this
   * fixture stands in for.
   */
  capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
  dependencies: ['settings'],
  activation: { settingCode: ERP_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
});
