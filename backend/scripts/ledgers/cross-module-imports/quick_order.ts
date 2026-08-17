/**
 * Cross-module imports still standing in `quick_order` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */

/**
 * The `quick_order` cut retired twenty of the twenty-six. What is left is one
 * file, `services/default-preference-service.ts`, and the reason is the same
 * for every entry below: **`customers` builds a second instance of that class**
 * (`customers/plugin.ts:133`, its own shard's entry), and `customers` is
 * `nonDeactivatable`.
 *
 * Converting the service's five entity reads to ports was written and then
 * withdrawn, because `check:port-dependencies` correctly demanded that the
 * *other* holder declare what it now resolves — and `customers` declaring
 * `payment_methods` and `delivery_methods` as binding `dependencies` would make
 * two **deactivatable** modules permanently undeactivatable, since the
 * orchestrator refuses to disable a module a present dependent needs and
 * `customers` is always present. That is an operator-visible regression, and
 * FR-030 says a cut may not change what the deactivation dialog answers.
 * Declaring them non-binding is not available either: the service fails closed
 * on an ineligible default, it does not degrade, and inventing a degrade here
 * would be a product decision wearing a refactor.
 *
 * Retired by: the `customers` cut, which replaces its second instance with
 * `defaultPreferencePort` — the port `quick_order` already publishes for it.
 * At that point this module is the only holder, the ports go in with no
 * manifest consequence for anybody else, and this file is deleted.
 *
 * The `organizations` entry rides with them: the service takes the restriction
 * collaborator in the same constructor, and splitting one constructor across
 * two merge requests buys nothing.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/quick_order/backend.ts:organizations/services/organization-restriction-service':
    'F3 Phase C — quick_order. Types the collaborator `DefaultPreferenceService` takes; retired ' +
    'with that constructor, in the `customers` cut. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:addresses/entities/address.entity':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:customers/entities/customer-address.entity':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:organizations/services/organization-restriction-service':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
  'modules/quick_order/services/default-preference-service.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — quick_order. Retired by the `customers` cut, which stops building a second ' +
    'instance of this service. See the note above.',
};
