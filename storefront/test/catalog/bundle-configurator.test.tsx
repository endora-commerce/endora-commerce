import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BundleConfigurator } from '../../components/BundleConfigurator';

/**
 * T122 — SSR contract for BundleConfigurator (feature 002 US5).
 * Pure react-dom/server.renderToString — foundation pattern.
 *
 * Pins:
 *   - Renders nothing when there are no slots (caller decides UX)
 *   - One <fieldset> per slot with a labelled select listing options
 *   - Quantity input honours min/max via HTML attributes (server-only
 *     constraint hint; client-side validation layers on top)
 *   - Required slot (minQuantity > 0) → submit CTA carries
 *     `aria-disabled="true"` so SSR users see it's blocked until they
 *     pick something. Optional slot (min=0) → CTA enabled.
 *   - Localized name from the multilingual `name` blob via the locale
 *     prop fallback chain (locale → en-US → first key).
 */

type Slot = {
  id: string;
  name: Record<string, string>;
  minQuantity: number;
  maxQuantity: number;
  position: number;
  options: Array<{
    id: string;
    defaultQuantity: number;
    position: number;
    product: {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    };
  }>;
};

const product = (id: string, sku: string, name: string, price = 19.99) => ({
  id,
  sku,
  slug: `slug-${id}`,
  name,
  primaryAssetUrl: null,
  price: { amount: price, currency: 'PLN' },
});

const slot = (
  id: string,
  name: Record<string, string>,
  minQty: number,
  maxQty: number,
  options: Slot['options'],
): Slot => ({
  id,
  name,
  minQuantity: minQty,
  maxQuantity: maxQty,
  position: 0,
  options,
});

describe('BundleConfigurator — SSR contract', () => {
  it('renders nothing when there are no slots', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="en-US"
      />,
    );
    expect(html).toBe('');
  });

  it('renders one <fieldset> per slot with a select listing options', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[
          slot('s1', { 'en-US': 'Color' }, 1, 1, [
            { id: 'o1', defaultQuantity: 1, position: 0, product: product('p1', 'P1', 'Red') },
            { id: 'o2', defaultQuantity: 1, position: 1, product: product('p2', 'P2', 'Blue') },
          ]),
        ]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="en-US"
      />,
    );
    expect(html.match(/<fieldset/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Color');
    expect(html).toContain('>Red<');
    expect(html).toContain('>Blue<');
  });

  it('quantity input carries min/max attributes from the slot', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[
          slot('s1', { 'en-US': 'Pick' }, 2, 5, [
            { id: 'o1', defaultQuantity: 2, position: 0, product: product('p1', 'P1', 'X') },
          ]),
        ]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="en-US"
      />,
    );
    expect(html).toContain('min="2"');
    expect(html).toContain('max="5"');
  });

  it('required slot (min > 0) flags the CTA as aria-disabled', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[
          slot('s1', { 'en-US': 'Pick' }, 1, 1, [
            { id: 'o1', defaultQuantity: 1, position: 0, product: product('p1', 'P1', 'X') },
          ]),
        ]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="en-US"
      />,
    );
    // CTA carries aria-disabled="true" because the slot is required and
    // SSR can't pre-populate selections.
    expect(html).toContain('aria-disabled="true"');
  });

  it('all-optional slots → CTA enabled (no aria-disabled on submit)', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[
          slot('s1', { 'en-US': 'Pick' }, 0, 1, [
            { id: 'o1', defaultQuantity: 1, position: 0, product: product('p1', 'P1', 'X') },
          ]),
        ]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="en-US"
      />,
    );
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('localizes slot name via locale → en-US → first-key fallback', () => {
    const html = renderToString(
      <BundleConfigurator
        productSlug="bundle-x"
        slots={[
          slot('s1', { 'en-US': 'Color', 'pl-PL': 'Kolor' }, 0, 1, [
            { id: 'o1', defaultQuantity: 1, position: 0, product: product('p1', 'P1', 'X') },
          ]),
        ]}
        labels={{ addToCart: 'Add to cart', requiredSlot: 'Required' }}
        locale="pl-PL"
      />,
    );
    expect(html).toContain('Kolor');
    expect(html).not.toContain('>Color<');
  });
});
