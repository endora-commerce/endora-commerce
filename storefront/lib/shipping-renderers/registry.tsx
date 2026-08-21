import type { ReactNode } from 'react';
import type { DeliveryMethodSummary } from '../api/methods';

/**
 * Storefront shipping-method renderer registry (feature 035, FR-016/FR-017).
 *
 * Each delivery method may declare a `rendererKey`; an adapter module can
 * register a custom renderer under that key. When a method has no renderer (or
 * the key is unknown), the platform default renderer is used — so every
 * eligible method always renders (the radio-row picker matching
 * `specs/b2b-platform-storefront-ui/examples/checkout/one-step-checkout.png`).
 */
export interface ShippingMethodRenderProps {
  method: DeliveryMethodSummary;
  defaultChecked: boolean;
  /** Active storefront locale (PL/EN) for adapter-specific copy. */
  locale?: string | undefined;
}

export type ShippingMethodRenderer = (props: ShippingMethodRenderProps) => ReactNode;

function pickName(name: Record<string, string>): string {
  return name.default ?? name['en-US'] ?? name.en ?? Object.values(name)[0] ?? '';
}

export const DefaultShippingMethodRenderer: ShippingMethodRenderer = ({ method, defaultChecked }) => (
  <label style={{ display: 'block' }}>
    <input
      type="radio"
      name="deliveryMethodId"
      value={method.id}
      defaultChecked={defaultChecked}
      data-adapter={method.adapter}
    />{' '}
    {pickName(method.name)}
    {method.cost.amount > 0 ? (
      <span className="muted">{` — ${method.cost.amount.toFixed(2)} ${method.cost.currency}`}</span>
    ) : (
      <span className="muted"> — free</span>
    )}
  </label>
);

/** Alias used when an adapter's renderer is missing — renders the default row. */
export const MissingShippingMethodRenderer = DefaultShippingMethodRenderer;

const registry = new Map<string, ShippingMethodRenderer>();

export function registerShippingMethodRenderer(key: string, renderer: ShippingMethodRenderer): void {
  registry.set(key, renderer);
}

export function resolveShippingMethodRenderer(rendererKey: string | null): ShippingMethodRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return DefaultShippingMethodRenderer;
}
