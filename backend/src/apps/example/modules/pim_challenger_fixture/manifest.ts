import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Example deployment — the second of two stand-in PIM connectors for integration tests.
 *
 * Why the PIM family needs fixtures at all, and why two, is recorded once, on
 * `pim_incumbent_fixture`'s manifest (feature 134, T113, `research.md` D13 §6).
 */

export const PIM_CHALLENGER_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'pim_challenger_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'pim_challenger_fixture',
  groups: [{ code: 'pim_challenger_fixture', name: 'PIM challenger fixture' }],
  settings: [
    {
      code: PIM_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'PIM challenger fixture enabled',
      description:
        'Switches this example-deployment PIM fixture on or off. It exists only to exercise PIM-to-PIM mutual exclusion in integration tests.',
      groupCode: 'pim_challenger_fixture',
      valueType: 'boolean',
      // Feature 132 / FR-016 — ships off, on the settings row as well.
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'pim_challenger_fixture',
  name: 'PIM challenger fixture',
  description:
    'Example-deployment fixture representing a second PIM connector for mutual-exclusion tests.',
  version: '1.0.0',
  capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
  dependencies: ['settings'],
  activation: { settingCode: PIM_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
