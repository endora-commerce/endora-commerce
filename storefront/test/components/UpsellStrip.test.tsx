import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { UpsellStrip, type UpsellLineViewModel } from '../../components/UpsellStrip';

/**
 * Feature 027 US1 — SSR contract for UpsellStrip.
 */

const STRINGS = {
  heading: 'You might also need',
  noPriceLabel: 'Price on request',
};

const ONE_UPSELL: UpsellLineViewModel = {
  productId: 'p-up-1',
  productName: 'Premium bracket',
  productSlug: 'premium-bracket',
  unitPrice: { amount: 49.99, currency: 'PLN' },
};

describe('UpsellStrip — SSR rendering', () => {
  it('renders nothing when the list is empty', () => {
    const html = renderToString(<UpsellStrip upsells={[]} strings={STRINGS} />);
    expect(html).toBe('');
  });

  it('renders one anchor per up-sell with a price label', () => {
    const html = renderToString(
      <UpsellStrip
        upsells={[
          ONE_UPSELL,
          { ...ONE_UPSELL, productId: 'p-up-2', productSlug: 'shiny-grommet', productName: 'Shiny grommet' },
        ]}
        locale="pl-PL"
        strings={STRINGS}
      />,
    );
    expect(html).toContain('You might also need');
    expect(html).toContain('href="/p/premium-bracket"');
    expect(html).toContain('href="/p/shiny-grommet"');
    expect(html).toContain('Premium bracket');
    expect(html).toContain('Shiny grommet');
    expect(html).toMatch(/49,99\s*zł/);
  });

  it('falls back to noPriceLabel when an up-sell has no resolved price', () => {
    const html = renderToString(
      <UpsellStrip
        upsells={[{ ...ONE_UPSELL, unitPrice: null }]}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Price on request');
    expect(html).not.toContain('49.99');
  });
});
