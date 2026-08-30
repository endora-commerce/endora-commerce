import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Orders module — manifest.
 *
 * Feature 036 adds the customer-facing business Order ID. Its optional
 * prefix/suffix are declared here as settings (`orders.business_id.*`) and
 * seeded by the module-lifecycle ManifestReconciler on boot — the same path
 * `carts.abandonment.*` uses. They are Sales-Channel-scopable through the
 * standard settings scoping; defaults are empty (bare numeric ID).
 */

export const ORDERS_SETTING_CODES = {
  BUSINESS_ID_PREFIX: 'orders.business_id.prefix',
  BUSINESS_ID_SUFFIX: 'orders.business_id.suffix',
  /** Feature 038 — minimum order value to pass Checkout / admin create (0 = no minimum). */
  MIN_ORDER_VALUE: 'orders.min_order_value',
  /** Feature 038 — whether reordering a past order is allowed. */
  REORDER_ENABLED: 'orders.reorder_enabled',
  /** Feature 038 — extra emails CC'd on every order confirmation in scope. */
  CONFIRMATION_RECIPIENTS: 'orders.confirmation_recipients',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'orders',
  groups: [{ code: 'orders', name: 'Orders' }],
  settings: [
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_PREFIX,
      name: 'Business Order ID prefix',
      description:
        'Text prepended to the generated business Order ID shown to the Customer (e.g. "ORD-"). Empty = no prefix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_SUFFIX,
      name: 'Business Order ID suffix',
      description:
        'Text appended to the generated business Order ID shown to the Customer (e.g. "-2026"). Empty = no suffix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: ORDERS_SETTING_CODES.MIN_ORDER_VALUE,
      name: 'Minimum order value',
      description:
        'Minimum order total required to pass Checkout or to create an order. 0 = no minimum. Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'number',
      defaultValue: 0,
    },
    {
      code: ORDERS_SETTING_CODES.REORDER_ENABLED,
      name: 'Reordering enabled',
      description:
        'When enabled, a past order can be placed again (reorder). Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: ORDERS_SETTING_CODES.CONFIRMATION_RECIPIENTS,
      name: 'Order confirmation recipients',
      description:
        'Additional email addresses that receive a confirmation for every order placed in scope (global or per Sales Channel).',
      groupCode: 'orders',
      valueType: 'string_list',
      defaultValue: [],
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'orders',
  name: 'Orders',
  description: 'Order placement, lifecycle, and history.',
  version: '1.3.0',
  // Feature 072 (T141) — `addresses` and `credit_limits` were reached through
  // options a root passed down, so neither appeared here. Order placement
  // resolves a delivery address and reserves against the credit limit; both are
  // as real as the edges already listed.
  // Feature 075 — `assets_library`, `catalog` and `customer_accounts` join the
  // list because the route surface and the external intake read their rows
  // through published ports instead of their entity classes. All three are
  // non-deactivatable and none of them declares this module, so the edge binds
  // nothing an operator could otherwise have flipped and closes no cycle.
  // D-94.3 — three edges leave for `acknowledgedDependencies` and three
  // arrive, and the two halves are one change.
  //
  // `carts`, `credit_limits` and `promotions` leave because each of them now
  // declares **this** module, for the foreign key its own table carries
  // against `orders` (`carts_completed_order_fk`,
  // `credit_limit_reservations_order_fk`, `promotion_usages_order_fk`). The
  // port edges in the other direction are all real and all still bind; what
  // the constraints make false is the *install ordering* a `dependencies`
  // entry claims, and `acknowledgedDependencies` withdraws exactly that.
  //
  // D-179.1 corrects the sentence above: the port edges into `credit_limits`
  // and `promotions` are real, and they no longer bind. They fail closed and
  // say so in `nonBindingDependencies`, which is the third spelling !1023 added
  // for exactly the case the acknowledgement had no word for.
  //
  // `price_lists` and `taxes` arrive because this module resolves
  // `pricingService` and `taxService` and has never declared either: both were
  // satisfied through `carts`' transitive closure, which is legal and brittle
  // — `carts` dropping `price_lists` would have made two unrelated port edges
  // undeclared in a module nobody was editing. Neither declares `orders`, so
  // neither is mutual and neither needs acknowledging.
  //
  // `sales_channels` owns `salesChannelAttributionRegistry`, the registry this
  // module pushes its own "how many of my rows are attributed to this channel?"
  // counter into (feature 075, D-87). The registry is ungated and its owner is
  // non-deactivatable, so the declaration buys install and migration order
  // rather than a flip-time refusal.
  dependencies: [
    'addresses',
    'api_keys',
    'assets_library',
    'catalog',
    'customer_accounts',
    'organizations',
    'price_lists',
    'sales_channels',
    'settings',
    'taxes',
    'transactional_emails',
  ],
  /**
   * Feature 073, Amendment A1 — real port edges whose `dependencies` entry
   * would close a cycle `test/unit/db/module-graph.test.ts` fails on. Read by the
   * flip-time refusals and by `check-port-dependencies`; read by neither the
   * install order nor the migration order.
   *
   * Every pair below is mutual by construction, which is the standard the
   * check's own header sets: this module reads the neighbour during placement,
   * and the neighbour records a row against the order — `carts_completed_order_fk`
   * holds that row, so the ordering claim runs the other way and is withdrawn
   * here rather than left standing and false.
   *
   * The list was four owners until D-179.1. `credit_limits`, `promotions` and
   * `quote_requests` moved to `nonBindingDependencies` below: mutuality is why
   * none of them could be `dependencies`, but it is no argument for the *bind*,
   * and a bind from this module is one no operator can ever lift.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'carts',
      port: 'cartWritePort',
      reason:
        'Placement reads the basket it is turning into an order and the reorder path replaces ' +
        'its lines, both through the port `carts` publishes. `carts_completed_order_fk` ' +
        '(`carts.completed_order_id` -> `orders.id`) obliges `carts` to declare this module, ' +
        'so a `dependencies` entry here would close `orders -> carts -> orders`. Both modules ' +
        'are non-deactivatable, so acknowledging withdraws the ordering claim and changes ' +
        'nothing an operator can reach.',
    },
    {
      moduleId: 'carts',
      port: 'cartPlacementApplyPort',
      reason:
        'The basket half of placement — the lines the order is built from, and the ' +
        'completion that empties the basket and stamps `completed_order_id` — both on the ' +
        'placement `EntityManager` (feature 080, T048; D-169). A second `carts` name rather ' +
        'than a widening of `cartWritePort`, because it runs in a different transaction: ' +
        'that port opens its own, and this one may not. `carts_completed_order_fk` obliges ' +
        '`carts` to declare this module, so a `dependencies` entry here would close ' +
        '`orders -> carts -> orders`; acknowledging withdraws that ordering claim and ' +
        'withdraws nothing else. The bind is kept and is real: a checkout that cannot see ' +
        'the basket has nothing to turn into an order, so with `carts` absent placement ' +
        'must refuse rather than place an empty one.',
    },
    {
      moduleId: 'carts',
      port: 'cartReadPort',
      reason:
        'The customer`s active basket, read **outside** any transaction, for the storefront ' +
        'total preview (feature 080, T048). A third `carts` name beside the two above ' +
        'because it runs in no transaction at all: handing a read an `EntityManager` would ' +
        're-open a write seam to serve it (D-169). Same cycle as the two above — ' +
        '`carts_completed_order_fk` obliges `carts` to declare this module — and the same ' +
        'bind: a preview that cannot read the basket must refuse rather than quote a total ' +
        'for lines it has not seen.',
    },
  ],
  // D-44 — real to the container, binding on no operator.
  //
  // D-179.1 moves four edges here from `acknowledgedDependencies`, over three
  // owners. Each was a fallback-less read of a gated port, which until !1023 had
  // only the two binding spellings — and a bind from this module is permanent,
  // because it declares itself non-deactivatable. `credit_limits.enabled`,
  // `promotions.enabled` and `quote_requests.enabled` were controls an operator
  // could flip with nothing happening. Nothing about the behaviour changes: the
  // gate refused before and refuses now, and what the entries add is the
  // sentence the operator's confirmation dialog renders.
  nonBindingDependencies: [
    {
      moduleId: 'credit_limits',
      name: 'creditLimitService',
      kind: 'refuses-without',
      whenAbsent:
        'no order can be placed against a credit limit, and an order that drew one can be ' +
        'neither cancelled nor marked paid, because its reservation cannot be released; ' +
        'every other order is unaffected',
      reason:
        'Placement reserves against the organization`s limit inside its own transaction, so ' +
        'the `PESSIMISTIC_WRITE` on the credit row is held until the order commits; ' +
        'cancellation and the transition to paid release that reservation. D-179.3: both ' +
        'release paths asked the port for every order, so an absent owner refused both ' +
        'transitions platform-wide — a refusal about orders that never drew credit. They now ' +
        'test `paymentMethodSnapshot.kind` first, this module`s own record of whether there ' +
        'is anything to release, so the port is resolved only for an order that took one; ' +
        'not a `catch`, and those orders still refuse. Each call is a `lazyPort` forward ' +
        'with no fallback. `credit_limit_reservations_order_fk` obliges `credit_limits` to ' +
        'declare this module, so `dependencies` was never available.',
    },
    {
      moduleId: 'promotions',
      name: 'promotionService',
      kind: 'refuses-without',
      whenAbsent:
        'no order can be placed or previewed at all — the discount total is recomputed ' +
        'through the promotion engine on every checkout, not only on a discounted basket',
      reason:
        'The coupon discount is recomputed at placement through ' +
        '`PromotionApplyPort.applyToCart`, so the figure stamped on the order is the engine`s ' +
        'and not the basket`s copy of it. The call sits in the money math both `placeOrder` ' +
        'and `previewTotal` share and is made for every basket, so an absent owner refuses ' +
        'the whole placement and the whole preview — the sentence says so rather than naming ' +
        'coupons, which would understate it. A `lazyPort` forward on a `di.providePort` name ' +
        'with no fallback. `promotion_usages_order_fk` obliges `promotions` to declare this ' +
        'module, so `dependencies` was never available and the acknowledgement that stood ' +
        'here dropped the ordering claim while keeping the bind.',
    },
    {
      moduleId: 'promotions',
      name: 'promotionUsageFinalizer',
      kind: 'refuses-without',
      whenAbsent:
        'a basket carrying a discount cannot become an order — the redemption row is written ' +
        'inside the placement transaction, so the order rolls back with it',
      reason:
        'The redemption row itself, written on the placement `EntityManager` so a cap hit at ' +
        'the last moment rolls the order back with it — the write ' +
        '`promotion_usages_order_fk` holds. A separate name from `promotionService` because ' +
        'D-94.5 split the em-carrying half off the read half so its owner writes the ' +
        'interface, and it takes the same conversion for the same reason. Its refusal is ' +
        'unreachable while `promotionService` refuses first, and the sentence is written ' +
        'anyway: `deactivationConsequencesFor` keeps one row per dependent, so which of the ' +
        'two the operator reads is scan order, and an entry with no sentence classifies ' +
        'exactly as no entry at all.',
    },
    {
      moduleId: 'quote_requests',
      name: 'rfqService',
      kind: 'refuses-without',
      whenAbsent:
        'an order cannot be turned back into a quote — the reorder-as-quote action on the ' +
        'order screen refuses, and every other order surface keeps serving',
      reason:
        'An order placed from an accepted quote marks that quote converted, and the ' +
        'reorder-as-quote action builds a new request from the order`s lines. Both go through ' +
        '`RfqCustomerPort`, a `lazyPort` forward on a `di.providePort` name with no fallback, ' +
        'so an absent owner refuses that one action and leaves the rest of this module ' +
        'serving — which is what `refuses-without` says. It was acknowledged on the ground ' +
        'that the edge is mutual (`quote_requests.converted_order_id` mirrors ' +
        '`carts.completed_order_id`); the mutuality is still why it is not `dependencies`, ' +
        'and the bind is what D-179.1 gives up. `carts` holds its own constraint into that ' +
        'module`s table, and that bind is not this module`s to withdraw.',
    },
    {
      moduleId: 'inventory',
      name: 'inventoryStockReadPort',
      kind: 'degrades-without',
      whenAbsent: 'orders are placed without reserving stock',
      reason:
        'The channel → warehouse binding placement allocates against, read through the port ' +
        'that module publishes. Until D-94.4 it was a knex join over two of `inventory`s ' +
        'tables, so `inventory` appeared nowhere in this manifest while every placement ' +
        'locked `stock_levels`, incremented `reserved` and inserted `stock_allocations` rows ' +
        '— a module writing its own tables with an operator having switched it off (issue ' +
        '#188). `degrades-without` rather than `dependencies`: ' +
        '`stock_allocations_order_item_fk` obliges `inventory` to declare this module, so ' +
        'the edge cannot be declared here; and an acknowledged edge would keep the bind and ' +
        'make `inventory.enabled` unusable, because this module is non-deactivatable. ' +
        '`order-service.ts` asks `effectiveState.isPresent` before the reservation block.',
    },
    {
      moduleId: 'inventory',
      name: 'inventoryFulfilmentPlanningPort',
      kind: 'degrades-without',
      whenAbsent: 'orders are placed without reserving stock',
      reason:
        'The warehouse-picking policy — the effective fulfilment strategy for a line and the ' +
        'allocation plan that follows from it. Both are pure over their arguments, and both ' +
        'were reached by importing `inventory/services/` files from inside the placement ' +
        'method body. They share the presence decision above because they share its cause: ' +
        'with the reservation block skipped there is no plan to compute.',
    },
    {
      moduleId: 'inventory',
      name: 'inventoryReservationApplyPort',
      kind: 'degrades-without',
      whenAbsent:
        'orders are placed without reserving stock, and a cancelled order releases none until the module is switched back on',
      reason:
        'The reservation itself — the `FOR UPDATE` lock on `stock_levels`, the `reserved` ' +
        'increment, the `stock_allocations` rows and the release a cancellation performs — ' +
        'on the placement `EntityManager`, because `stock_allocations_order_item_fk` (`on ' +
        'delete restrict`) means an allocation row cannot exist before its order item does ' +
        'and the lock must be held by the transaction that writes the order (feature 080, ' +
        'T048; D-169). It joins the two entries above under one presence question rather ' +
        'than adding a second. Same ground as those two: `inventory` declares this module ' +
        'for the constraint, so `dependencies` would close a cycle, and an acknowledged ' +
        'edge would keep the bind and make `inventory.enabled` unusable. Until T048 this ' +
        'module wrote that module`s two tables through its entity classes.',
    },
    {
      moduleId: 'payments',
      name: 'paymentPlacementApplyPort',
      kind: 'refuses-without',
      // Deliberately wider than the seam (D-179). That module contributes every
      // built-in payment adapter, so checkout empties long before placement
      // reaches this port. An operator reading a sentence about "the payment
      // row" would price the flip as a missing record rather than a closed shop,
      // and a consequence dialog that understates is the defect the ledger
      // exists to prevent.
      whenAbsent:
        'the shop takes no orders at all: no payment method is left to choose, and a ' +
        'placement reaching checkout anyway is refused rather than recorded unpaid',
      reason:
        'The payment row placement opens, on the placement `EntityManager` because ' +
        '`payments_order_fk` (`on delete restrict`) means it cannot exist before its order ' +
        'does (feature 080, T048; D-169). A `lazyPort` forward with no fallback and no ' +
        '`catch`: an order with no record of what is owed is not an order, so there is ' +
        'nothing to degrade to. `dependencies` was never available — `payments` declares ' +
        'this module for the constraint — and an acknowledged edge would keep the bind and ' +
        'make `payments.enabled` a dead switch, because this module is non-deactivatable. ' +
        'D-179 measured the refusal barely reachable: `assertPaymentMethodUsable` refuses a ' +
        'method whose adapter has an absent owner first, and the path it tolerates — an ' +
        'adapter nobody registered — wrote a row into that off module`s table (issue #188).',
    },
    {
      moduleId: 'prompt_actions',
      name: 'promptActionToolRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s boot hook, of the order resolver and the status-change ' +
        'mutations built over its own transition service. Nothing is read back: the ' +
        'registry is a plain registration that drops every tool whose owner is not ' +
        'effectively present, so an absent contributor costs the host nothing and an ' +
        'absent host holds a table nobody walks. Declaring the edge would make an optional ' +
        'assistant undeactivatable for as long as the platform takes orders.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentAdapterRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no payment method to choose from',
      reason:
        'Placement dispatches through the adapter table `payment_methods` owns, and the ' +
        'catalogue a buyer picks from is served by that module’s own routes — so switching it ' +
        'off closes the choice at its own seam and leaves order taking, order history and ' +
        'every admin order screen serving. Declaring it in `dependencies` would instead make ' +
        '`payment_methods.enabled` a control no operator could ever use, which is the ' +
        'authority ruling 2 of feature 074 withholds from a dependent.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentOrderStatusRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no payment method to choose from',
      reason:
        'The `statusOn*` references the same module registers beside its adapter table, read ' +
        'for the status an order moves to when a payment settles. It shares the sentence ' +
        'above because it shares the cause: with no method to choose there is no payment to ' +
        'settle. Same ground for keeping it out of `dependencies`.',
    },
    {
      moduleId: 'payments',
      name: 'paymentEmailRendererPort',
      kind: 'degrades-without',
      whenAbsent:
        'the order confirmation still goes out, with the payment line written from the ' +
        'method snapshot instead of a gateway’s own wording',
      reason:
        'The payment line of the order-confirmation e-mail (feature 034 FR-016/FR-017) is ' +
        'rendered through the registry `payments` hosts, which an adapter may push a custom ' +
        'renderer into. `payments` declares this module, so `dependencies` would close a ' +
        'cycle; and an acknowledged edge keeps the bind, which would make a deactivatable ' +
        'module undeactivatable for as long as the platform takes orders — a buyer who paid ' +
        'on invoice must still receive their confirmation. `backend.ts` asks ' +
        '`effectiveState.isPresent` per send and falls back to this module’s own baseline.',
    },
    {
      moduleId: 'shipments',
      name: 'shippingEmailRendererPort',
      kind: 'degrades-without',
      whenAbsent:
        'the order confirmation still goes out, with the delivery line written from the ' +
        'method snapshot instead of a carrier’s own wording',
      reason:
        'The delivery twin of `payments:paymentEmailRendererPort` (feature 035), and the ' +
        'same shape: `shipments` declares this module, so the edge cannot go in ' +
        '`dependencies`, and binding it would stop an operator switching shipments off on a ' +
        'platform that keeps taking orders. Presence is asked per send in `backend.ts`.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentMethodReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'the admin create-order preview quotes no payment surcharge, because there is no ' +
        'method catalogue to quote one from',
      reason:
        'The method row behind an id the create-order form submitted. It shares the ground ' +
        'of the two entries above: `payment_methods` serves the catalogue a method is ' +
        'chosen from, so with the module off no id reaches this read in the first place, and ' +
        'declaring it in `dependencies` would make `payment_methods.enabled` a control no ' +
        'operator could use. `routes.ts` receives an accessor and asks presence per request.',
    },
    {
      moduleId: 'delivery_methods',
      name: 'deliveryMethodReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'the admin create-order preview quotes no delivery cost, because there is no method ' +
        'catalogue to quote one from',
      reason:
        'The delivery twin of `payment_methods:paymentMethodReadPort`, and the same shape. ' +
        '`shipments` declares `delivery_methods` in `dependencies` and may: it is itself ' +
        'deactivatable, so the bind costs an operator a choice they still have. This module ' +
        'is not, so the same declaration here would be permanent.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceReadPort',
      kind: 'degrades-without',
      whenAbsent: 'an order’s invoice PDF is no longer offered; nothing else about an order changes',
      reason:
        'The customer invoice download and the admin bulk print read the document `invoices` ' +
        'owns. `invoices` declares this module — an invoice is raised against an order — so ' +
        '`dependencies` would close a cycle `module-graph.test.ts` fails on, and an ' +
        'acknowledged edge would keep the bind and make `invoices.enabled` unusable, because ' +
        'this module is non-deactivatable. Both routes ask presence and answer 404 ' +
        '`INVOICE_NOT_READY`, which is the answer an order that has not been invoiced yet ' +
        'already gets.',
    },
    {
      moduleId: 'invoices',
      name: 'invoicePlacementApplyPort',
      kind: 'degrades-without',
      whenAbsent: 'an order is placed without a proforma document; nothing else about the order changes',
      reason:
        'The proforma row placement opens, on the placement `EntityManager` because ' +
        '`invoices_order_fk` (`on delete restrict`) means it cannot exist before its order ' +
        'does (feature 080, T048; D-169). Same ground as the two entries above: `invoices` ' +
        'declares this module, so `dependencies` would close a cycle, and an acknowledged ' +
        'edge would keep the bind and make `invoices.enabled` unusable, because this module ' +
        'is non-deactivatable. `order-service.ts` asks `effectiveState.isPresent` before the ' +
        'call and skips it whole. The degrade is the repair, not its cost: until T048 this ' +
        'module wrote the row itself, so an operator who had switched invoicing off went on ' +
        'having a document opened in every placement.',
    },
    {
      moduleId: 'invoices',
      name: 'invoicePdfPort',
      kind: 'degrades-without',
      whenAbsent: 'an order’s invoice PDF is no longer offered; nothing else about an order changes',
      reason:
        'The renderer behind the same two routes, and the same sentence: a VAT document is ' +
        'an `invoices` surface, so a business that has switched invoicing off should not be ' +
        'served one from an order screen.',
    },
    {
      moduleId: 'delivery_methods',
      name: 'shippingAdapterRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no delivery method to choose from',
      reason:
        'The delivery twin of `payment_methods:paymentAdapterRegistry`, read for placement ' +
        'dispatch. `delivery_methods` serves the catalogue a buyer picks from, so its own ' +
        'seam closes the choice while the rest of order taking keeps working. Declaring it ' +
        'would kill `delivery_methods.enabled` for every deployment that takes orders.',
    },
  ],
  /**
   * The two error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where each sentence is looked up from: `errors.<CODE>` in
   * this module's own `i18n/{en,pl}.json`, which already holds both in both
   * languages.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5): it is
   * exactly what the prefix chain in `@endora-commerce/mod-i18n` routes here
   * today, copied from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` rather than
   * re-derived. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **The list a reader expects is the long one, and it runs the other way.**
   * Most modules' surprise is a code routed *here* that reads like somebody
   * else's; `orders` has none of those — both codes below are plainly its own.
   * Its surprise is the inverse, and it is large: this package throws eighteen
   * distinct error codes and owns exactly one of them. `INVOICE_NOT_READY` is
   * `invoices`' and is thrown twice in this module's `routes.ts` — the worked
   * example in the runbook's step 2; `CART_EMPTY` is `carts`';
   * `STOCK_UNAVAILABLE` is `inventory`'s. The remaining fourteen —
   * `ADDRESS_NOT_OWNED`, `API_KEY_NOT_BOUND`, `CREDIT_LIMIT_NOT_GRANTED`,
   * `CURRENCY_MISMATCH`, `CUSTOM_FIELD_VALUE_INVALID`, `FORBIDDEN`,
   * `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `INTERNAL`,
   * `INVALID_TRANSITION`, `LIMIT_INSUFFICIENT`, `NOT_FOUND`,
   * `ORGANIZATION_SUSPENDED` and `VALIDATION_FAILED` — fall through the chain to
   * the platform block. Two more of somebody else's codes appear here without
   * being thrown at all: `SKU_NOT_IN_ASSORTMENT` (`catalog`'s) and
   * `PRICE_UNAVAILABLE` (the platform block's) are per-line `issue`
   * discriminators in the external intake service. Ownership follows the domain
   * noun and never the thrower (D-95.2), so none of them belongs below.
   *
   * The same asymmetry holds once more in the opposite direction:
   * `ORDER_NOT_FOUND` is raised from three *other* packages —
   * `shipments/services/shipment-service.ts`,
   * `payments/services/payment-service.ts` and
   * `invoices/services/invoice-service.ts` — each resolving an order before
   * doing its own work. Fifteen raise sites, twelve of them in this package.
   *
   * **No tokens, and that is derived rather than assumed.** Grepping both
   * spellings the tree uses (`ERROR_CODES.<CODE>` and a bare `'<CODE>'` string
   * literal) over `packages` and `backend/src`, every raise of `ORDER_NOT_FOUND`
   * is a three-argument `new HttpError(404, …, 'Order not found.')` with no
   * `details` object at all, so no raise site can put a `details.code` on the
   * wire and `refusalToken` has nothing to read. The bundle agrees from the
   * other side: `errors.ORDER_NOT_FOUND` and `errors.ORDER_NOT_CANCELLABLE` are
   * flat keys with no `.<token>` tail.
   *
   * **`ORDER_NOT_CANCELLABLE` is raised by nothing, and the reason is not that
   * the rule is missing.** Searched in all three spellings the runbook's T11–T13
   * name — `ERROR_CODES.ORDER_NOT_CANCELLABLE`, the bare literal, and
   * `OrderNotCancellable` as a bespoke error class — `git log --all -S` finds
   * only the commit that declared the enumeration member, the feature 082 bundle
   * move and feature 090's own capture. No commit ever added a `throw` and none
   * ever removed one. The rule itself is live:
   * `CustomerOrderCancellationService.cancelByCustomer` refuses a
   * non-cancellable order on `POST /api/v1/orders/:id/cancel` — the very route
   * `specs/001-b2b-platform-foundation/contracts/orders.contract.md` specifies
   * as answering `409 ORDER_NOT_CANCELLABLE` — and answers `409
   * VALIDATION_FAILED` instead. Contract and implementation disagree about the
   * code, which is `MEGAMENU_REFERENCED`'s shape one module over. The code is
   * declared here regardless: ownership follows the capture (runbook T10), and
   * deciding *which* 289 codes exist is not this merge request's question.
   */
  errorCodes: [{ code: 'ORDER_NOT_CANCELLABLE' }, { code: 'ORDER_NOT_FOUND' }],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base. This module had
  // no activation declaration at all, which resolved as "always activated" and
  // read as an omission rather than a decision. The order is the transaction
  // the platform exists to record: without it there is nothing to price, ship,
  // invoice or audit, so its absence is not a capability a client declines.
  activation: {
    nonDeactivatable: true,
    reason: 'The order is the transaction this platform exists to record.',
  },
  i18n: { bundlesDir: 'i18n' },
  // Feature 047 — transactional emails owned by this module. Default subject +
  // content are registered at runtime via the EmailDefaultsRegistry.
  transactionalEmails: [
    {
      code: 'order_confirmation',
      name: 'Order confirmation',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'customer.firstName', label: 'Customer first name', sampleValue: 'Anna' },
        { key: 'order.shippingLine', label: 'Delivery method line', sampleValue: 'Courier — 15.00 PLN' },
        { key: 'order.paymentLine', label: 'Payment method line', sampleValue: 'Card (+5.00 PLN)' },
        { key: 'order.discountsText', label: 'Applied discounts', sampleValue: '  none' },
        {
          key: 'order.summaryText',
          label: 'Order summary',
          sampleValue:
            '  Subtotal: 99.99 PLN\n  Tax: 23.00 PLN\n  Delivery: 15.00 PLN\n  Total: 137.99 PLN',
        },
        { key: 'order.shippingAddressText', label: 'Shipping address', sampleValue: '  Anna Nowak\n  ul. Główna 1' },
        { key: 'order.billingAddressText', label: 'Billing address', sampleValue: '  Acme Sp. z o.o.' },
        { key: 'order.items', label: 'Order line items (list)', sampleValue: '[{"name":"Widget A","sku":"W-A","quantity":2,"price":"120,00 PLN"},{"name":"Widget B","sku":"W-B","quantity":1,"price":"990,00 PLN"}]' },
      ],
    },
    {
      code: 'order_comment',
      name: 'Order comment notification',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'comment.body', label: 'Comment body', sampleValue: 'Your order ships tomorrow.' },
      ],
    },
    {
      code: 'reorder_created',
      name: 'Reorder created',
      group: 'orders',
      variables: [
        { key: 'order.sourceBusinessId', label: 'Source order number', sampleValue: 'ORD-1000' },
      ],
    },
    {
      code: 'admin_created_order',
      name: 'Admin-created order',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
      ],
    },
  ],
  // Feature 038 — admin search/command-palette actions.
  actions: [
    {
      id: 'open-orders',
      labelKey: 'actions.openOrders.label',
      descriptionKey: 'actions.openOrders.description',
      icon: 'ShoppingCart',
      targetRoute: '/orders',
      requiredPermission: 'orders:read',
      keywords: ['orders', 'sales', 'zamówienia', 'sprzedaż'],
      weight: 220,
    },
    {
      id: 'order-statuses',
      labelKey: 'actions.orderStatusConfig.label',
      descriptionKey: 'actions.orderStatusConfig.description',
      icon: 'Settings',
      targetRoute: '/orders/statuses',
      // The code that gates the destination: `GET /api/v1/admin/orders/statuses`
      // is `orders:read`, so a read-only operator can open the screen and this
      // action is what tells them it exists. Declaring `orders:write` — on the
      // view that the screen is a configuration editor — hid it from them
      // instead (issue #232). If the editor reading is the right one, it is the
      // route that has to change, and that is a behaviour change of its own.
      requiredPermission: 'orders:read',
      keywords: ['order status', 'lifecycle', 'statusy', 'cykl życia'],
      weight: 225,
    },
  ],
});
