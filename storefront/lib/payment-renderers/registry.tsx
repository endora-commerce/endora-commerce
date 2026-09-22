import type { ReactNode } from 'react';
import type { PaymentMethodSummary } from '../api/methods';
import { PaymentMethodIcon } from './icons';

/**
 * Storefront payment-method renderer registry (feature 034, FR-016/FR-017).
 *
 * Each payment method may declare a `rendererKey`; an adapter module can
 * register a custom renderer under that key. When a method has no renderer (or
 * the key is unknown), the platform default renderer is used — so every
 * eligible method always renders (the radio-row picker matching
 * `specs/b2b-platform-storefront-ui/examples/checkout/one-step-checkout.png`).
 *
 * **This file registers no gateway, deliberately.** A gateway's checkout UI is
 * the gateway's own storefront code: for a module distributed separately it
 * arrives as a fragment the shop copies into its scaffolded storefront, which
 * then calls `registerPaymentMethodRenderer` here
 * (`specs/134-paid-module-extraction/`, ruling O-1(b); D-195 makes the
 * storefront the client's). Until a shop does that, its gateway methods render
 * through the default row — which is FR-017's fallback doing exactly the job it
 * was written for, not a degradation.
 */
export interface PaymentMethodRenderProps {
  method: PaymentMethodSummary;
  defaultChecked: boolean;
  currency?: string | undefined;
  locale?: string | undefined;
}

export type PaymentMethodRenderer = (props: PaymentMethodRenderProps) => ReactNode;

function pickName(name: Record<string, string>): string {
  return name.default ?? name['en-US'] ?? name.en ?? Object.values(name)[0] ?? '';
}

export const DefaultPaymentMethodRenderer: PaymentMethodRenderer = ({
  method,
  defaultChecked,
  currency,
}) => (
  <label style={{ display: 'flex', alignItems: 'center' }}>
    <input type="radio" name="paymentMethodId" value={method.id} defaultChecked={defaultChecked} />{' '}
    <PaymentMethodIcon method={method} />
    {pickName(method.name)}
    {method.additionalPrice > 0 ? (
      <span className="muted">{` +${method.additionalPrice.toFixed(2)}${currency ? ` ${currency}` : ''}`}</span>
    ) : null}
  </label>
);

const registry = new Map<string, PaymentMethodRenderer>();

export function registerPaymentMethodRenderer(key: string, renderer: PaymentMethodRenderer): void {
  registry.set(key, renderer);
}

export function resolvePaymentMethodRenderer(rendererKey: string | null): PaymentMethodRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return DefaultPaymentMethodRenderer;
}
