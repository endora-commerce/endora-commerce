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
 */
export interface ShippingEmailRendererPort {
  render(rendererKey: string | null, ctx: ShippingEmailContext): string;
}
