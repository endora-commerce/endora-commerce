import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Example deployment — one of two stand-in PIM connectors for integration tests.
 *
 * Feature 134 (T113, `research.md` D13 §6; `contracts/extraction-procedure.md` W3/W6).
 * `pim_connector` stays free and gates on its family's declarations, while every real
 * member of that family is a paid module leaving this repository in wave 3. Without
 * members here, `backend/test/integration/pim_connector/cross-family.test.ts` goes red
 * at the last departure and `exclusivity-pairs.test.ts` goes vacuous at the third.
 * **Two** fixtures and not one, because exclusion is a property of a pair: one member
 * gives zero ordered pairs. `pim_challenger_fixture` is the other half.
 *
 * Manifest-only, on `erp_incumbent_fixture`'s shape: membership is declared here and
 * nowhere else, so core names neither fixture (Principle XV).
 */

export const PIM_INCUMBENT_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'pim_incumbent_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'pim_incumbent_fixture',
  groups: [{ code: 'pim_incumbent_fixture', name: 'PIM incumbent fixture' }],
  settings: [
    {
      code: PIM_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'PIM incumbent fixture enabled',
      description:
        'Switches this example-deployment PIM fixture on or off. It exists only to exercise PIM-to-PIM mutual exclusion in integration tests.',
      groupCode: 'pim_incumbent_fixture',
      valueType: 'boolean',
      // Feature 132 / FR-016 — a member of an exclusive capability ships **off**, on the
      // settings row as well as in the `activation` block: `resolveActivation` reads
      // `global_value ?? default_value` off this row.
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'pim_incumbent_fixture',
  name: 'PIM incumbent fixture',
  description:
    'Example-deployment fixture representing a PIM connector for mutual-exclusion tests.',
  version: '1.0.0',
  capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
  dependencies: ['settings'],
  // Feature 132 / FR-016 — `capabilityRegistryFrom` refuses a member of an exclusive
  // capability that ships activated; every test that needs this fixture on activates it.
  activation: { settingCode: PIM_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
