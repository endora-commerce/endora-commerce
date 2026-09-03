import {
  defineModuleErrorCodes,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * The error codes this module declares (D-182,
 * `specs/090-module-owned-error-codes/`).
 *
 * Branded, so a typo at a raise site is a compile error rather than a code that
 * travels the whole path and renders raw to whoever reads it. They live in this
 * file because it is the one the package publishes at its root subpath: a
 * sibling module under `src/` is reachable through no subpath at all, so the
 * raise sites could name it and a consumer branching on the code could not.
 *
 * Declaring them in `errorCodes` below is a separate act and is what routes the
 * sentence to this package's own `i18n/` bundle; the reasoning for the three is
 * written there.
 */
export const paymentsErrorCodes = defineModuleErrorCodes([
  'PAYMENT_NOT_DUE',
  'PAYMENT_ORDER_CLOSED',
  'PAYMENT_ADAPTER_UNAVAILABLE',
]);

export const paymentsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'payments',
  groups: [{ code: 'payments', name: 'Payments' }],
  settings: [
    {
      code: 'payments.enabled',
      name: 'Payments enabled',
      // The description used to describe the settlement half only, and stopped
      // exactly where an operator most needs it: it never said that this module
      // contributes every built-in payment adapter, so switching it off empties
      // checkout's payment list and the shop stops taking orders. An operator
      // cannot learn a switch's consequence from anywhere but the switch.
      description:
        'Switches the whole payment capability on or off. While it is off the platform offers no payment method at all: this module contributes the four built-in payment adapters (bank transfer, in-person pickup, credit limit and the gateway placeholder), so every payment method configured against one of them disappears from checkout and an order naming it is refused. Unless another installed integration supplies a payment method of its own, that means the shop stops taking orders. The settlement lifecycle stops with it: the receive_payment ingress, both retry paths (the operator\'s and the buyer\'s), the per-order payment history and the payment-status e-mail. Nothing is dropped — every payment, its status transitions and its provider references stay in the database, an order mid-settlement keeps its record, and every payment method, permission and setting comes back exactly as configured when you switch it on again. It is not an uninstall, and it is not the way to switch off a single payment provider: a gateway integration depends on this module, so the platform refuses to switch this off while such an integration is still on — switch that integration off instead.',
      groupCode: 'payments',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/**
 * Payments module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'payments',
  name: 'Payments',
  // What renders beside the activation control on `/platform/modules` is this
  // string, not the activation Setting's — the Setting's description is served
  // in the settings DTO and rendered on no screen today. So the consequence has
  // to be legible here too, in one sentence: 'Payment driver abstraction and PSP
  // integrations' told an operator nothing about what flipping the switch does.
  description:
    'The platform payment capability: the built-in payment adapters (bank transfer, in-person pickup, credit limit, gateway), the payment record every order carries, and the settlement lifecycle that PSP integrations plug into. Switched off, checkout offers no payment method and the shop takes no orders.',
  version: '1.0.0',
  // Feature 075 Phase C — `customer_accounts` joins the five that were already
  // here: the payment-status e-mail resolves its recipient over
  // `customerAccountReadPort` instead of reading the `CustomerAccount` entity.
  // `orders` was already declared, which D-78 point 2 requires of the one
  // co-transactional seam kept in `receive-payment-handler.ts` — the FK
  // `payments_order_fk` had required it anyway.
  // `organizations` joins for the buyer's retry route (issue #264): a suspended
  // or blocked Organization may not pay an order any more than it may place
  // one, and the guard is `organizationReadPort.assertCanTransact`. It is
  // already transitively before this module through `orders`, so the entry
  // changes no install or migration order — it states the edge.
  dependencies: [
    'auth',
    'customer_accounts',
    'delivery_methods',
    'orders',
    'organizations',
    'payment_methods',
    'transactional_emails',
  ],
  // Feature 073 (Constitution XVII) — the operator's activation control. It only
  // became real in T126: until this module registered its own routes there was
  // no seam for a gate to sit on.
  activation: { settingCode: 'payments.enabled', default: true },
  // This module owns its authority. It shipped owning none, enforcing
  // `catalog:read` / `catalog:write` on all three of its admin routes — which
  // meant an operator who could edit a product could read every payment's
  // provider payload and, through the settlement ingress, declare an arbitrary
  // payment successful, moving the order's payment status with no money having
  // moved. Both codes were real, declared and enforced, so the permission
  // inventory's two directions were clean over it, and D-173's `foreign-gate`
  // sweep passes it deliberately (`catalog` is `nonDeactivatable`, so the
  // availability coupling that sweep asks about can never bite).
  //
  // A pair rather than one `payments:manage`: reading an order's payment
  // history is support and finance work, opening a retry and declaring a
  // settlement are money operations, and an operator organisation separates
  // them. No third code for the ingress, though it is the most dangerous of the
  // three routes: `POST /api/v1/payments/receive` is explicitly transitional
  // pending a signed PSP-webhook auth path, and a code minted for it now is one
  // that has to be migrated out of every role later — the situation
  // `PERMISSION_CATALOGUE` records as unfixable-in-place for
  // `integrations:manage` and `audit_log:read`. Revisit the split when that
  // webhook path lands, which is the moment the question is answerable.
  //
  // No manifest `action` goes with these, and that is a decision rather than an
  // omission: this module has no screen. Its only admin surface is a tab on an
  // `orders` route, so a palette action would have to declare `orders:read` as
  // its `requiredPermission` to agree with the gate on its own `targetRoute` —
  // the `ACTION_PERMISSION_DISAGREEMENTS` shape `check:action-route-permissions`
  // exists to refuse. The honest discovery entry for the payment history is
  // `orders`' own.
  permissions: [
    { code: 'payments:read', label: 'View payments' },
    { code: 'payments:write', label: 'Record and retry payments' },
  ],
  settings: paymentsSettingsManifest,
  // Feature 090 / D-182 — the error codes this module owns, and the first three
  // this package has ever declared. It is not a Phase 3 migration: the prefix
  // chain routes nothing to `payments` and this module held no bundle at all,
  // so these are new codes rather than a family changing hands.
  //
  // All three are the buyer's own payment-retry refusals, and every one of them
  // wore `VALIDATION_FAILED` with a prose sentence. That is the one code
  // `localizeErrorEnvelope` returns *before* translating — the code is
  // overloaded and several services carry machine-readable tokens in its
  // message — so a Polish buyer trying to pay a declined order was answered in
  // the raise site's English, whichever language they asked for. Same defect as
  // the order-cancellation route, one route over: the buyer's *retry* control
  // beside their *cancel* control.
  //
  // **Three codes and not one**, which is the question that had to be answered
  // before any of them was minted. The cancellation repair collapsed four
  // branches into one code because they were one `throw` behind a conjunction
  // and the buyer was told the same sentence either way. These are three
  // separate raise sites behind three orthogonal predicates, and the buyer's
  // next move differs in each:
  //
  //   * `PAYMENT_NOT_DUE` — the money is not the buyer's to pay: the order is
  //     paid, drawn against a credit limit (`deferred`), or refunded. Nothing
  //     to do.
  //   * `PAYMENT_ORDER_CLOSED` — the order's lifecycle status is terminal, so
  //     somebody cancelled it and the stock is already released. The buyer who
  //     still wants the goods places a new order.
  //   * `PAYMENT_ADAPTER_UNAVAILABLE` — the order is open and the money is
  //     still owed; the shop can no longer *start* a session for the method it
  //     was placed with. The buyer contacts the shop, and an operator repairs a
  //     configuration.
  //
  // The first two are orthogonal rather than alternative: an order can be
  // unpaid and cancelled, or paid and open, so neither implies the other. The
  // third is reached only once both have passed.
  //
  // `PAYMENT_ADAPTER_UNAVAILABLE` names the adapter rather than the method on
  // purpose. The registry it fails on is this module's; `PAYMENT_METHOD_*` is
  // the family `payment_methods` would reach for, and two modules declaring one
  // code routes it to neither of them (D-182's collision rule).
  //
  // No `tokens`: none of the three raise sites passes a fourth argument, so
  // `refusalToken` has nothing to read, and the bundle keys are flat.
  errorCodes: [
    { code: paymentsErrorCodes.PAYMENT_NOT_DUE },
    { code: paymentsErrorCodes.PAYMENT_ORDER_CLOSED },
    { code: paymentsErrorCodes.PAYMENT_ADAPTER_UNAVAILABLE },
  ],
  // The bundle those sentences live in. This module shipped none until now —
  // it has no admin screen of its own — so the directory and this declaration
  // arrive together.
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Feature 047 — admin-editable transactional email owned by this module.
  transactionalEmails: [
    {
      code: 'payment_status_changed',
      name: 'Payment status changed',
      group: 'payments',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'payment.statusLabel', label: 'Payment status', sampleValue: 'Paid' },
        { key: 'payment.failureReason', label: 'Failure reason', sampleValue: 'Card declined' },
      ],
    },
  ],
});
