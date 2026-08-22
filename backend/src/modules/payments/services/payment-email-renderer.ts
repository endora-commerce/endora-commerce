/**
 * Payment-method renderer registry for the transactional order-confirmation
 * e-mail (feature 034, FR-016/FR-017). An adapter may register a custom
 * e-mail renderer under a key (the adapter's `renderers.email`); when none is
 * registered, the platform default text builder is used, so the payment
 * section always renders.
 *
 * E-mail bodies are plain text (see Mailer.MailerSendInput.text), so a renderer
 * is a `(ctx) => string` builder rather than a React component.
 */
import type { PaymentEmailContext } from '@endora-commerce/contracts';

/**
 * `PaymentEmailContext` moved to `@endora-commerce/contracts` in feature 075's Phase P —
 * `orders` renders the payment line with it. Re-exported here for the length
 * of Phase P, which cuts no consumer.
 */
export type { PaymentEmailContext };

export type PaymentEmailRenderer = (ctx: PaymentEmailContext) => string;

export const defaultPaymentEmailRenderer: PaymentEmailRenderer = (ctx) => {
  const surcharge =
    ctx.additionalPrice > 0 ? ` (+${ctx.additionalPrice.toFixed(2)} ${ctx.currency})` : '';
  return `${ctx.name}${surcharge}`;
};

const registry = new Map<string, PaymentEmailRenderer>();

export function registerPaymentEmailRenderer(key: string, renderer: PaymentEmailRenderer): void {
  registry.set(key, renderer);
}

export function resolvePaymentEmailRenderer(rendererKey: string | null): PaymentEmailRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return defaultPaymentEmailRenderer;
}
