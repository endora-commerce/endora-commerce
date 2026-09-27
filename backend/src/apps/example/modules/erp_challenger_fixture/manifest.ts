import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Example deployment — the second of two stand-in ERP connectors for integration tests.
 *
 * Feature 134 (T115, `research.md` D13 §6; `contracts/extraction-procedure.md` W3/W6).
 * `erp_connector` stays free and gates on its family's declarations, and
 * `backend/test/integration/erp_connector/overlay-joins.test.ts` needs that family to
 * hold **more than one** member. `erp_incumbent_fixture` was one; the other was the one
 * packaged ERP connector, which leaves this repository. This fixture keeps the pair
 * inside the deployment, so the exclusion cases stay non-vacuous after that departure.
 *
 * Manifest-only, on `erp_incumbent_fixture`'s shape: membership is declared here and
 * nowhere else, so core names neither fixture (Principle XV).
 */

export const ERP_CHALLENGER_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'erp_challenger_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'erp_challenger_fixture',
  groups: [{ code: 'erp_challenger_fixture', name: 'ERP challenger fixture' }],
  settings: [
    {
      code: ERP_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'ERP challenger fixture enabled',
      description:
        'Switches this example-deployment ERP fixture on or off. It exists only to exercise ERP-to-ERP mutual exclusion in integration tests.',
      groupCode: 'erp_challenger_fixture',
      valueType: 'boolean',
      // Feature 132 / FR-016 — ships off, on the settings row as well.
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'erp_challenger_fixture',
  name: 'ERP challenger fixture',
  description:
    'Example-deployment fixture representing a second ERP connector for mutual-exclusion tests.',
  version: '1.0.0',
  capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
  dependencies: ['settings'],
  activation: { settingCode: ERP_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
