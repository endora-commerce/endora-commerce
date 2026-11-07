import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ModulePresenceSet } from '../../lib/api/module-presence';

/**
 * Issue #85 — the storefront's chrome speaks the shop's language: the header
 * and footer (Polish-only before), the support-session banner and the mobile
 * tab bar (English-only), and the smaller labels around them. Each is rendered
 * on the server in `en-US` and `pl-PL`.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
/** Every module present: the presence gates are `test/account/module-presence-nav.test.tsx`'s. */
const ALL_PRESENT: ModulePresenceSet = { isPresent: () => true, presentIds: [], absentIds: [] };

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({ countries: [], currencies: [], languages: [], resolveByCode: async () => null }),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsBlockByCode: async () => {
    throw new Error('cms is off');
  },
}));

const { Header } = await import('../../components/Header');
const { Footer } = await import('../../components/Footer');
const { ImpersonationBanner } = await import('../../components/ImpersonationBanner');
const { Breadcrumbs } = await import('../../components/Breadcrumbs');
const { MobileTabBar } = await import('../../components/mobile/MobileTabBar');
const { GoogleTagManager } = await import('../../components/analytics/GoogleTagManager');
const { CookieConsentMessage } = await import('../../components/analytics/CookieConsentMessage');
const { GET: manifest } = await import('../../app/manifest.webmanifest/route');
const { tForLocale } = await import('../../lib/i18n/messages');

function clean(html: string): string {
  return html.replaceAll('<!-- -->', '').replace(/[  ]/g, ' ');
}

function header(locale: string): string {
  return clean(
    renderToString(
      <Header
        config={{ defaultLanguageCode: locale } as never}
        locale={locale}
        salesChannelCode="retail"
        cartItemCount={0}
        megamenu={null}
        user={null}
        modules={ALL_PRESENT}
      />,
    ),
  );
}

describe('Header', () => {
  it('is in English for an English shop', () => {
    const html = header('en-US');
    expect(html).toContain('Ships today if you order by 2:00 PM');
    expect(html).toContain('VAT invoice');
    expect(html).toContain('<strong>Tax ID</strong>');
    expect(html).toContain('Currency:');
    expect(html).toContain('B2B · Industrial components');
    expect(html).toContain('aria-label="Compare products"');
    expect(html).toContain('aria-label="Cart"');
    expect(html).toContain('aria-label="Quote request"');
    expect(html).not.toMatch(POLISH);
  });

  it('is in Polish for a Polish shop', () => {
    const html = header('pl-PL');
    expect(html).toContain('Wysyłka dziś, jeśli zamówisz do 14:00');
    expect(html).toContain('Faktura VAT');
    expect(html).toContain('<strong>NIP</strong>');
    expect(html).toContain('Waluta:');
    expect(html).toContain('B2B · Komponenty przemysłowe');
    expect(html).toContain('aria-label="Porównaj produkty"');
    expect(html).toContain('aria-label="Koszyk"');
    expect(html).toContain('aria-label="Zapytanie ofertowe"');
  });

  it('keeps the brand the same in both', () => {
    for (const locale of ['en-US', 'pl-PL']) {
      expect(header(locale)).toContain('>IN</span>');
      expect(header(locale)).toContain('Industria');
    }
  });

  it('hands the counted badges a template that is right for every count', () => {
    expect(tForLocale('pl-PL')('chrome.header.cartItems')).toBe('Koszyk · liczba pozycji: {count}');
    expect(tForLocale('en-US')('chrome.header.quoteRequestItems')).toBe('Quote request · items: {count}');
  });
});

describe('Footer', () => {
  it('is in English for an English shop', () => {
    const html = clean(renderToString(<Footer locale="en-US" modules={ALL_PRESENT} />));
    expect(html).toContain('>Shop</h5>');
    expect(html).toContain('>Catalog</a>');
    expect(html).toContain('>Fasteners</a>');
    expect(html).toContain('>B2B account</h5>');
    expect(html).toContain('>RFQ — quote requests</a>');
    expect(html).toContain('>Returns and complaints</a>');
    expect(html).toContain('placeholder="name@company.com"');
    expect(html).toContain('>Subscribe</button>');
    expect(html).toContain('Tax ID (NIP) 7251234567');
    expect(html).toContain('Terms and conditions');
    expect(html).toContain('Built with <span aria-hidden="true">❤️</span> using');
    expect(html).not.toMatch(POLISH);
  });

  it('is in Polish for a Polish shop', () => {
    const html = clean(renderToString(<Footer locale="pl-PL" modules={ALL_PRESENT} />));
    expect(html).toContain('>Sklep</h5>');
    expect(html).toContain('>Katalog</a>');
    expect(html).toContain('>Łączniki</a>');
    expect(html).toContain('>Konto B2B</h5>');
    expect(html).toContain('>Reklamacje i zwroty</a>');
    expect(html).toContain('placeholder="adres@firma.pl"');
    expect(html).toContain('>Zapisz się</button>');
    expect(html).toContain('Polityka prywatności');
    expect(html).toContain('Zbudowane z <span aria-hidden="true">❤️</span> przy użyciu');
    expect(html).toContain('>Endora Commerce</a>');
  });

  it('keeps the operator’s support links as they were given', () => {
    const html = renderToString(<Footer locale="en-US" modules={ALL_PRESENT} cmsLinks={[{ path: 'faq', title: 'Pytania' }]} />);
    expect(html).toContain('>Pytania</a>');
    expect(html).not.toContain('Help center');
  });
});

