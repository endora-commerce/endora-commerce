/**
 * Shipping-method renderer registry for the transactional order-confirmation
 * e-mail (feature 035, FR-016/FR-017). An adapter may register a custom e-mail
 * renderer under a key (the adapter's `renderers.email`); when none is
 * registered, the platform default text builder is used, so the shipping
 * section always renders.
 *
 * E-mail bodies are plain text (see Mailer.MailerSendInput.text), so a renderer
 * is a `(ctx) => string` builder rather than a React component.
 */
export interface ShippingEmailContext {
  /** Resolved display name of the shipping method. */
  name: string;
  /** Flat surcharge (`price`) applied for this method (order currency). */
  cost: number;
  currency: string;
}

export type ShippingEmailRenderer = (ctx: ShippingEmailContext) => string;

export const defaultShippingEmailRenderer: ShippingEmailRenderer = (ctx) =>
  `${ctx.name} — ${ctx.cost.toFixed(2)} ${ctx.currency}`;

const registry = new Map<string, ShippingEmailRenderer>();

export function registerShippingEmailRenderer(key: string, renderer: ShippingEmailRenderer): void {
  registry.set(key, renderer);
}

export function resolveShippingEmailRenderer(rendererKey: string | null): ShippingEmailRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return defaultShippingEmailRenderer;
}
