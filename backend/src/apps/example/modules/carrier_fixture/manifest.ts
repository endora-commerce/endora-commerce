import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Example deployment — the carrier that stands in for a real one (feature 134,
 * FR-021; `contracts/extraction-procedure.md` W3).
 *
 * Wave 1 takes `inpost` and `dhl_parcel` out of this repository, and they are
 * the **only** modules that contribute a `ShippingAdapter` into
 * `delivery_methods`' `shippingAdapterRegistry` from outside `delivery_methods`
 * itself. Without this module the carrier port would be published here with no
 * foreign implementor, and a breaking change to it would type-check green in
 * the repository that publishes it and red somewhere else, days later
 * (`spec.md` §6, FR-063).
 *
 * `erp_incumbent_fixture` beside it is the same decision taken for the ERP
 * family; this one carries a runtime surface because a carrier port is
 * behavioural where ERP exclusion is a manifest fact.
 *
 * **It is not a delivery capability.** It owns no table, serves no route and
 * contributes no admin or storefront surface; it exists so that the contract has
 * an implementor and the contribution seam has a contributor. `example` is the
 * reference deployment, so it is composed nowhere a real shop runs.
 *
 * ## It seeds no delivery method *yet*, and that is W7's last step
 *
 * **Whoever implements FR-064 / W7 finishes here.** That work makes `inpost` and
 * `dhl_parcel` seed `delivery_methods` from their own `installHook` through the
 * owner's published install surface instead of by raw SQL — and then both modules
 * **leave**, so `DeliveryMethodSeedApi` is left a published surface with **zero
 * consumers in this repository**. That is `extraction-procedure.md` refusal 6 one
 * level up, on the consumer side: the same defect this module exists to prevent
 * for `ShippingAdapter`. This module is the standing consumer, and the sequencing
 * was ruled **B** on 2026-09-18 on the condition that W7 ends by wiring it.
 *
 * So add, as W7's final step:
 *
 *  - an `installHook` seeding one method through `createDeliveryMethodSeeder`,
 *    calling `bindToDefaultChannel` **only when `created === true`** — an
 *    unguarded call is issue #96 verbatim, a method an operator deliberately
 *    unbound from every channel coming back bound with nothing saying so;
 *  - `status: 'inactive'` passed **explicitly** if this fixture comes to mirror
 *    `dhl_parcel`, because the seeder's default is `'active'` and taking it
 *    silently switches a carrier on for every new install;
 *  - an `uninstallHook` behind `if (!ctx.hard) return;`, so a soft uninstall
 *    removes nothing — the row outliving deactivation is deliberate
 *    (Principle XVII).
 *
 * `specs/134-paid-module-extraction/contracts/foreign-write-repair.md` is
 * normative for all three, and none of it existed when this module was written,
 * which is why the hook is **absent rather than wrong**.
 */

export const CARRIER_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'carrier_fixture.enabled',
} as const;

/**
 * An activation control, because an overlay module is not a second kind of
 * module: both presence axes apply to it unchanged (Principle XVII). It is also
 * what makes the seam's own off state testable — the registry filters a
 * contributed adapter by its contributor's effective state, and a module that
 * could never be switched off would leave that filter with nothing to answer
 * about.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'carrier_fixture',
  groups: [{ code: 'carrier_fixture', name: 'Carrier fixture' }],
  settings: [
    {
      code: CARRIER_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Carrier fixture enabled',
      description:
        'Switches this example-deployment carrier fixture on or off. It exists only so that the shipping-adapter port keeps an implementor and its contribution seam keeps a contributor in this repository; switching it off withdraws its two adapters exactly as switching off a real carrier module does.',
      groupCode: 'carrier_fixture',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'carrier_fixture',
  name: 'Carrier fixture',
  description:
    'Example-deployment fixture carrier: two shipping adapters implementing the whole published contract, so the port keeps an implementor in this repository.',
  version: '1.0.0',
  // `shippingAdapterRegistry` is `delivery_methods`', reached from this
  // module's boot hook — the same binding dependency `dhl_parcel` declares for
  // the same seam. `settings` carries the activation control above.
  dependencies: ['delivery_methods', 'settings'],
  activation: { settingCode: CARRIER_FIXTURE_SETTING_CODES.ACTIVATION, default: true },
  settings,
});
