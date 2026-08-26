import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ShippingMethods } from '../../components/checkout/ShippingMethods';
import {
  DefaultShippingMethodRenderer,
  registerShippingMethodRenderer,
  resolveShippingMethodRenderer,
} from '../../lib/shipping-renderers/registry';
import type { DeliveryMethodSummary } from '../../lib/api/methods';

/**
 * T027 / T048 (US2 / US6) — the storefront Shipping methods section renders
 * eligible methods through the default renderer, communicates the empty state,
 * and resolves a custom renderer by key (falling back to the default).
 */
const method = (id: string, name: string, rendererKey: string | null = null): DeliveryMethodSummary => ({
  id,
  code: name.toLowerCase(),
  name: { default: name },
  cost: { amount: 15, currency: 'PLN' },
  status: 'active',
  adapter: 'manual_courier',
  rendererKey,
});

describe('ShippingMethods section', () => {
  it('renders one radio per eligible method with its name and cost', () => {
    const html = renderToString(
      <ShippingMethods methods={[method('d1', 'Courier'), method('d2', 'Pickup')]} />,
    );
    expect(html).toContain('Courier');
    expect(html).toContain('Pickup');
    expect(html).toContain('15.00 PLN');
    expect(html).toContain('name="deliveryMethodId"');
  });

  it('communicates the empty state instead of an actionable empty list', () => {
    const html = renderToString(<ShippingMethods methods={[]} locale="en-US" />);
    expect(html).toContain('No delivery method is available');
    expect(html).not.toContain('name="deliveryMethodId"');
  });

  it('localizes the shipping section for pl-PL', () => {
    const html = renderToString(<ShippingMethods methods={[]} locale="pl-PL" />);
    expect(html).toContain('Metoda dostawy');
    expect(html).toContain('Brak dostępnych metod dostawy');
  });
});

describe('shipping-renderer registry', () => {
  it('falls back to the default renderer for null/unknown keys', () => {
    expect(resolveShippingMethodRenderer(null)).toBe(DefaultShippingMethodRenderer);
    expect(resolveShippingMethodRenderer('nope')).toBe(DefaultShippingMethodRenderer);
  });

  it('uses a registered custom renderer when its key resolves', () => {
    const fn = (): null => null;
    registerShippingMethodRenderer('vendor.ship', fn);
    expect(resolveShippingMethodRenderer('vendor.ship')).toBe(fn);
  });

  it('default renderer shows free when cost is zero', () => {
    const html = renderToString(
      <>{DefaultShippingMethodRenderer({ method: { ...method('d3', 'Free'), cost: { amount: 0, currency: 'PLN' } }, defaultChecked: true })}</>,
    );
    expect(html).toContain('Free');
    expect(html).toContain('free');
  });
});
