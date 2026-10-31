import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Issue #85 — the public newsletter pages (`/newsletter/confirm`, `/subscribed`,
 * `/unsubscribe`) and the newsletter components were English-only, so a Polish
 * shop confirmed a subscription in English. They now speak the page language.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

const state = { locale: 'en-US', block: null as unknown };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    urlState: { languages: [], aliases: [], current: state.locale },
    ctx: { locale: state.locale },
    locale: state.locale,
  }),
}));
vi.mock('../../lib/api/newsletter', () => ({
  getNewsletterStatus: async () => ({ enabled: true }),
  subscribeNewsletter: vi.fn(),
  publicUnsubscribe: vi.fn(),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsBlockByCode: async () => state.block,
}));
vi.mock('../../lib/i18n/navigation', () => ({ localeRedirect: vi.fn() }));

const { default: ConfirmPage } = await import('../../app/newsletter/confirm/page');
const { default: SubscribedPage } = await import('../../app/newsletter/subscribed/page');
const { default: UnsubscribePage } = await import('../../app/newsletter/unsubscribe/page');
const { NewsletterSignup } = await import('../../components/newsletter/NewsletterSignup');
const { NewsletterConsent } = await import('../../components/newsletter/NewsletterConsent');

async function page<P>(render: (props: { searchParams: Promise<P> }) => Promise<unknown>, locale: string, params: P): Promise<string> {
  state.locale = locale;
  return renderToString((await render({ searchParams: Promise.resolve(params) })) as React.ReactElement);
}

describe('/newsletter/confirm', () => {
  it('confirms in English and in Polish', async () => {
    const en = await page(ConfirmPage, 'en-US', { status: 'ok' });
    expect(en).toContain('Your subscription is confirmed. Thank you!');
    expect(en).not.toMatch(POLISH);
    expect(await page(ConfirmPage, 'pl-PL', { status: 'ok' })).toContain(
      'Twoja subskrypcja została potwierdzona. Dziękujemy!',
    );
  });

  it('refuses an invalid link in both languages', async () => {
    expect(await page(ConfirmPage, 'en-US', { status: 'invalid' })).toContain(
      'This confirmation link is invalid or has expired.',
    );
    expect(await page(ConfirmPage, 'pl-PL', { status: 'invalid' })).toContain(
      'Ten link potwierdzający jest nieprawidłowy lub wygasł.',
    );
  });
});

describe('/newsletter/subscribed', () => {
  it.each([
    ['active', 'You are subscribed. Thank you!', 'Zapisano Cię do newslettera. Dziękujemy!'],
    ['error', 'We could not complete your subscription. Please try again.', 'Nie udało się dokończyć zapisu. Spróbuj ponownie.'],
    [
      'pending',
      'Almost there — please check your inbox and confirm your subscription.',
      'Jeszcze jeden krok — sprawdź skrzynkę odbiorczą i potwierdź subskrypcję.',
    ],
  ])('reports %s in the page language', async (status, english, polish) => {
    const en = await page(SubscribedPage, 'en-US', { status });
    expect(en).toContain(english);
    expect(en).not.toMatch(POLISH);
    expect(await page(SubscribedPage, 'pl-PL', { status })).toContain(polish);
  });
});

describe('/newsletter/unsubscribe', () => {
  it('asks for confirmation in English', async () => {
    const html = await page(UnsubscribePage, 'en-US', { token: 't', valid: 'true' });
    expect(html).toContain('>Unsubscribe</h1>');
    expect(html).toContain('Confirm you want to stop receiving our newsletter.');
    expect(html).toContain('placeholder="Reason (optional)"');
    expect(html).toContain('>Unsubscribe</button>');
    expect(html).not.toMatch(POLISH);
  });

  it('asks for confirmation in Polish', async () => {
    const html = await page(UnsubscribePage, 'pl-PL', { token: 't', valid: 'true' });
    expect(html).toContain('>Rezygnacja z newslettera</h1>');
    expect(html).toContain('Potwierdź, że nie chcesz już otrzymywać naszego newslettera.');
    expect(html).toContain('placeholder="Powód (opcjonalnie)"');
    expect(html).toContain('>Wypisz się</button>');
  });

  it('acknowledges the unsubscribe and refuses a bad link in both languages', async () => {
    expect(await page(UnsubscribePage, 'en-US', { done: '1' })).toContain('You have been unsubscribed.');
    expect(await page(UnsubscribePage, 'pl-PL', { done: '1' })).toContain('Wypisano Cię z newslettera.');
    expect(await page(UnsubscribePage, 'en-US', {})).toContain('This unsubscribe link is invalid or has expired.');
    expect(await page(UnsubscribePage, 'pl-PL', {})).toContain('Ten link do rezygnacji jest nieprawidłowy lub wygasł.');
  });
});

describe('NewsletterSignup', () => {
  it('labels the form in English, with the default title as its name', async () => {
    const html = renderToString(await NewsletterSignup({ channelCode: 'web', locale: 'en-US' }));
    expect(html).toContain('aria-label="Subscribe to our newsletter"');
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toContain('>Subscribe</button>');
    expect(html).not.toMatch(POLISH);
  });

  it('labels it in Polish', async () => {
    const html = renderToString(await NewsletterSignup({ channelCode: 'web', locale: 'pl-PL' }));
    expect(html).toContain('aria-label="Zapisz się do naszego newslettera"');
    expect(html).toContain('>Adres e-mail</label>');
    expect(html).toContain('>Zapisz się</button>');
  });

  it('keeps a title the caller passes', async () => {
    const html = renderToString(await NewsletterSignup({ channelCode: 'web', locale: 'pl-PL', title: 'Promocje' }));
    expect(html).toContain('aria-label="Promocje"');
  });
});

describe('NewsletterConsent default (no CMS block)', () => {
  it('reads English, with the policy link inside the sentence', async () => {
    state.block = null;
    const html = renderToString(await NewsletterConsent({ channelCode: 'web', ctx: { locale: 'en-US' } }));
    expect(html).toContain('Yes, I would like to receive the newsletter and marketing emails. See our ');
    expect(html).toMatch(/href="\/privacy-policy"[^>]*>Privacy Policy<\/a>\./);
    expect(html).not.toMatch(POLISH);
  });

  it('reads Polish', async () => {
    state.block = null;
    const html = renderToString(await NewsletterConsent({ channelCode: 'web', ctx: { locale: 'pl-PL' } }));
    expect(html).toContain('Tak, chcę otrzymywać newsletter i e-maile marketingowe. Szczegóły znajdziesz w naszej ');
    expect(html).toMatch(/href="\/privacy-policy"[^>]*>Polityce prywatności<\/a>\./);
  });
});
