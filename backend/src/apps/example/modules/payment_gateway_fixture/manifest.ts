import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { PAYMENT_GATEWAY_FIXTURE_MODULE_ID } from './backend.js';

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
 * ## W7's last step is owed here, and it is not optional
 *
 * Written in this file rather than only in the feature's documents, on
 * `carrier_fixture`'s precedent, because a `tasks.md` merge cannot lose the
 * manifest copy.
 *
 * `contracts/foreign-write-repair.md` §2 makes the five gateways seed
 * `payment_methods` from their own `installHook` through the owner's published
 * install surface instead of by raw SQL — and then all five **leave**, so
 * `PaymentMethodSeedApi` would be a published surface with **zero consumers in
 * this repository**. That is `extraction-procedure.md` refusal 6 one level up, on
 * the consumer side: the same defect this module exists to prevent for
 * `PaymentAdapter`. This module is the standing consumer, exactly as
 * `carrier_fixture` is for `DeliveryMethodSeedApi`, and W7 ends by wiring it.
 *
 * It cannot be wired yet: `payment_methods` publishes neither `./ports` nor
 * `./install` today — `ls packages/modules/payment_methods/src` answers
 * `admin backend migrations manifest.ts` — and that owner half is the wave's
 * repair rather than this task's. When it lands, the hooks added here carry the
 * three obligations `carrier_fixture`'s already do, and the reason for each stays
 * beside it:
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
 *    correct;
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
  dependencies: ['payment_methods', 'settings'],
  activation: {
    settingCode: PAYMENT_GATEWAY_FIXTURE_SETTING_CODES.ACTIVATION,
    default: true,
  },
  settings,
});
