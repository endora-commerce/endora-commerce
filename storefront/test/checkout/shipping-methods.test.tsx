import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ShippingMethods } from '../../components/checkout/ShippingMethods';
import {
  DefaultShippingMethodRenderer,
  registerShippingMethodRenderer,
  resolveShippingMethodRenderer,
} from '../../lib/shipping-renderers/registry';
import {
  INPOST_LOCKER_RENDERER_KEY,
  InpostLockerRenderer,
} from '../../lib/shipping-renderers/inpost-locker';
import {
  geowidgetAssetUrls,
  INPOST_TARGET_POINT_FIELD,
  pointNameFromGeowidgetEvent,
  resolveGeowidgetLanguage,
  shippingAdapterDataFromFormData,
} from '../../lib/shipping-renderers/inpost-geowidget';
import type { DeliveryMethodSummary } from '../../lib/api/methods';

/**
 * T027 / T048 (US2 / US6) — the storefront Shipping methods section renders
 * eligible methods through the default renderer, communicates the empty state,
 * and resolves a custom renderer by key (falling back to the default).
 *
 * Feature 068 — InPost locker renderer registration + form → placeOrder helpers.
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

describe('InPost locker renderer (feature 068)', () => {
  it('registers under renderer key inpost_locker', () => {
    expect(resolveShippingMethodRenderer(INPOST_LOCKER_RENDERER_KEY)).toBe(InpostLockerRenderer);
  });

  it('renders the locker radio row on SSR (Geowidget panel is client-only)', () => {
    const html = renderToString(
      <ShippingMethods
        methods={[
          method('locker-1', 'InPost Parcel Locker', INPOST_LOCKER_RENDERER_KEY, 'inpost_locker'),
          method('courier-1', 'InPost Courier', null, 'inpost_courier'),
        ]}
        locale="en-US"
      />,
    );
    expect(html).toContain('InPost Parcel Locker');
    expect(html).toContain('InPost Courier');
    expect(html).toContain('value="locker-1"');
    // Courier keeps the default renderer (no Geowidget copy).
    expect(html).toContain('15.00 PLN');
  });

  it('maps geowidget host to css/script asset URLs', () => {
    expect(geowidgetAssetUrls('https://geowidget.inpost.pl/')).toEqual({
      cssUrl: 'https://geowidget.inpost.pl/inpost-geowidget.css',
      scriptUrl: 'https://geowidget.inpost.pl/inpost-geowidget.js',
    });
  });

  it('resolves Geowidget language from storefront locale', () => {
    expect(resolveGeowidgetLanguage('pl-PL')).toBe('pl');
    expect(resolveGeowidgetLanguage('en-US')).toBe('en');
    expect(resolveGeowidgetLanguage(undefined)).toBe('en');
  });

  it('parses shippingAdapterData.targetPoint from FormData for placeOrder', () => {
    const fd = new FormData();
    fd.set(INPOST_TARGET_POINT_FIELD, '  KRA010  ');
    expect(shippingAdapterDataFromFormData(fd)).toEqual({ targetPoint: 'KRA010' });

    const empty = new FormData();
    expect(shippingAdapterDataFromFormData(empty)).toBeUndefined();
  });

  it('reads point.name from Geowidget onpointselect events', () => {
    const event = new CustomEvent('onpointselect', { detail: { name: 'WAW123A' } });
    expect(pointNameFromGeowidgetEvent(event)).toBe('WAW123A');
    expect(pointNameFromGeowidgetEvent(new Event('onpointselect'))).toBeNull();

    // InPost docs use non-standard `event.details.name`.
    const legacy = new Event('onpointselect') as Event & { details?: { name: string } };
    legacy.details = { name: 'KRA010' };
    expect(pointNameFromGeowidgetEvent(legacy)).toBe('KRA010');
  });

  it('parses legacy dotted FormData field name', () => {
    const fd = new FormData();
    fd.set('shippingAdapterData.targetPoint', 'POZ01A');
    expect(shippingAdapterDataFromFormData(fd)).toEqual({ targetPoint: 'POZ01A' });
  });
});
