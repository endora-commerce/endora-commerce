import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * Issue #85 — the chrome's client islands speak the page's language: the PWA
 * install prompt (which used to guess the language from `<html lang>` after
 * hydration), the push opt-in and update banners (English-only), the mobile
 * search overlay (Polish-only) and the dictionary pickers (English-only).
 *
 * Each of them shows its copy only in a state an effect or a click puts it in,
 * and the storefront's tests render on the server, where neither runs. So the
 * state is seeded: `useState` answers the queued values, in the order the
 * component asks, and its own initial value once the queue is empty.
 */
const seeded: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = ((initial: unknown) =>
    seeded.length > 0 ? [seeded.shift(), () => {}] : actual.useState(initial)) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

let dictionaryLocale: string | undefined = 'en-US';
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({
    locale: dictionaryLocale,
    countries: [{ code: 'PL', label: 'Poland', sortOrder: 0 }],
    currencies: [{ code: 'PLN', label: 'Polish złoty', sortOrder: 0 }],
    languages: [{ code: 'pl-PL', label: 'Polish', sortOrder: 0 }],
    resolveByCode: async () => null,
  }),
}));

const { InstallPrompt } = await import('../../components/pwa/InstallPrompt');
const { PushOptIn } = await import('../../components/pwa/PushOptIn');
const { PwaRegister } = await import('../../components/PwaRegister');
const { MobileSearchOverlay } = await import('../../components/mobile/MobileSearchOverlay');
const { CountryPicker } = await import('../../lib/dictionary/pickers/CountryPicker');
const { CurrencyPicker } = await import('../../lib/dictionary/pickers/CurrencyPicker');
const { LanguagePicker } = await import('../../lib/dictionary/pickers/LanguagePicker');

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

beforeEach(() => {
  seeded.length = 0;
  dictionaryLocale = 'en-US';
});

describe('InstallPrompt', () => {
  const offered = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };

  it('offers the app in English', () => {
    seeded.push(offered);
    const html = renderToString(<InstallPrompt locale="en-US" />);
    expect(html).toContain('aria-label="Install our app"');
    expect(html).toContain('no app store needed');
    expect(html).toContain('>Install</button>');
    expect(html).toContain('>Not now</button>');
    expect(html).toContain('aria-label="Close"');
  });

  it('offers it in Polish', () => {
    seeded.push(offered);
    const html = renderToString(<InstallPrompt locale="pl-PL" />);
    expect(html).toContain('aria-label="Zainstaluj aplikację"');
    expect(html).toContain('>Zainstaluj</button>');
    expect(html).toContain('>Nie teraz</button>');
    expect(html).toContain('aria-label="Zamknij"');
  });

  it('renders nothing until the browser offers an install', () => {
    expect(renderToString(<InstallPrompt locale="pl-PL" />)).toBe('');
  });
});

describe('PushOptIn', () => {
  // useState order: vapidKey, done, iosHint.
  it('asks in English', () => {
    seeded.push('vapid-key', false, false);
    const html = renderToString(<PushOptIn locale="en-US" />);
    expect(html).toContain('Get notified about your orders and quotes.');
    expect(html).toContain('Enable notifications');
    expect(html).toContain('Not now');
  });

  it('asks in Polish', () => {
    seeded.push('vapid-key', false, false);
    const html = renderToString(<PushOptIn locale="pl-PL" />);
    expect(html).toContain('Otrzymuj powiadomienia o swoich zamówieniach i zapytaniach ofertowych.');
    expect(html).toContain('Włącz powiadomienia');
    expect(html).toContain('Nie teraz');
  });

  it('explains the iOS install step in both', () => {
    seeded.push(null, false, true);
    expect(renderToString(<PushOptIn locale="en-US" />)).toContain('to enable notifications.');
    seeded.push(null, false, true);
    const html = renderToString(<PushOptIn locale="pl-PL" />);
    expect(html).toContain('Dodaj sklep do ekranu głównego, aby włączyć powiadomienia.');
    expect(html).toContain('>Ukryj</button>');
  });
});

