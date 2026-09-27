import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Example deployment — the second of two stand-in invoice-ledger vendors.
 *
 * Why the ledger family needs a fixture at all is recorded once, on
 * `ledger_vendor_fixture/manifest.ts`. Why it needs a **second** one is D23 §2 of
 * feature 134's `research.md`: exclusion is a property of a pair, and after wave 4
 * `ledger_vendor_fixture` would be the family's only declared member — the injected
 * `ledger_fixture` sibling of the mutex contract has no manifest and no interceptor,
 * so it cannot stand in for one. Unlike `pim_challenger_fixture` this module is
 * **not** manifest-only: PIM exclusivity is enforced by the kernel from the
 * manifest, while ledger exclusivity is enforced by each member's own activation
 * interceptor, so a manifest-only member would be a declared vendor whose route does
 * not refuse. It carries that interceptor and nothing else — no freeze registration,
 * no delivery, no webhook; `ledger_vendor_fixture` is already their subject.
 */

export const LEDGER_CHALLENGER_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'ledger_challenger_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'ledger_challenger_fixture',
  groups: [{ code: 'ledger_challenger_fixture', name: 'Ledger challenger fixture' }],
  settings: [
    {
      code: LEDGER_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Ledger challenger fixture enabled',
      description:
        'Switches this example-deployment invoice-ledger vendor fixture on or off. It exists only to exercise the ledger vendor mutex between two declared members in tests.',
      groupCode: 'ledger_challenger_fixture',
      valueType: 'boolean',
      // Feature 132 / FR-016 — no member of an exclusive capability ships
      // activated, on the settings row as well as in `activation` below.
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'ledger_challenger_fixture',
  name: 'Ledger challenger fixture',
  description:
    'Example-deployment fixture representing a second invoice-ledger vendor for mutual-exclusion tests.',
  version: '1.0.0',
  capabilities: [CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR],
  dependencies: ['invoice_ledger', 'settings'],
  activation: { settingCode: LEDGER_CHALLENGER_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
