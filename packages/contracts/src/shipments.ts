/**
 * `shipments` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * One inbound site, and it is the delivery-side twin of the one `payments`
 * published in wave 1: the order-confirmation e-mail renders a shipping line,
 * and `orders` reaches this module's renderer registry for it.
 *
 * Plain TypeScript rather than Zod: this describes an in-process call. The
 * module's HTTP shapes live in `shipping-methods.ts`, which is
 * `delivery_methods`' contracts file and covers the shipment record too.
 */

/** What the order-confirmation e-mail knows about the shipping method. */
export interface ShippingEmailContext {
  /** Resolved display name of the shipping method. */
  name: string;
  /** Flat surcharge (`price`) applied for this method, in the order currency. */
  cost: number;
  currency: string;
}

/**
 * Container name: `shippingEmailRendererPort`. Owner: `shipments`.
 *
 * A shipping adapter may register a custom renderer under a key (feature 035,
 * FR-016/FR-017); when none is registered the platform default is used, so the
 * shipping section always renders.
 *
 * `orders` reaches the resolver today and then calls the function it gets
 * back. The port collapses those two steps for the reason its payment twin
 * gives: a consumer that resolved a renderer and got `undefined` would have to
 * hold a copy of the default text, and two copies of a default are how a
 * default stops being one.
 *
 * Bodies are plain text (see `EmailMailerSendInput.text`), so a renderer is a
 * `(ctx) => string` builder rather than a component.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `shipments` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface ShippingEmailRendererPort {
  render(rendererKey: string | null, ctx: ShippingEmailContext): string;
}

/**
 * Container name: `shipmentUsagePort`. Owner: `shipments`.
 *
 * "Has this delivery method ever shipped anything?" — the one question
 * `delivery_methods` has to ask before it deletes a method row (feature 035,
 * FR-003; feature 077, D-87).
 *
 * It asked it in raw SQL until feature 075 drained the shard:
 * `select count(*) from "shipments" where "delivery_method_id" = ?`, inside the
 * delete Command's own transaction. The statement named no import specifier, so
 * the boundary it crossed compiled and returned rows.
 *
 * **`shipments.delivery_method_id` carries no foreign key** — the table was
 * created without one — so this count is the only thing standing between a
 * delete and permanently orphaned shipment history. That is why the answer is
 * asked of the owner rather than approximated, and why the caller refuses the
 * delete when it cannot get one.
 *
 * The count runs on this module's own `EntityManager`, so it is outside any
 * transaction the caller has open. That costs nothing here: `shipments` is a
 * table the delete transaction never writes, so there is no write of its own
 * for the read to be blind to, and the race a cross-module read cannot close —
 * a shipment created between the count and the commit — was equally open to the
 * in-transaction statement this replaced, which took no lock either.
 *
 * **Owner off:** `delivery_methods` decides this module's presence *before* it
 * resolves the port and refuses the delete with a sentence naming this module,
 * rather than resolving a gate and catching it — see its manifest's
 * `nonBindingDependencies` entry. The edge is non-binding because `shipments`
 * declares `delivery_methods`, so declaring it back closes a cycle, and
 * acknowledging it would make `shipments` unswitchable for as long as delivery
 * methods are present.
 */
export interface ShipmentUsagePort {
  /** How many shipment rows — of any status — reference this delivery method. */
  countForDeliveryMethod(deliveryMethodId: string): Promise<number>;
}
