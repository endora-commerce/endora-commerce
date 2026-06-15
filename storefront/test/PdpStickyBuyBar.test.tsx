import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PdpStickyBuyBar } from '../components/mobile/PdpStickyBuyBar';
import { PdpPriceToggle } from '../components/pricing/PdpPriceToggle';

/**
 * Feature 044 / US3 — sticky PDP buy bar + net/gross price toggle.
 *
 * SSR-rendered structural assertions (the repo's convention): the bar renders
 * the stepper + add-to-cart + (conditional) datasheet; the price toggle renders
 * both NETTO/BRUTTO controls and a net price on first paint. The stepper's
 * increment and the toggle's switch are effects exercised on a real device.
 */

const noop = async (): Promise<void> => {};

describe('PdpStickyBuyBar', () => {
  it('renders the quantity stepper, add-to-cart label and product id', () => {
    const html = renderToString(
      <PdpStickyBuyBar
        productId="prod-1"
        addToCartAction={noop}
        addToCartLabel="Do koszyka"
      />,
    );
    expect(html).toContain('m-actionbar');
    expect(html).toContain('qty__stepper');
    expect(html).toContain('Do koszyka');
    expect(html).toContain('name="productId"');
    expect(html).toContain('prod-1');
  });

  it('renders the datasheet shortcut only when a href is supplied', () => {
    const withDoc = renderToString(
      <PdpStickyBuyBar
        productId="p"
        addToCartAction={noop}
        addToCartLabel="Do koszyka"
        datasheetHref="https://cdn/x.pdf"
      />,
    );
    expect(withDoc).toContain('https://cdn/x.pdf');

    const without = renderToString(
      <PdpStickyBuyBar productId="p" addToCartAction={noop} addToCartLabel="Do koszyka" />,
    );
    expect(without).not.toContain('href="https');
  });
});

describe('PdpPriceToggle', () => {
  it('renders both NETTO/BRUTTO controls and a price block', () => {
    const html = renderToString(
      <PdpPriceToggle
        basePrice={{ amount: '100.00', currency: 'PLN' }}
        salePrice={null}
        locale="pl-PL"
        labels={{ net: 'NETTO', gross: 'BRUTTO' }}
      />,
    );
    expect(html).toContain('NETTO');
    expect(html).toContain('BRUTTO');
    expect(html).toContain('b2b-pricing-block');
    expect(html).toContain('role="radiogroup"');
  });
});
