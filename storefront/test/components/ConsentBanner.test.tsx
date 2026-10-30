import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConsentBanner } from '../../components/analytics/ConsentBanner';

/**
 * Issue #85: the cookie-consent banner's dialog name and both buttons were
 * Polish literals, so a shop running in English asked its visitors for consent
 * in Polish. The banner is server-rendered hidden (its effect only opens it),
 * which is what makes the labels assertable from `renderToString`.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

function render(locale: string): string {
  return renderToString(<ConsentBanner platforms={[]} message="cms message" locale={locale} />);
}

describe('ConsentBanner speaks the page language', () => {
  it('renders the dialog name and both choices in English for an English shop', () => {
    const html = render('en-US');
    expect(html).toContain('aria-label="Cookie consent"');
    expect(html).toContain('>Decline<');
    expect(html).toContain('>Accept<');
    expect(html).not.toMatch(POLISH);
  });

  it('renders them in Polish for a Polish shop', () => {
    const html = render('pl-PL');
    expect(html).toContain('aria-label="Zgoda na pliki cookie"');
    expect(html).toContain('>Odrzuć<');
    expect(html).toContain('>Akceptuję<');
    expect(html).not.toContain('Cookie consent');
  });

  it('leaves the operator-written message as it was given', () => {
    expect(render('en-US')).toContain('cms message');
  });
});
