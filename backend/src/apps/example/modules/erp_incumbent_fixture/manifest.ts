import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

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
  erpConnector: true,
  dependencies: ['settings'],
  activation: { settingCode: ERP_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
});
