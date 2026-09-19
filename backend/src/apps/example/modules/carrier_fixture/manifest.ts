import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleInstallHook,
  type ModuleUninstallHook,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { createDeliveryMethodSeeder } from '@endora-commerce/mod-delivery-methods/install';
import type { DeliveryMethodSeedDefaults } from '@endora-commerce/mod-delivery-methods/ports';
import { CARRIER_FIXTURE_ADAPTER_KEYS } from './backend.js';

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
 * ## It seeds one delivery method, and that is what makes it W7's consumer
 *
 * **Done as W7's last step, which is what this section used to ask for.** W7
 * makes `inpost` and `dhl_parcel` seed `delivery_methods` from their own
 * `installHook` through the owner's published install surface instead of by raw
 * SQL — and then both modules **leave**, so `DeliveryMethodSeedApi` would be a
 * published surface with **zero consumers in this repository**. That is
 * `extraction-procedure.md` refusal 6 one level up, on the consumer side: the
 * same defect this module exists to prevent for `ShippingAdapter`. This module is
 * the standing consumer, and the sequencing was ruled **B** on 2026-09-18 on the
 * condition that W7 ends by wiring it.
 *
 * The hooks below carry all three obligations that section named, and the reason
 * each one is written the way it is stays beside it: `bindToDefaultChannel` only
 * on `created === true`, `status: 'inactive'` passed explicitly, and the
 * uninstall behind `if (!ctx.hard) return;`.
 * `specs/134-paid-module-extraction/contracts/foreign-write-repair.md` is
 * normative for all three.
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

/**
 * The one `delivery_methods` row this fixture ships, for its courier adapter.
 *
 * **One, not two.** The fixture's second adapter deliberately gets no row: a
 * contributed adapter whose `delivery_methods` row nothing wrote is a real state
 * — the registry is a per-process table and the row is durable state, written at
 * install — and this module is the only place in the repository where that state
 * is reachable on purpose.
 *
 * `status: 'inactive'` is passed **explicitly**, mirroring `dhl_parcel`. The
 * seeder's default is `'active'`, so taking the default would switch a carrier on
 * for every install of the example deployment — and a fixture that took the
 * default would exercise neither the argument nor the defect
 * (`contracts/foreign-write-repair.md` §2.4).
 */
export const CARRIER_FIXTURE_DELIVERY_METHOD: DeliveryMethodSeedDefaults = {
  code: CARRIER_FIXTURE_ADAPTER_KEYS.COURIER,
  name: { default: 'Carrier fixture courier', 'en-US': 'Carrier fixture courier' },
  cost: '0',
  currency: 'PLN',
  status: 'inactive',
  statusOnSuccess: 'shipment_sent',
  statusOnFailure: 'processing',
};

/**
 * The fixture's seed, through `delivery_methods`' published install surface
 * (feature 134, FR-064 / W7's last step).
 *
 * It is the **consumer** half of FR-021's argument: the two carriers that used to
 * call this surface stop being workspace peers, and a published surface with no
 * caller in this workspace is a breaking change to it that type-checks green here
 * and reds in a consumer's build, days later. So the fixture calls it, over
 * `ctx.em`, exactly as a real
 * carrier does — a hook has no container, so there is nothing to resolve the
 * owner's service from and the factory import is the seam
 * (`specs/conventions/module-composition.md` item 9a).
 *
 * **`bindToDefaultChannel` runs only when `created === true`.** Never as a
 * reconcile: an unguarded call is issue #96 verbatim, a method an operator
 * deliberately unbound from every channel coming back bound with nothing saying
 * so. "Unbound" is a state an operator is entitled to reach and to keep.
 */
export const installHook: ModuleInstallHook = async (ctx) => {
  const em = ctx.em as EntityManager;
  const seeder = createDeliveryMethodSeeder();
  const { row, created } = await seeder.ensureMethodForAdapter(
    em,
    CARRIER_FIXTURE_ADAPTER_KEYS.COURIER,
    CARRIER_FIXTURE_DELIVERY_METHOD,
  );
  if (!created) return;
  await seeder.bindToDefaultChannel(em, row.id);
  ctx.log.info(
    `carrier_fixture: seeded delivery method ${CARRIER_FIXTURE_DELIVERY_METHOD.code} in the default channel`,
  );
};

/**
 * Hard-uninstall cleanup only.
 *
 * A soft uninstall removes nothing and a deactivation removes nothing, which is
 * the same Principle XVII shape a real carrier has: the registry filters the
 * contributed adapter by this module's effective state, so an off module is
 * answered at the read while the row and the operator's edits to it survive.
 */
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;
  const em = ctx.em as EntityManager;
  const removed = await createDeliveryMethodSeeder().removeMethodForAdapter(
    em,
    CARRIER_FIXTURE_DELIVERY_METHOD.code,
  );
  if (removed) {
    ctx.log.info(
      `carrier_fixture: removed delivery method ${CARRIER_FIXTURE_DELIVERY_METHOD.code}`,
    );
  }
};
