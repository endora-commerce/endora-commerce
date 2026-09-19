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
 *
 * `specs/134-paid-module-extraction/` T031, ruling O-1(b) — the courier
 * renderers are paid fragments and are not in this repository, so the last
 * describe pins what a storefront that has copied none of them does: it renders
 * their methods through the default renderer rather than not at all.
 */
const method = (
  id: string,
  name: string,
  rendererKey: string | null = null,
  adapter = 'manual_courier',
): DeliveryMethodSummary => ({
  id,
  code: name.toLowerCase().replace(/\s+/g, '_'),
  name: { default: name },
  cost: { amount: 15, currency: 'PLN' },
  status: 'active',
  adapter,
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
      <>
        {DefaultShippingMethodRenderer({
          method: { ...method('d3', 'Free'), cost: { amount: 0, currency: 'PLN' } },
          defaultChecked: true,
        })}
      </>,
    );
    expect(html).toContain('Free');
    expect(html).toContain('free');
  });
});

describe('a courier fragment nobody copied in', () => {
  it('falls back to the default renderer for a carrier renderer key', () => {
    // The two keys wave 1's fragments register under, asserted as absent here:
    // `registry.tsx` keeps the default renderer and registers no carrier.
    expect(resolveShippingMethodRenderer('inpost_locker')).toBe(DefaultShippingMethodRenderer);
    expect(resolveShippingMethodRenderer('dhl_parcel.pickup')).toBe(DefaultShippingMethodRenderer);
  });

  it('still renders the carrier method, with its name and cost', () => {
    const html = renderToString(
      <ShippingMethods
        methods={[
          method('locker-1', 'InPost Parcel Locker', 'inpost_locker', 'inpost_locker'),
          method('courier-1', 'InPost Courier', null, 'inpost_courier'),
        ]}
        locale="en-US"
      />,
    );
    expect(html).toContain('InPost Parcel Locker');
    expect(html).toContain('InPost Courier');
    expect(html).toContain('value="locker-1"');
    expect(html).toContain('15.00 PLN');
  });
});
