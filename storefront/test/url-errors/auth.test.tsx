import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { federatedSignInErrorCodeSchema } from '@endora-commerce/contracts';
import { StorefrontApiError } from '../../lib/api/client';
import { SIGN_IN_ERRORS } from '../../lib/auth/sign-in-errors';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — the sign-in, two-step, forced-setup, customer registration and
 * password-reset pages carried the API's sentence in `?error=` and rendered it
 * as given; the registration and reset acknowledgements also carried the
 * buyer's e-mail address in the URL and printed it. A code travels now, and no
 * address does.
 */

let locale = 'en-US';
let failure: Error | null = null;
let loginAnswer: unknown = { status: 'ok', sessionCookieValue: null };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale },
    modules: { isPresent: () => false },
    urlState: { languages: [], aliases: [], current: locale },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  localizedPath: async (to: string) => to,
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../components/SocialLoginButtons', () => ({ SocialLoginButtons: () => null }));
vi.mock('../../components/newsletter/NewsletterConsent', () => ({ NewsletterConsent: () => null }));
vi.mock('../../lib/api/federated-sign-in', () => ({ getFederatedSignInProviders: async () => [] }));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => null,
  getMfaChallengeCookie: async () => 'challenge',
  clearMfaChallengeCookie: async () => undefined,
  setMfaChallengeCookie: async () => undefined,
  getMfaSetupTicketCookie: async () => ({ setupTicket: 't', secret: 'S', otpauthUri: 'otpauth://x' }),
  setMfaSetupTicketCookie: async () => undefined,
  clearMfaSetupTicketCookie: async () => undefined,
  setMfaRecoveryFlash: async () => undefined,
  setSessionCookie: async () => undefined,
  setCartMergeFlash: async () => undefined,
  getAnonCartCookie: async () => null,
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/auth')>('../../lib/api/auth');
  return {
    ...actual,
    loginCustomer: async () => {
      if (failure) throw failure;
      return loginAnswer;
    },
    requestPasswordReset: async () => {
      if (failure) throw failure;
    },
    confirmPasswordReset: refuse,
    registerStandaloneCustomer: refuse,
    verifyCustomerMfa: refuse,
  };
});
vi.mock('../../lib/api/mfa', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/mfa')>('../../lib/api/mfa');
  return {
    ...actual,
    completeMfaSetupTicket: refuse,
    beginMfaSetupTicket: refuse,
  };
});
vi.mock('../../lib/api/customer-registration', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/customer-registration')>(
    '../../lib/api/customer-registration',
  );
  return { ...actual, getCustomerRegistrationOptions: async () => ({ standaloneCustomerRegistration: true }) };
});

type Page = (props: { searchParams: Promise<Record<string, string>> }) => unknown;
const page = async (path: string): Promise<Page> => (await import(path)).default as Page;

const PAGES = {
  login: await page('../../app/(auth)/login/page'),
  mfa: await page('../../app/(auth)/login/mfa/page'),
  setup: await page('../../app/(auth)/login/setup/page'),
  registerCustomer: await page('../../app/(auth)/register-customer/page'),
  resetRequest: await page('../../app/(auth)/password-reset/request/page'),
  resetConfirm: await page('../../app/(auth)/password-reset/confirm/page'),
  register: await page('../../app/(auth)/register/page'),
};
type Name = keyof typeof PAGES;

async function tree(name: Name, sp: Record<string, string> = {}): Promise<unknown> {
  return PAGES[name]({ searchParams: Promise.resolve(sp) });
}
async function text(name: Name, sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await tree(name, sp)) as React.ReactNode}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
  loginAnswer = { status: 'ok', sessionCookieValue: null };
});

describe('a crafted ?error= never reaches an auth page', () => {
  it.each([
    ['login', {}, 'Sign-in failed. Please try again.'],
    ['mfa', {}, 'Verification failed. Please try again.'],
    ['setup', {}, 'Setup failed. Please try again.'],
    ['registerCustomer', {}, 'Registration failed. Please try again.'],
    ['resetRequest', {}, 'Could not send the reset link. Please try again.'],
    ['resetConfirm', { token: 'tok' }, 'Could not reset your password.'],
  ] as const)('%s', async (name, extra, generic) => {
    for (const crafted of ['Twoje konto wygasło — zadzwoń 555 000 111', 'SOMETHING_ELSE', 'constructor']) {
      const out = await text(name, { ...extra, error: crafted });
      expect(out).not.toContain(crafted);
      expect(out).toContain(generic);
    }
  });
});

