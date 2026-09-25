import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleInstallHook,
  type ModuleUninstallHook,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { createPaymentMethodSeeder } from '@endora-commerce/mod-payment-methods/install';
import type { PaymentMethodSeedDefaults } from '@endora-commerce/mod-payment-methods/ports';
import {
  PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS,
  PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
} from './backend.js';

/**
 * Example deployment — the payment gateway that stands in for a real one
 * (feature 134, FR-021; `contracts/extraction-procedure.md` W3).
 *
 * Wave 2 takes `autopay`, `paypal`, `payu`, `stripe` and `tpay` out of this
 * repository, and they are the **only** modules that contribute a
 * `PaymentAdapter` into `payment_methods`' `paymentAdapterRegistry` from outside
 * `payments` itself. Without this module the gateway port would be published
 * here with no foreign implementor, and a breaking change to it would type-check
 * green in the repository that publishes it and red somewhere else, days later
 * (`spec.md` §6, FR-063). `backend.ts`' doc-block names the four things that go
 * to zero implementors, each read off `payments`' built-ins rather than assumed.
 *
 * `carrier_fixture` and `ledger_vendor_fixture` beside it are the same decision
 * taken for the carrier and ledger families; `erp_incumbent_fixture` is it taken
 * where the contract is a manifest fact rather than behaviour.
 *
 * **It is not a payment capability.** It owns no table and no migration — an
 * overlay module may contribute neither (`specs/conventions/overlay-modules.md`,
 * D-106) — serves no route, and contributes no admin or storefront surface. It
 * exists so that the contract has an implementor and the contribution seam has a
 * contributor. `example` is the reference deployment, so it is composed nowhere a
 * real shop runs.
 *
 * ## It declares no capability, and that is derived rather than omitted
 *
 * The invoice-ledger vendors and the PIM/ERP connectors are **families**:
 * `invoice_ledger` derives its members with `declaredMembersOfCapability`, holds
 * a mutex over them and routes by container name, so only a module that
 * *declares* can be a subject. The payment gateways are not one. `CAPABILITY_KEYS`
 * mints three keys and none of them is a gateway; `payment_methods` discovers a
 * gateway through the **contribution seam** — a push naming its contributor,
 * enumerated through a filter on that contributor's effective state — and two
 * gateways may be active at once, which is the whole difference. A `capabilities`
 * entry here would mint a family of one, and FR-016's *no member of an exclusive
 * family ships activated* would then bind on a fixture that has no sibling to be
 * exclusive against. So this module ships **on**, as `carrier_fixture` does, and
 * `ledger_vendor_fixture`'s `default: false` is the other answer to a different
 * question.
 *
 * ## It seeds one payment method, and that is what makes it W7's consumer
 *
 * **Done as W7's last step, which is what this section used to ask for.**
 * `contracts/foreign-write-repair.md` §2 makes the five gateways seed
 * `payment_methods` from their own `installHook` through the owner's published
 * install surface instead of by raw SQL — and then all five **leave**, so
 * `PaymentMethodSeedApi` would be a published surface with **zero consumers in
 * this repository**. That is `extraction-procedure.md` refusal 6 one level up, on
 * the consumer side: the same defect this module exists to prevent for
 * `PaymentAdapter`. This module is the standing consumer, exactly as
 * `carrier_fixture` is for `DeliveryMethodSeedApi`, and W7 ends by wiring it.
 *
 * The hooks below carry all four obligations this section named before the owner
 * half existed, and the reason each one is written the way it is stays beside it:
 *
 *  * `bindToDefaultChannel` runs **only** when `created === true`, never as a
 *    reconcile — an unguarded call is issue #96 verbatim, a method an operator
 *    deliberately unbound from every channel coming back bound with nothing
 *    saying so;
 *  * the seeded row's `status` is passed **explicitly**, because the seeder's
 *    default and the value a fixture wants disagree, and a fixture that took the
 *    default would exercise neither the argument nor the defect
 *    (`foreign-write-repair.md` §2.4);
 *  * `statusOnFailure` is **never** `'cancelled'` — §4's whole premise is that
 *    the reconciler already defaults it to `'on_hold'`, so a fresh install
 *    produces nothing for the five `*_failure_status_on_hold` migrations to
 *    correct, and this hook passes no value at all;
 *  * and the `uninstallHook` sits behind `if (!ctx.hard) return;`, so a soft
 *    uninstall and a deactivation both remove nothing (Principle XVII, §2.6).
 */

