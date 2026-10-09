import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Footer, BUILT_WITH_URL } from '../../components/Footer';

/**
 * The footer credits the platform: "Built with ❤️ using Endora Commerce", where
 * the product name links to the product site. The link carries UTM parameters,
 * so a visit that started in a shop's footer can be told apart in the product
 * site's analytics from every other referral.
 */
describe('Footer — the "built with" credit', () => {
  const html = renderToString(<Footer />);

  it('says what the shop is built with', () => {
    expect(html).toContain('Built with');
    expect(html).toContain('using');
    expect(html).toContain('>Endora Commerce</a>');
  });

  it('links the product name to the product site, tagged as a footer click', () => {
    const url = new URL(BUILT_WITH_URL);
    expect(url.origin).toBe('https://commerce.endora.software');
    expect(url.searchParams.get('utm_source')).toBe('storefront');
    expect(url.searchParams.get('utm_medium')).toBe('referral');
    expect(url.searchParams.get('utm_campaign')).toBe('built-with');
    expect(url.searchParams.get('utm_content')).toBe('footer');
    // React escapes `&` in an attribute; the rendered href is the same URL.
    expect(html).toContain(`href="${BUILT_WITH_URL.replaceAll('&', '&amp;')}"`);
  });

  it('opens the product site in a new tab without handing it the opener', () => {
    const link = /<a[^>]*commerce\.endora\.software[^>]*>/.exec(html)?.[0] ?? '';
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener"');
  });

  it('hides the heart from assistive technology, so the sentence reads as words', () => {
    expect(html).toMatch(/<span aria-hidden="true">❤️<\/span>/);
  });
});
