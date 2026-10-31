import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';

/**
 * Issue #85 — the reference theme's own pages speak the shop's language: the
 * built-in home page, the 404 page and the offline fallback. The home page and
 * the 404 page were Polish-only, the offline page English-only.
 *
 * Each page is an async server component: it is awaited and its tree rendered
 * on the server, with the request context and the backend reads mocked (as in
 * `test/account/quick-order-locale.test.tsx`).
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

let locale = 'en-US';
let shop = { supportEmail: '', contactEmail: '', phone: '' };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale }, modules: {} }),
}));
vi.mock('../../lib/api/catalog', () => ({
  getCategoryTree: async () => [],
  listProducts: async () => ({ data: [], pagination: { limit: 4, cursor: null, hasMore: false } }),
}));
vi.mock('../../lib/api/homepage', () => ({ getHomepageConfig: async () => ({ cmsPageSlug: null }) }));
vi.mock('../../lib/api/cms', () => ({ getCmsPageBySlug: async () => null }));
vi.mock('../../lib/api/shop', () => ({ getShopInfo: async () => shop }));
vi.mock('../../components/seo/OrganizationJsonLd', () => ({ OrganizationJsonLd: () => null }));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));

const { default: HomePage } = await import('../../app/page');
const { default: NotFound, generateMetadata: notFoundMetadata } = await import('../../app/not-found');
const { default: OfflinePage, generateMetadata: offlineMetadata } = await import('../../app/offline/page');

async function render(page: () => Promise<ReactNode>): Promise<string> {
  // Intl separates digit groups and currency codes with no-break spaces.
  return renderToString(<>{await page()}</>)
    .replaceAll('<!-- -->', '')
    .replace(/[\u00a0\u202f]/g, ' ');
}

beforeEach(() => {
  locale = 'en-US';
  shop = { supportEmail: '', contactEmail: '', phone: '' };
});

describe('the built-in home page', () => {
  it('is in English for an English shop', async () => {
    const html = await render(() => HomePage({}));
    expect(html).toContain('Industrial components');
    expect(html).toContain('available <em>off the shelf</em>.');
    expect(html).toContain('120,000+ SKUs · 84 manufacturers · ships today');
    expect(html).toContain('Browse the catalog');
    expect(html).toContain('<h2>Six key departments</h2>');
    expect(html).toContain('>Fasteners</h3>');
    expect(html).toContain('4,218 products');
    expect(html).toContain('<h4>Same-day shipping</h4>');
    expect(html).toContain('Cut-off at 2:00 PM. 98.4% of items in stock');
    expect(html).toContain('From PLN 5,000 to PLN 500,000.');
    expect(html).toContain('Dynamic load rating');
    expect(html).toContain('14.0 kN');
    expect(html).toContain('14,000 rpm');
    expect(html).toContain('in stock · 1,280 pcs · WAW-01');
    // The one Polish word left is a place name.
    expect(html.replaceAll('Okęcie', '')).not.toMatch(POLISH);
  });

  it('is in Polish for a Polish shop', async () => {
    locale = 'pl-PL';
    const html = await render(() => HomePage({}));
    expect(html).toContain('Komponenty przemysłowe');
    expect(html).toContain('dostępne <em>od ręki</em>.');
    expect(html).toContain('Przeglądaj katalog');
    expect(html).toContain('<h2>Sześć kluczowych działów</h2>');
    expect(html).toContain('>Łączniki</h3>');
    expect(html).toContain('4218 produktów');
    expect(html).toContain('Nośność dynamiczna');
    expect(html).toContain('14,0 kN');
    expect(html).toContain('obr/min');
    expect(html).toContain('Cut-off 14:00.');
    expect(html).toContain('<h4>Wysyłka tego samego dnia</h4>');
    expect(html).not.toContain('Same-day shipping');
  });
});

describe('the 404 page', () => {
  it('is in English for an English shop', async () => {
    shop = { supportEmail: 'help@example.test', contactEmail: '', phone: '' };
    const html = await render(() => NotFound());
    expect(html).toContain('Error 404 · page does not exist');
    expect(html).toContain('We could not find this page.');
    expect(html).toContain('placeholder="Find the product you are looking for…"');
    expect(html).toContain('>Search</button>');
    expect(html).toContain('Back to the home page');
    expect(html).toContain('aria-label="Most popular"');
    expect(html).toContain('6,104 products');
    expect(html).toContain('Need help?');
    expect(html).not.toMatch(POLISH);
    expect((await notFoundMetadata()).title).toBe('404 — page not found · B2B Platform');
  });

  it('is in Polish for a Polish shop', async () => {
    locale = 'pl-PL';
    const html = await render(() => NotFound());
    expect(html).toContain('Błąd 404 · strona nie istnieje');
    expect(html).toContain('Nie znaleźliśmy tej strony.');
    expect(html).toContain('>Szukaj</button>');
    expect(html).toContain('Wróć na stronę główną');
    expect(html).toContain('>Elektronika</span>');
    // 6104 ends in 4 (and not in 14): the 2–4 form, which the page's old
    // hand-written "produktów" got wrong.
    expect(html).toContain('6104 produkty');
    expect(html).toContain('4218 produktów');
    expect((await notFoundMetadata()).title).toBe('404 — strona nie została znaleziona · B2B Platform');
  });
});

describe('the offline fallback', () => {
  it('is in English for an English shop', async () => {
    const html = await render(() => OfflinePage());
    expect(html).toContain('<h1>You are offline</h1>');
    expect(html).toContain('Re-connect to the internet');
    expect((await offlineMetadata()).title).toBe('Offline');
  });

  it('is in Polish for a Polish shop', async () => {
    locale = 'pl-PL';
    const html = await render(() => OfflinePage());
    expect(html).toContain('<h1>Jesteś offline</h1>');
    expect(html).toContain('Połącz się ponownie z internetem');
    expect((await offlineMetadata()).title).toBe('Brak połączenia');
  });

  it('keeps out of the index in both', async () => {
    expect((await offlineMetadata()).robots).toEqual({ index: false, follow: false });
  });
});
