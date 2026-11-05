import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * A sign-in the store refuses, and a sign-in the store requires
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §2–§3, FR-028).
 *
 * The backend refuses a correct password for an account whose Organization is
 * not assigned to this store with `403 SALES_CHANNEL_NOT_PERMITTED` and sets no
 * session; the second factor refuses the same way, and a federated sign-in
 * comes back as `/login?error=sales_channel_not_permitted`. All three reach the
 * buyer as one translated sentence on the sign-in page — never the backend's
 * code, and never a message in whatever language the backend answered in.
 *
 * A store closed to anonymous visitors sends them to the same page with
 * `reason=sign-in-required`, where a notice says why they are there.
 */

const context = {
  locale: 'en-US',
  anonymousAccess: true,
};

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: context.locale,
    anonymousAccess: context.anonymousAccess,
    ctx: { salesChannelCode: 'trade', locale: context.locale },
    modules: { isPresent: () => false },
    // Feature 167 — no URL languages known: paths stay as written.
    urlState: { languages: [], aliases: [], current: context.locale },
  })),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../lib/session', () => ({
  getMfaChallengeCookie: vi.fn(async () => 'challenge'),
}));

const {
  signInErrorParam,
  signInErrorMessage,
  CHANNEL_NOT_PERMITTED_ERROR,
  CHANNEL_SIGN_IN_REQUIRED_ERROR,
} = await import(
  '../../lib/auth/sign-in-errors'
);
const { default: LoginPage } = await import('../../app/(auth)/login/page');
const { default: MfaPage } = await import('../../app/(auth)/login/mfa/page');

async function renderLogin(params: Record<string, string>): Promise<string> {
  return renderToString(await LoginPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  context.locale = 'en-US';
  context.anonymousAccess = true;
});

describe('the sign-in action’s error parameter', () => {
  it('names the channel refusal by its stable code, not by the backend’s sentence', () => {
    const refusal = new StorefrontApiError(
      403,
      'SALES_CHANNEL_NOT_PERMITTED',
      'Dieses Konto hat keinen Zugang zu diesem Shop.',
    );
    expect(signInErrorParam(refusal, 'LOGIN_FAILED')).toBe(CHANNEL_NOT_PERMITTED_ERROR);
    expect(CHANNEL_NOT_PERMITTED_ERROR).toBe('sales_channel_not_permitted');
  });

  // Issue #745 — every other refusal travels as a code too, never as the backend's sentence.
  it('carries every other refusal as a code', () => {
    const wrong = new StorefrontApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    expect(signInErrorParam(wrong, 'LOGIN_FAILED')).toBe('INVALID_CREDENTIALS');
    expect(signInErrorParam(new TypeError('fetch failed'), 'LOGIN_FAILED')).toBe('LOGIN_FAILED');
  });

  it('translates the code and reads anything else as the sign-in failure', () => {
    expect(signInErrorMessage(CHANNEL_NOT_PERMITTED_ERROR, 'en-US')).toBe(
      'This account does not have access to this store.',
    );
    expect(signInErrorMessage(CHANNEL_NOT_PERMITTED_ERROR, 'pl-PL')).toBe(
      'To konto nie ma dostępu do tego sklepu.',
    );
    expect(signInErrorMessage(CHANNEL_SIGN_IN_REQUIRED_ERROR, 'en-US')).toBe(
      'This store is available to signed-in business customers. Sign in, or apply for a business account.',
    );
    expect(signInErrorMessage('sales_channel_sign_in_required', 'pl-PL')).toBe(
      'Ten sklep jest dostępny dla zalogowanych klientów biznesowych. Zaloguj się lub złóż wniosek o konto firmowe.',
    );
    expect(signInErrorMessage('Invalid email or password.', 'pl-PL')).toBe('Logowanie nie powiodło się. Spróbuj ponownie.');
    expect(signInErrorMessage(undefined, 'en-US')).toBeUndefined();
  });
});

describe('the sign-in page', () => {
  it('shows the refusal in English', async () => {
    const html = await renderLogin({ error: 'sales_channel_not_permitted' });
    expect(html).toContain('This account does not have access to this store.');
    expect(html).not.toContain('sales_channel_not_permitted</');
  });

  it('shows the refusal in Polish — the federated redirect lands here the same way', async () => {
    context.locale = 'pl-PL';
    const html = await renderLogin({ error: 'sales_channel_not_permitted' });
    expect(html).toContain('To konto nie ma dostępu do tego sklepu.');
  });

  it('announces the refusal to assistive technology', async () => {
    const html = await renderLogin({ error: 'sales_channel_not_permitted' });
    expect(html).toMatch(/role="alert"[^>]*>This account does not have access/);
  });

  it('explains why the visitor of a closed store is here', async () => {
    context.anonymousAccess = false;
    const html = await renderLogin({ reason: 'sign-in-required', next: '/catalog' });
    expect(html).toContain(
      'This store is available to signed-in business customers. Sign in, or apply for a business account.',
    );
    expect(html).toContain('value="/catalog"');
  });

  it('explains it in Polish', async () => {
    context.anonymousAccess = false;
    context.locale = 'pl-PL';
    const html = await renderLogin({ reason: 'sign-in-required' });
    expect(html).toContain(
      'Ten sklep jest dostępny dla zalogowanych klientów biznesowych. Zaloguj się lub złóż wniosek o konto firmowe.',
    );
  });

  it('shows no notice on an ordinary visit', async () => {
    const html = await renderLogin({});
    expect(html).not.toContain('signed-in business customers');
  });

  it('offers business registration on a closed store and never individual registration', async () => {
    context.anonymousAccess = false;
    const html = await renderLogin({ reason: 'sign-in-required' });
    expect(html).toContain('href="/register"');
    expect(html).not.toContain('/register-customer');
  });
});

describe('the second-factor step', () => {
  it('shows the same translated refusal', async () => {
    context.locale = 'pl-PL';
    const html = renderToString(
      await MfaPage({ searchParams: Promise.resolve({ error: 'sales_channel_not_permitted' }) }),
    );
    expect(html).toContain('To konto nie ma dostępu do tego sklepu.');
  });
});
