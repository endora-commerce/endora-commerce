import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { VirtualCta } from '../../components/VirtualCta';

/**
 * Storefront SSR contract for VirtualCta (feature 002 US5, T145).
 *
 * Pins:
 *   - Renders an emphasized "Buy and download" CTA
 *   - Mentions digital delivery in the copy (so buyers know what they get)
 *   - Renders nothing when neither downloadAssetId nor downloadUrl is set
 */

const noop = (): void => undefined;

describe('VirtualCta — SSR contract', () => {
  it('renders nothing when virtual is null/empty', () => {
    const html = renderToString(
      <VirtualCta
        productId="00000000-0000-4000-8000-0000000000aa"
        virtual={{ downloadAssetId: null, downloadUrl: null }}
        labels={{ buyAndDownload: 'Buy and download', digitalDelivery: 'Digital delivery — instant access' }}
        addToCartAction={noop}
      />,
    );
    expect(html).toBe('');
  });

  it('renders the buy CTA as an add-to-cart form when downloadUrl is set', () => {
    const html = renderToString(
      <VirtualCta
        productId="00000000-0000-4000-8000-0000000000bb"
        virtual={{ downloadAssetId: null, downloadUrl: 'https://example.test/file.pdf' }}
        labels={{ buyAndDownload: 'Buy and download', digitalDelivery: 'Digital delivery — instant access' }}
        addToCartAction={noop}
      />,
    );
    expect(html).toContain('Buy and download');
    expect(html).toContain('Digital delivery');
    // It submits a form carrying the productId (so it actually adds to the
    // cart) rather than being a bare link to /cart.
    expect(html).toContain('<form');
    expect(html).toContain('00000000-0000-4000-8000-0000000000bb');
  });

  it('renders the buy CTA when downloadAssetId is set', () => {
    const html = renderToString(
      <VirtualCta
        productId="00000000-0000-4000-8000-0000000000cc"
        virtual={{ downloadAssetId: '00000000-0000-4000-8000-000000000001', downloadUrl: null }}
        labels={{ buyAndDownload: 'Buy and download', digitalDelivery: 'Digital delivery — instant access' }}
        addToCartAction={noop}
      />,
    );
    expect(html).toContain('Buy and download');
  });
});
