import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContactForm } from '../../components/contact/ContactForm';

/**
 * Issue #85 — the contact page and its form were Polish-only, so a shop running
 * in English showed its contact form in Polish. Both now speak the page
 * language: the page reads it from the server context, the form (a client
 * component) receives it as a prop.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

const state = { locale: 'en-US' };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    urlState: { languages: [], aliases: [], current: state.locale },
    ctx: { locale: state.locale },
    locale: state.locale,
  }),
}));
vi.mock('../../lib/api/shop', () => ({
  getShopInfo: async () => ({ name: 'Acme', address: null, contactEmail: 'hello@acme.test', phone: '+48 600 000 000' }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localizedAlternates: async () => ({ canonical: '/kontakt' }),
}));

const { default: KontaktPage, generateMetadata } = await import('../../app/kontakt/page');

async function renderPage(locale: string): Promise<string> {
  state.locale = locale;
  return renderToString(await KontaktPage());
}

describe('ContactForm speaks the page language', () => {
  it('labels the fields and the button in English', () => {
    const html = renderToString(<ContactForm locale="en-US" />);
    expect(html).toContain('Name<!-- --> *');
    expect(html).toContain('Message<!-- --> *');
    expect(html).toContain('Attachment (optional)');
    expect(html).toContain('>Send message<');
    expect(html).not.toMatch(POLISH);
  });

  it('labels them in Polish', () => {
    const html = renderToString(<ContactForm locale="pl-PL" />);
    expect(html).toContain('Imię i nazwisko<!-- --> *');
    expect(html).toContain('Wiadomość<!-- --> *');
    expect(html).toContain('Załącznik (opcjonalnie)');
    expect(html).toContain('>Wyślij wiadomość<');
  });
});

describe('/kontakt speaks the page language', () => {
  it('renders the heading, the intro and the contact details in English', async () => {
    const html = await renderPage('en-US');
    expect(html).toContain('>Contact</h1>');
    expect(html).toContain('Have a question? Fill in the form');
    expect(html).toContain('Email<!-- -->: ');
    expect(html).toContain('Phone<!-- -->: ');
    expect(html).toContain('>Send message<');
    expect(html).not.toMatch(POLISH);
  });

  it('renders them in Polish', async () => {
    const html = await renderPage('pl-PL');
    expect(html).toContain('>Kontakt</h1>');
    expect(html).toContain('Masz pytanie? Wypełnij formularz');
    expect(html).toContain('E-mail<!-- -->: ');
    expect(html).toContain('Tel.<!-- -->: ');
    expect(html).toContain('>Wyślij wiadomość<');
  });

  it('titles and describes the page in the page language', async () => {
    state.locale = 'en-US';
    expect(await generateMetadata()).toMatchObject({
      title: 'Contact',
      description: 'Get in touch with us — contact form.',
    });
    state.locale = 'pl-PL';
    expect(await generateMetadata()).toMatchObject({
      title: 'Kontakt',
      description: 'Skontaktuj się z nami — formularz kontaktowy.',
    });
  });
});