/**
 * Issue #673 — the chrome linked to `/invoices`, `/credit-limit` and `/help`,
 * which no storefront route serves, so each one answered 404. All three are
 * gone: invoices live on the order detail page, the credit-limit widget on
 * `/account`, and help in the footer's CMS-driven support column.
 */
describe('dead chrome links (#673)', () => {
  const DEAD = /href="[^"]*\/(invoices|credit-limit|help)(["?#/])/;

  it('the top bar has no help link', () => {
    for (const locale of ['en-US', 'pl-PL']) {
      const html = header(locale);
      expect(html).not.toMatch(DEAD);
      expect(html).not.toContain('B2B support');
      expect(html).not.toContain('Wsparcie B2B');
    }
  });

  it('the footer has no invoices or credit-limit link, with every module present', () => {
    for (const locale of ['en-US', 'pl-PL']) {
      const html = clean(renderToString(<Footer locale={locale} modules={ALL_PRESENT} />));
      expect(html).not.toMatch(DEAD);
      expect(html).not.toContain('>Invoices</a>');
      expect(html).not.toContain('>Faktury</a>');
      expect(html).not.toContain('>Credit limit</a>');
      expect(html).not.toContain('>Limit kredytowy</a>');
      // The links that do lead somewhere stay.
      expect(html).toMatch(/href="[^"]*\/orders"/);
      expect(html).toMatch(/href="[^"]*\/account"/);
    }
  });
});

describe('ImpersonationBanner', () => {
  it('says the support session in English', () => {
    const html = clean(renderToString(<ImpersonationBanner impersonatorAdminUserId="abcdef0123456789" locale="en-US" />));
    expect(html).toContain('<strong>Support session active.</strong>');
    expect(html).toContain('An administrator (<code>abcdef01</code>) is signed in as you.');
    expect(html).toContain('End support session');
  });

  it('says it in Polish', () => {
    const html = clean(renderToString(<ImpersonationBanner impersonatorAdminUserId="abcdef0123456789" locale="pl-PL" />));
    expect(html).toContain('<strong>Trwa sesja wsparcia.</strong>');
    expect(html).toContain('Administrator (<code>abcdef01</code>) jest zalogowany jako Ty.');
    expect(html).toContain('Zakończ sesję wsparcia');
  });
});

describe('the smaller chrome labels', () => {
  it('names the breadcrumb trail in the page language', () => {
    const crumbs = [{ href: '/', label: 'Home' }, { href: null, label: 'Here' }];
    expect(renderToString(<Breadcrumbs crumbs={crumbs} locale="en-US" />)).toContain('aria-label="Breadcrumb"');
    expect(renderToString(<Breadcrumbs crumbs={crumbs} locale="pl-PL" />)).toContain('aria-label="Ścieżka nawigacji"');
  });

  it('names the mobile tab bar from the labels it is given', () => {
    const labels = { home: 'Start', quoteRequest: 'Q', quickOrder: 'QO', cart: 'K', account: 'A' };
    const html = renderToString(
      <MobileTabBar present={{ quoteRequests: true, quickOrder: true }} labels={{ ...labels, navigation: tForLocale('pl-PL')('chrome.mobileTabBar.label') }} />,
    );
    expect(html).toContain('aria-label="Nawigacja mobilna"');
  });

  it('titles the Tag Manager frame', () => {
    const config = { enabled: true, containerId: 'GTM-ABC123', requireConsent: true, serverSide: false };
    expect(renderToString(<GoogleTagManager config={config} locale="pl-PL" />)).toContain('title="Google Tag Manager"');
  });

  it('falls back to a consent message in the page language', async () => {
    const en = renderToString(<>{await CookieConsentMessage({ ctx: { locale: 'en-US' } })}</>);
    const pl = renderToString(<>{await CookieConsentMessage({ ctx: { locale: 'pl-PL' } })}</>);
    expect(en).toContain('We use cookies for analytics (Google Analytics).');
    expect(pl).toContain('Używamy plików cookie do analityki (Google Analytics).');
  });

  it('describes the web app in the browser’s language', async () => {
    const description = async (acceptLanguage: string): Promise<string> =>
      ((await (await manifest(new Request('http://shop.test/manifest.webmanifest', {
        headers: { 'accept-language': acceptLanguage },
      }))).json()) as { description: string }).description;
    expect(await description('pl-PL,pl;q=0.9')).toBe('Sklep internetowy B2B');
    expect(await description('en-US,en;q=0.9')).toBe('B2B commerce storefront');
  });
});
