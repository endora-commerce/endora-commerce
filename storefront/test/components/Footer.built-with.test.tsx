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
  const html = renderToString(<Footer locale="en-US" />);

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

/**
 * The credit is the footer's last line, on a row of its own: under the columns,
 * under the copyright row and under anything a module adds through the
 * `footer.bottom` and `footer.copyright` hooks. It carries the product mark
 * beside the product name.
 */
describe('Footer — where the "built with" credit sits', () => {
  const html = renderToString(
    <Footer locale="en-US" bottom={<p>hook-bottom-slot</p>} copyright={<span>hook-copyright-slot</span>} />,
  );
  const credit = html.indexOf('Built with');

  it('comes after everything else the footer renders', () => {
    for (const earlier of [
      'Industria B2B Sp. z o.o.',
      'hook-bottom-slot',
      'hook-copyright-slot',
      'Privacy policy',
      'Cookies',
    ]) {
      expect(html).toContain(earlier);
      expect(html.indexOf(earlier)).toBeLessThan(credit);
    }
  });

  it('is the last link in the footer', () => {
    const lastLink = html.slice(html.lastIndexOf('<a '));
    expect(lastLink).toContain('commerce.endora.software');
    expect(lastLink).toContain('>Endora Commerce</a>');
  });

  it('shows the product mark inside the link, hidden from assistive technology', () => {
    const link = /<a[^>]*commerce\.endora\.software[^>]*>.*?<\/a>/s.exec(html)?.[0] ?? '';
    expect(link).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
