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
      // Feature 132 / FR-016 — ships **off**, like every other member of an exclusive
      // capability. `resolveActivation` reads `global_value ?? default_value` off this
      // row, so a `true` here would put the fixture back on whatever the `activation`
      // block below says.
      defaultValue: false,
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
  /**
   * Feature 132 / FR-016 — **the fourth flip, and it is not in T032's list because this
   * feature created it.**
   *
   * T032 names three PIM connectors, re-derived from the tree as it was before the ERP
   * family moved. This module became a member of the exclusive `erp-connector` capability
   * in T027, and it shipped `default: true` — so from that commit it was a member of an
   * exclusive family that ships activated, which is exactly what FR-016 forbids and what
   * `capabilityRegistryFrom` now refuses. Left at `true`, it would have refused the
   * `example` deployment's boot outright.
   *
   * `research.md` §C.2 reads *"`comarch_xl` declares `default: false` and the fixture
   * `default: true`, so the ERP family already has the shape FR-016 would enforce"* — true
   * under D6's **first** version (*"at most one member may default to activated"*) and
   * false under the rule as finally decided (*"none may"*). The sentence was not re-read
   * when D6 changed.
   *
   * Nothing is lost: this fixture exists to be a second ERP connector for
   * mutual-exclusion tests, and every test that needs it activates it explicitly.
   */
  activation: { settingCode: ERP_INCUMBENT_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