export const PAYMENT_GATEWAY_FIXTURE_SETTING_CODES = {
  ACTIVATION: 'payment_gateway_fixture.enabled',
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
  moduleCode: PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
  groups: [{ code: PAYMENT_GATEWAY_FIXTURE_MODULE_ID, name: 'Payment gateway fixture' }],
  settings: [
    {
      code: PAYMENT_GATEWAY_FIXTURE_SETTING_CODES.ACTIVATION,
      name: 'Payment gateway fixture enabled',
      description:
        'Switches this example-deployment payment gateway fixture on or off. It exists only so that the payment-adapter port keeps an implementor and its contribution seam keeps a contributor in this repository; switching it off withdraws its two adapters exactly as switching off a real gateway module does.',
      groupCode: PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
  name: 'Payment gateway fixture',
  description:
    'Example-deployment fixture payment gateway: two adapters implementing the whole published contract, so the port keeps an implementor in this repository.',
  version: '1.0.0',
  // `paymentAdapterRegistry` is `payment_methods`', reached from this module's
  // boot hook — the same binding dependency `stripe` declares for the same
  // seam. `settings` carries the activation control above.
  dependencies: ['payment_methods', 'payments', 'settings'],
  activation: {
    settingCode: PAYMENT_GATEWAY_FIXTURE_SETTING_CODES.ACTIVATION,
    default: true,
  },
  settings,
});

/**
 * The one `payment_methods` row this fixture ships, for its redirect adapter.
 *
 * **One, not two.** The fixture's second adapter deliberately gets no row: a
 * contributed adapter whose `payment_methods` row nothing wrote is a real state
 * — the registry is a per-process table and the row is durable state, written at
 * install — and this module and `carrier_fixture` are the only places in the
 * repository where that state is reachable on purpose.
 *
 * `status: 'inactive'` is passed **explicitly**, mirroring all five real
 * gateways. The seeder's default is `'active'`, so taking the default would
 * offer a payment method at checkout for every install of the example deployment
 * — and a fixture that took the default would exercise neither the argument nor
 * the defect (`contracts/foreign-write-repair.md` §2.4).
 *
 * `statusOnFailure` is passed **not at all**, which is the other half of §4: the
 * seeder defaults it to `'on_hold'`, and `'cancelled'` is the value the five
 * retiring `*_failure_status_on_hold` migrations exist to remove.
 */
export const PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD: PaymentMethodSeedDefaults = {
  code: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
  type: 'gateway',
  name: {
    default: 'Payment gateway fixture (redirect)',
    'en-US': 'Payment gateway fixture (redirect)',
  },
  status: 'inactive',
};

/**
 * The fixture's seed, through `payment_methods`' published install surface
 * (feature 134, FR-064 / W7's last step).
 *
 * It is the **consumer** half of FR-021's argument: the five gateways that call
 * this surface stop being workspace peers, and a published surface with no caller
 * in this workspace is a breaking change to it that type-checks green here and
 * reds in a consumer's build, days later. So the fixture calls it, over `ctx.em`,
 * exactly as a real gateway does — a hook has no container, so there is nothing
 * to resolve the owner's service from and the factory import is the seam
 * (`specs/conventions/module-composition.md` item 9a).
 *
 * **`bindToDefaultChannel` runs only when `created === true`.** Never as a
 * reconcile: an unguarded call is issue #96 verbatim, a method an operator
 * deliberately unbound from every channel coming back bound with nothing saying
 * so. "Unbound" is a state an operator is entitled to reach and to keep.
 */
export const installHook: ModuleInstallHook = async (ctx) => {
  const em = ctx.em as EntityManager;
  const seeder = createPaymentMethodSeeder();
  const { row, created } = await seeder.ensureMethodForAdapter(
    em,
    PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
    PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD,
  );
  if (!created) return;
  await seeder.bindToDefaultChannel(em, row.id);
  ctx.log.info(
    `payment_gateway_fixture: seeded payment method ${PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD.code} in the default channel`,
  );
};

/**
 * Hard-uninstall cleanup only.
 *
 * A soft uninstall removes nothing and a deactivation removes nothing, which is
 * the same Principle XVII shape a real gateway has: the registry filters the
 * contributed adapter by this module's effective state, so an off module is
 * answered at the read while the row and the operator's edits to it survive.
 */
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;
  const em = ctx.em as EntityManager;
  const removed = await createPaymentMethodSeeder().removeMethodForAdapter(
    em,
    PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD.code,
  );
  if (removed) {
    ctx.log.info(
      `payment_gateway_fixture: removed payment method ${PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD.code}`,
    );
  }
};
