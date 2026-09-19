import { describe, expect, it } from 'vitest';

import {
  SHIPPING_ADAPTER_DATA_PREFIX,
  ensureShippingAdapterDataOnFormData,
  mergeShippingAdapterDataInputs,
  shippingAdapterDataFromFormData,
} from '../../lib/checkout/shipping-adapter-data';

/**
 * The free storefront's carrier-neutral `shippingAdapterData` seam
 * (`specs/134-paid-module-extraction/` T031, ruling O-1(b)).
 *
 * The courier pickers themselves are paid fragments and are not in this
 * repository, so what is asserted here is the half that stays: a field-name
 * convention a copied-in fragment writes to, and the free checkout reading it
 * into `placeOrder`'s `shippingAdapterData` without naming a vendor.
 *
 * `mergeShippingAdapterDataInputs` exists as a separate export because the
 * storefront suite is SSR-only — `renderToString`, `environment: 'node'`, no
 * jsdom and no React Testing Library — so the DOM-reading wrapper is proved to
 * be a no-op without a document and the logic is proved through the pure half.
 */
describe('shippingAdapterDataFromFormData', () => {
  it('collects every prefixed field into adapter data, trimmed', () => {
    const fd = new FormData();
    fd.set(`${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, '  KRA010  ');
    fd.set(`${SHIPPING_ADAPTER_DATA_PREFIX}servicePointId`, 'POP-77');

    expect(shippingAdapterDataFromFormData(fd)).toEqual({
      targetPoint: 'KRA010',
      servicePointId: 'POP-77',
    });
  });

  it('is undefined when no adapter contributed a field', () => {
    const fd = new FormData();
    fd.set('deliveryMethodId', 'dm-1');

    expect(shippingAdapterDataFromFormData(fd)).toBeUndefined();
  });

  it('ignores a prefixed field that is blank or has no key after the prefix', () => {
    const fd = new FormData();
    fd.set(`${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, '   ');
    fd.set(SHIPPING_ADAPTER_DATA_PREFIX, 'no key at all');

    expect(shippingAdapterDataFromFormData(fd)).toBeUndefined();
  });

  it('names no vendor: an unprefixed vendor field is not adapter data', () => {
    const fd = new FormData();
    fd.set('inpostTargetPoint', 'KRA010');

    expect(shippingAdapterDataFromFormData(fd)).toBeUndefined();
  });
});

describe('mergeShippingAdapterDataInputs', () => {
  it('carries an input rendered outside the form onto the FormData', () => {
    const fd = new FormData();

    mergeShippingAdapterDataInputs(fd, [
      { name: `${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, value: 'WAW123A' },
    ]);

    expect(fd.get(`${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`)).toBe('WAW123A');
  });

  it('does not overwrite a value the form already submitted', () => {
    const fd = new FormData();
    fd.set(`${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, 'POZ01A');

    mergeShippingAdapterDataInputs(fd, [
      { name: `${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, value: 'WAW123A' },
    ]);

    expect(fd.get(`${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`)).toBe('POZ01A');
  });

  it('skips an input that is not adapter data and one with no value', () => {
    const fd = new FormData();

    mergeShippingAdapterDataInputs(fd, [
      { name: 'deliveryMethodId', value: 'dm-1' },
      { name: `${SHIPPING_ADAPTER_DATA_PREFIX}targetPoint`, value: '  ' },
    ]);

    expect([...fd.keys()]).toEqual([]);
  });
});

describe('ensureShippingAdapterDataOnFormData', () => {
  it('is a no-op without a document, so a server render cannot throw', () => {
    const fd = new FormData();
    fd.set('deliveryMethodId', 'dm-1');

    expect(() => ensureShippingAdapterDataOnFormData(fd)).not.toThrow();
    expect([...fd.keys()]).toEqual(['deliveryMethodId']);
  });
});
