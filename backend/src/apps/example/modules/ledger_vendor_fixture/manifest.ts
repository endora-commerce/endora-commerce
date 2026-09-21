import {
  CAPABILITY_KEYS,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * `ledger_vendor_fixture` — the example deployment's stand-in invoice-ledger
 * vendor (feature 134, FR-021's shape; **D-256**'s wave-4 prologue).
 *
 * ## Why it exists, which is not "coverage"
 *
 * Wave 4 takes `wfirma`, `infakt`, `ksef` and `comarch_xl` out of this
 * repository. `wfirma` and `infakt` are the **only** declared members of the
 * `invoice-ledger-vendor` capability, so after the wave the free `invoice_ledger`
 * module publishes four ports — `invoiceLedgerDeliveryPort`,
 * `invoiceLedgerWebhookPort`, `invoiceLedgerVendorFreezeRegistry` and the vendor
 * mutex — with **no implementor and no consumer in this workspace**. A breaking
 * change to any of them would type-check green here and red in another repository
 * days later (`spec.md` §6, FR-063), and — the half D-256 is actually about — the
 * free module's own test suite would have no subject: 16 files under
 * `backend/test/{integration,contract}/invoice_ledger/` drive the ledger *through*
 * the two paid vendors, which is why E5 refuses both of them.
 *
 * `carrier_fixture` beside it is the same decision taken for the carrier family
 * and `erp_incumbent_fixture` for the ERP one. This one carries the largest
 * runtime surface of the three because a ledger vendor's contract is behavioural
 * in four directions where a carrier's is one and ERP exclusion is a manifest
 * fact.
 *
 * ## What it is not
 *
 * **It is not an accounting integration.** It owns no table and no migration — an
 * overlay module may contribute neither (`specs/conventions/overlay-modules.md`,
 * D-106), and it needs neither, because `wfirma` and `infakt` own none either:
 * every row a ledger delivery touches belongs to `invoice_ledger`. It talks to no
 * remote: its one port is `LedgerFixtureHttpPort`, declared in this directory and
 * defaulting to a client that refuses. `example` is the reference deployment, so
 * it is composed nowhere a real shop runs.
 *
 * ## It ships off, and that is not a default nobody thought about
 *
 * `invoice-ledger-vendor` is an **exclusive** capability: at most one member may
 * be operator-active at a time, and each member's
 * `refuse-when-sibling-ledger-vendor-active` interceptor is what enforces it.
 * Feature 132 / FR-016 forbids any member of an exclusive family shipping
 * activated — `capabilityRegistryFrom` refuses the boot outright — which is the
 * same correction `erp_incumbent_fixture` records beside its own `false`.
 */

export const LEDGER_VENDOR_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'ledger_vendor_fixture.enabled',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'ledger_vendor_fixture',
  groups: [{ code: 'ledger_vendor_fixture', name: 'Ledger vendor fixture' }],
  settings: [
    {
      code: LEDGER_VENDOR_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Ledger vendor fixture enabled',
      description:
        'Switches this example-deployment invoice-ledger vendor fixture on or off. It exists only so that the invoice-ledger ports keep an implementor and the free ledger suite keeps a subject in this repository; switching it off withdraws it from the vendor family exactly as switching off a real ledger vendor does.',
      groupCode: 'ledger_vendor_fixture',
      valueType: 'boolean',
      // `resolveActivation` reads `global_value ?? default_value` off this row, so a
      // `true` here would put the module back on whatever the `activation` block
      // below says. Feature 132 / FR-016: no member of an exclusive capability may
      // ship activated.
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'ledger_vendor_fixture',
  name: 'Ledger vendor fixture',
  description:
    'Example-deployment fixture invoice-ledger vendor: a synthetic vendor implementing the whole published ledger-vendor contract, so the ports keep an implementor and the free ledger suite keeps a vendor-independent subject.',
  version: '1.0.0',
  /**
   * Membership is declared here and only here (feature 132). `invoice_ledger`
   * derives the family with `declaredMembersOfCapability`, so this fixture joins
   * the mutex, the dead-letter attribution and the routing read without a single
   * edit to a free package.
   */
  capabilities: [CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR],
  /**
   * The same four `infakt` and `wfirma` declare, minus `auth` (this module serves
   * no admin route) and minus `orders` (it reads an invoice copy, never an order).
   */
  dependencies: ['credentials', 'invoice_ledger', 'invoices', 'settings'],
  activation: { settingCode: LEDGER_VENDOR_FIXTURE_SETTING_CODES.ACTIVATION, default: false },
  settings,
});
