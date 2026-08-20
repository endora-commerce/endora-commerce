import type { PaymentEmailRendererPort, ShippingEmailRendererPort } from '@b2b/contracts';

/**
 * The order-confirmation e-mail's two adapter lines, for a deployment where the
 * module that owns the renderer registry is not effectively present.
 *
 * **Why this exists at all (feature 075).** `payments` and `shipments` each host
 * a registry an adapter may push a custom renderer into (feature 034
 * FR-016/FR-017, feature 035), and each publishes it as a gated port. `orders`
 * declares both in `nonBindingDependencies` as `degrades-without`, because the
 * alternative — declaring them in `dependencies` — closes a cycle (`payments`
 * and `shipments` both declare `orders`) and, through `acknowledgedDependencies`,
 * would make two deactivatable modules undeactivatable for as long as the
 * platform takes orders. A buyer who paid on invoice must still receive their
 * confirmation.
 *
 * So this file is the wording an order confirmation carries when there is no
 * gateway and no carrier module to ask. It reads like the platform default in
 * each of those two modules, and that is not an accident: with the owner absent
 * no adapter has registered anything, so the only line left to render is the
 * method snapshot `orders` stores itself. What is duplicated is two format
 * strings; what is not duplicated is the registry, the key lookup or the
 * capability — those stay with their owners and are reached through the ports
 * whenever the owners are present.
 */

/** `${name}` plus the method's surcharge when it has one. */
export const noGatewayPaymentLineRenderer: PaymentEmailRendererPort = {
  render: (_rendererKey, ctx) => {
    const surcharge =
      ctx.additionalPrice > 0 ? ` (+${ctx.additionalPrice.toFixed(2)} ${ctx.currency})` : '';
    return `${ctx.name}${surcharge}`;
  },
};

/** `${name} — ${cost} ${currency}`. */
export const noCarrierShippingLineRenderer: ShippingEmailRendererPort = {
  render: (_rendererKey, ctx) => `${ctx.name} — ${ctx.cost.toFixed(2)} ${ctx.currency}`,
};