describe('each known code reads in English and Polish', () => {
  it.each([
    ['login', {}, 'INVALID_CREDENTIALS', 'Invalid email or password. Please try again.', 'Nieprawidłowy e-mail lub hasło. Spróbuj ponownie.'],
    ['login', {}, 'sales_channel_not_permitted', 'This account does not have access to this store.', 'To konto nie ma dostępu do tego sklepu.'],
    [
      'mfa',
      {},
      'MFA_INVALID_CODE',
      'That code was not accepted. A code from your authenticator app is only valid for about half a minute, so wait for the next one and enter it without spaces; a recovery code can be used only once.',
      'Ten kod nie został przyjęty. Kod z aplikacji uwierzytelniającej jest ważny tylko przez około pół minuty, więc poczekaj na kolejny i wpisz go bez spacji; kodu odzyskiwania można użyć tylko raz.',
    ],
    ['registerCustomer', {}, 'EMAIL_ALREADY_REGISTERED', 'An account with this email address already exists.', 'Konto z tym adresem e-mail już istnieje.'],
    [
      'resetRequest',
      {},
      'CUSTOMER_AUTHENTICATION_THROTTLED',
      'Too many attempts were made for this account, so further attempts are paused for a few minutes. Wait a moment and try again.',
      'Dla tego konta podjęto zbyt wiele prób, dlatego kolejne są wstrzymane na kilka minut. Odczekaj chwilę i spróbuj ponownie.',
    ],
    ['resetConfirm', { token: 'tok' }, 'TOKEN_INVALID_OR_EXPIRED', 'This link is invalid or has expired.', 'Ten link jest nieprawidłowy lub wygasł.'],
  ] as const)('%s %s', async (name, extra, code, en, pl) => {
    expect(await text(name, { ...extra, error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text(name, { ...extra, error: code })).toContain(pl);
  });
});

/**
 * Issue #789 — `mfa`'s federated callback (`routes.oauth.ts`, `loginRedirect`) redirects with a
 * code from `federatedSignInErrorCodeSchema`, and the sign-in page words each one in its own
 * language. The ten English sentences it used to send are not lookup keys any more.
 */
describe('the federated callback’s codes read in English and Polish', () => {
  it.each([
    ['unknown_provider', 'This sign-in provider is not known.', 'Ten dostawca logowania jest nieznany.'],
    ['provider_unavailable', 'Sign-in with this provider is not available.', 'Logowanie przez tego dostawcę jest niedostępne.'],
    ['sign_in_cancelled', 'Sign-in was cancelled or failed.', 'Logowanie zostało anulowane albo się nie powiodło.'],
    ['sign_in_expired', 'This sign-in attempt has expired.', 'Ta próba logowania wygasła.'],
    ['sign_in_failed', 'Sign-in failed. Please try again.', 'Logowanie nie powiodło się. Spróbuj ponownie.'],
    ['email_unverified', 'Your provider email is not verified.', 'Adres e-mail u dostawcy nie jest potwierdzony.'],
    [
      'no_matching_account',
      'No account matches this provider. Please contact an administrator.',
      'Żadne konto nie odpowiada temu dostawcy. Skontaktuj się z administratorem.',
    ],
    ['account_blocked', 'This account has been blocked. Please contact support.', 'To konto zostało zablokowane. Skontaktuj się z obsługą.'],
    [
      'registration_disabled_in_channel',
      'This store does not offer personal accounts, so no account was created. Sign in with an existing account, or register your organization.',
      'Ten sklep nie oferuje kont osobistych, więc konto nie zostało utworzone. Zaloguj się na istniejące konto albo zarejestruj swoją organizację.',
    ],
    [
      'mfa_setup_required',
      'Two-step verification is required for your account. Sign in with your email and password to set it up.',
      'Twoje konto wymaga weryfikacji dwuetapowej. Zaloguj się e-mailem i hasłem, aby ją skonfigurować.',
    ],
    [
      'sales_channel_sign_in_required',
      'This store is available to signed-in business customers. Sign in, or apply for a business account.',
      'Ten sklep jest dostępny dla zalogowanych klientów biznesowych. Zaloguj się lub złóż wniosek o konto firmowe.',
    ],
    ['sales_channel_not_permitted', 'This account does not have access to this store.', 'To konto nie ma dostępu do tego sklepu.'],
  ] as const)('%s', async (code, en, pl) => {
    expect(await text('login', { error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text('login', { error: code })).toContain(pl);
  });

  it('names every code the contract lists', () => {
    for (const code of federatedSignInErrorCodeSchema.options) expect(SIGN_IN_ERRORS.isCode(code)).toBe(true);
  });

  it('a sentence the callback used to send reads as the generic failure', async () => {
    const out = await text('login', { error: 'No account found. Please create an account first.' });
    expect(out).not.toContain('No account found');
    expect(out).toContain('Sign-in failed. Please try again.');
  });
});

describe('the actions redirect with a code, never a sentence', () => {
  it('sign-in carries the API code it names, or LOGIN_FAILED', async () => {
    const action = actionsOf(await tree('login')).get('loginAction')!;
    const data = form({ email: 'a@example.com', password: 'x', next: '/account' });
    failure = new StorefrontApiError(401, 'INVALID_CREDENTIALS', 'Nieprawidłowy e-mail lub hasło.');
    expect(await redirectOf(() => action(data as never))).toBe('/login?error=INVALID_CREDENTIALS&next=%2Faccount');
    failure = new StorefrontApiError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'Kein Zugang.');
    expect(await redirectOf(() => action(data as never))).toBe('/login?error=sales_channel_not_permitted&next=%2Faccount');
    failure = null;
    expect(await redirectOf(() => action(data as never))).toBe('/login?error=LOGIN_FAILED&next=%2Faccount');
  });

  it('the second factor carries the MFA code', async () => {
    failure = new StorefrontApiError(400, 'MFA_INVALID_CODE', 'Ten kod nie został przyjęty.');
    const action = actionsOf(await tree('mfa')).get('verifyAction')!;
    expect(await redirectOf(() => action(form({ code: '1', next: '/account' }) as never))).toBe(
      '/login/mfa?error=MFA_INVALID_CODE&next=%2Faccount',
    );
  });

  it('the forced setup carries MFA_SETUP_FAILED for a refusal it cannot name', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const action = actionsOf(await tree('setup')).get('completeAction')!;
    expect(await redirectOf(() => action(form({ code: '1', next: '/account' }) as never))).toBe(
      '/login/setup?error=MFA_SETUP_FAILED&next=%2Faccount',
    );
  });

  it('customer registration carries the API code it names', async () => {
    failure = new StorefrontApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Konto z tym adresem e-mail już istnieje.');
    const action = actionsOf(await tree('registerCustomer')).get('registerCustomerAction')!;
    expect(await redirectOf(() => action(form({ email: 'a@example.com' }) as never))).toBe(
      '/register-customer?error=EMAIL_ALREADY_REGISTERED',
    );
  });

  it('the reset confirm keeps the token and carries the code', async () => {
    failure = new StorefrontApiError(400, 'TOKEN_INVALID_OR_EXPIRED', 'Ten link jest nieprawidłowy lub wygasł.');
    const action = actionsOf(await tree('resetConfirm', { token: 'tok' })).get('confirmAction')!;
    expect(await redirectOf(() => action(form({ token: 'tok', newPassword: 'x' }) as never))).toBe(
      '/password-reset/confirm?token=tok&error=TOKEN_INVALID_OR_EXPIRED',
    );
  });
});

describe('no e-mail address travels in a URL', () => {
  it('the reset request acknowledges without the address', async () => {
    const action = actionsOf(await tree('resetRequest')).get('requestAction')!;
    expect(await redirectOf(() => action(form({ email: 'jan@example.com' }) as never))).toBe(
      '/password-reset/request?status=sent',
    );
    failure = new StorefrontApiError(429, 'CUSTOMER_AUTHENTICATION_THROTTLED', 'Zbyt wiele prób.');
    expect(await redirectOf(() => action(form({ email: 'jan@example.com' }) as never))).toBe(
      '/password-reset/request?error=CUSTOMER_AUTHENTICATION_THROTTLED',
    );
  });

  it.each([
    ['resetRequest', { status: 'sent' }, 'If the address you entered matches an account, we just emailed a reset link.'],
    [
      'register',
      { status: 'pending' },
      'We sent a verification email to the address you entered. Click the link in that email to activate your account.',
    ],
  ] as const)('%s prints no ?email=, whatever it carries', async (name, sp, sentence) => {
    const out = await text(name, { ...sp, email: 'Zadzwoń pod 555 000 111' });
    expect(out).not.toContain('555 000 111');
    expect(out).toContain(sentence);
  });
});