describe('PwaRegister', () => {
  it('announces an update in English and in Polish', () => {
    const waiting = { postMessage: () => {} };
    seeded.push(waiting);
    const en = renderToString(<PwaRegister locale="en-US" />);
    expect(en).toContain('A new version is available.');
    expect(en).toContain('>Reload</button>');
    seeded.push(waiting);
    const pl = renderToString(<PwaRegister locale="pl-PL" />);
    expect(pl).toContain('Dostępna jest nowa wersja.');
    expect(pl).toContain('>Odśwież</button>');
  });
});

describe('MobileSearchOverlay', () => {
  const props = {
    apiBaseUrl: 'http://api',
    salesChannelCode: 'retail',
    placeholder: 'Search',
    seeAllResultsLabel: 'All results',
    quickLinks: [{ label: 'Bearings', href: '/c/bearings' }],
  };

  // useState order: open, value, response.
  it('labels the open overlay in English', () => {
    seeded.push(true, '', null);
    const html = renderToString(<MobileSearchOverlay {...props} locale="en-US" />);
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('Categories');
    seeded.push(true, 'bearing', null);
    const typed = renderToString(<MobileSearchOverlay {...props} locale="en-US" />);
    expect(typed).toContain('aria-label="Clear"');
    expect(typed).toContain('Suggestions');
    expect(html + typed).not.toMatch(POLISH);
  });

  it('labels it in Polish', () => {
    seeded.push(true, '', null);
    const html = renderToString(<MobileSearchOverlay {...props} locale="pl-PL" />);
    expect(html).toContain('aria-label="Wstecz"');
    expect(html).toContain('Kategorie');
    seeded.push(true, 'łożysko', null);
    const typed = renderToString(<MobileSearchOverlay {...props} locale="pl-PL" />);
    expect(typed).toContain('aria-label="Wyczyść"');
    expect(typed).toContain('Podpowiedzi');
  });
});

describe('dictionary pickers', () => {
  it('caption the blank option in the provider’s language', () => {
    expect(renderToString(<CountryPicker includeBlank />)).toContain('>Select country</option>');
    dictionaryLocale = 'pl-PL';
    expect(renderToString(<CountryPicker includeBlank />)).toContain('>Wybierz kraj</option>');
    expect(renderToString(<CurrencyPicker includeBlank />)).toContain('>Wybierz walutę</option>');
    expect(renderToString(<LanguagePicker includeBlank />)).toContain('>Wybierz język</option>');
  });

  it('keep a caption the caller gives', () => {
    dictionaryLocale = 'pl-PL';
    expect(renderToString(<CountryPicker includeBlank blankLabel="—" />)).toContain('>—</option>');
  });

  it('mark an archived selection in the provider’s language', () => {
    seeded.push({ code: 'YU', label: 'Yugoslavia', isActive: false });
    const en = renderToString(<CountryPicker value="YU" onChange={() => {}} />);
    expect(en).toContain('label="Archived"');
    expect(en).toContain('Yugoslavia (archived)');

    dictionaryLocale = 'pl-PL';
    seeded.push({ code: 'YU', label: 'Jugosławia', isActive: false });
    const pl = renderToString(<CountryPicker value="YU" onChange={() => {}} />);
    expect(pl).toContain('label="Archiwalne"');
    expect(pl).toContain('Jugosławia (archiwalny)');

    seeded.push({ code: 'DEM', label: 'Marka niemiecka', isActive: false });
    expect(renderToString(<CurrencyPicker value="DEM" onChange={() => {}} />)).toContain(
      'Marka niemiecka (DEM, archiwalna)',
    );
    seeded.push({ code: 'la', label: 'Łacina', isActive: false });
    expect(renderToString(<LanguagePicker value="la" onChange={() => {}} />)).toContain('Łacina (archiwalny)');
  });
});
