import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #85 — every sign-in, registration, verification, password-reset,
 * invitation and security screen renders in the shop's language. Each page is
 * rendered server-side in `en-US` and `pl-PL`; the English render carries no
 * Polish diacritic, so a Polish string left in an English page fails here.
 */

const context = { locale: 'en-US' };
const mfa = {
  status: { totpActive: false, recoveryCodesRemaining: 0, socialLinks: [] as unknown[] },
  recoveryFlash: null as string[] | null,
  setup: null as { secret: string; otpauthUri: string } | null,
};
const verify = { fails: false };

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: context.locale,
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale: context.locale },
    modules: { isPresent: (id: string) => id === 'mfa' },
    urlState: { languages: [], aliases: [], current: context.locale },
  })),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../components/SocialLoginButtons', () => ({ SocialLoginButtons: () => null }));
vi.mock('../../lib/api/federated-sign-in', () => ({ getFederatedSignInProviders: async () => [] }));
vi.mock('../../components/newsletter/NewsletterConsent', () => ({ NewsletterConsent: () => null }));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('../../lib/session', () => ({
  getSessionCookie: vi.fn(async () => 'session'),
  getMfaChallengeCookie: vi.fn(async () => 'challenge'),
  getMfaSetupTicketCookie: vi.fn(async () => ({
    setupTicket: 'ticket',
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/Shop:buyer',
  })),
  getMfaSetupCookie: vi.fn(async () => mfa.setup),
  readAndClearMfaRecoveryFlash: vi.fn(async () => mfa.recoveryFlash),
  setSessionCookie: vi.fn(),
}));
vi.mock('../../lib/api/mfa', () => ({
  getMfaStatus: vi.fn(async () => mfa.status),
}));
vi.mock('../../lib/api/auth', () => ({
  verifyEmail: vi.fn(async () => {
    if (verify.fails) throw new Error('network');
  }),
}));

const { default: LoginPage } = await import('../../app/(auth)/login/page');
const { default: SetupPage } = await import('../../app/(auth)/login/setup/page');
const { default: RegisterPage } = await import('../../app/(auth)/register/page');
const { default: RegisterCustomerPage } = await import('../../app/(auth)/register-customer/page');
const { default: InvitationPage } = await import('../../app/(auth)/invitations/[token]/accept/page');
const { default: ResetRequestPage } = await import('../../app/(auth)/password-reset/request/page');
const { default: ResetConfirmPage } = await import('../../app/(auth)/password-reset/confirm/page');
const { default: VerifyPage } = await import('../../app/(auth)/verify/page');
const { default: SecurityPage } = await import('../../app/account/security/page');
const { default: OrganizationSecurityPage } = await import(
  '../../app/account/organization-security/page'
);

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

async function render(
  page: (props: never) => Promise<unknown>,
  searchParams: Record<string, string> = {},
  params?: Record<string, string>,
): Promise<string> {
  const props = { searchParams: Promise.resolve(searchParams), params: Promise.resolve(params) };
  // React separates adjacent text nodes with `<!-- -->`; the sentence is what is asserted.
  return renderToString((await page(props as never)) as ReactElement).replace(/<!-- -->/g, '');
}

function inBoth(
  name: string,
  renderPage: () => Promise<string>,
  expected: { 'en-US': string[]; 'pl-PL': string[] },
): void {
  describe(name, () => {
    it('renders in English, with no Polish left in it', async () => {
      context.locale = 'en-US';
      const html = await renderPage();
      for (const text of expected['en-US']) expect(html).toContain(text);
      expect(html).not.toMatch(POLISH);
    });

    it('renders in Polish', async () => {
      context.locale = 'pl-PL';
      const html = await renderPage();
      for (const text of expected['pl-PL']) expect(html).toContain(text);
      for (const text of expected['en-US']) expect(html).not.toContain(text);
    });
  });
}

beforeEach(() => {
  context.locale = 'en-US';
  mfa.status = { totpActive: false, recoveryCodesRemaining: 0, socialLinks: [] };
  mfa.recoveryFlash = null;
  mfa.setup = null;
  verify.fails = false;
});

inBoth('the sign-in page', () => render(LoginPage), {
  'en-US': ['Sign in</h1>', 'Use your work email and password.', 'Forgot your password?', 'Create an account'],
  'pl-PL': ['Zaloguj się</h1>', 'Użyj służbowego adresu e-mail i hasła.', 'Nie pamiętasz hasła?', 'Załóż konto'],
});

inBoth('the forced 2FA setup page', () => render(SetupPage), {
  'en-US': ['Set up two-step verification', 'Manual key:', '6-digit code', 'Confirm and continue'],
  'pl-PL': [
    'Skonfiguruj weryfikację dwuetapową',
    'Klucz do wpisania ręcznie:',
    'Kod 6-cyfrowy',
    'Potwierdź i kontynuuj',
  ],
});

inBoth('the business registration form', () => render(RegisterPage), {
  'en-US': ['Create your business account', 'Legal name', 'Tax ID', 'Postal code', 'Account owner'],
  'pl-PL': ['Załóż konto firmowe', 'Pełna nazwa firmy', 'NIP', 'Kod pocztowy', 'Właściciel konta'],
});

inBoth(
  'the registration acknowledgement',
  () => render(RegisterPage, { status: 'pending', email: 'buyer@example.com' }),
  {
    'en-US': [
      'Almost there',
      'We sent a verification email to <strong>buyer@example.com</strong>. Click the link',
    ],
    'pl-PL': [
      'Jeszcze tylko jeden krok',
      'Wysłaliśmy wiadomość weryfikacyjną na adres <strong>buyer@example.com</strong>. Kliknij link',
    ],
  },
);

inBoth('the individual registration form', () => render(RegisterCustomerPage), {
  'en-US': ['Create your account', 'First name', 'Password (at least 12 characters)', 'Already have an account?'],
  'pl-PL': ['Załóż konto', 'Imię', 'Hasło (co najmniej 12 znaków)', 'Masz już konto?'],
});

inBoth(
  'the individual registration refused for want of an organization',
  () => render(RegisterCustomerPage, { orgRequired: '1' }),
  {
    'en-US': ['Registration without an organization is currently disabled.', 'Register your organization'],
    'pl-PL': ['Rejestracja bez organizacji jest obecnie wyłączona.', 'zarejestruj swoją organizację'],
  },
);

inBoth('the invitation page', () => render(InvitationPage, {}, { token: 'abc' }), {
  'en-US': ['Accept invitation', 'Set your name and password to join the organization.', 'Wrong link?'],
  'pl-PL': [
    'Przyjmij zaproszenie',
    'Podaj imię, nazwisko i hasło, aby dołączyć do organizacji.',
    'Nieprawidłowy link?',
  ],
});

inBoth('the password-reset request', () => render(ResetRequestPage), {
  'en-US': ['Reset your password', 'Send reset link', 'Remembered it?'],
  'pl-PL': ['Zresetuj hasło', 'Wyślij link', 'Pamiętasz hasło?'],
});

inBoth(
  'the password-reset acknowledgement',
  () => render(ResetRequestPage, { status: 'sent', email: 'buyer@example.com' }),
  {
    'en-US': ['Check your inbox', 'If <strong>buyer@example.com</strong> matches an account', 'The link expires in 24 hours.'],
    'pl-PL': [
      'Sprawdź skrzynkę odbiorczą',
      'Jeśli adres <strong>buyer@example.com</strong> należy do konta',
      'Link wygasa po 24 godzinach.',
    ],
  },
);

inBoth('the new-password form', () => render(ResetConfirmPage, { token: 'abc' }), {
  'en-US': ['Choose a new password', 'New password (at least 12 characters)', 'Update password'],
  'pl-PL': ['Ustaw nowe hasło', 'Nowe hasło (co najmniej 12 znaków)', 'Zmień hasło'],
});

inBoth('the password-reset link without a token', () => render(ResetConfirmPage), {
  'en-US': ['Reset link missing', 'This page expects a <code>?token=</code> query parameter'],
  'pl-PL': ['Brak linku do resetowania hasła', 'Ta strona wymaga parametru <code>?token=</code> z linku'],
});

inBoth('the password updated page', () => render(ResetConfirmPage, { status: 'done' }), {
  'en-US': ['Password updated', 'Continue to sign-in'],
  'pl-PL': ['Hasło zostało zmienione', 'Przejdź do logowania'],
});

inBoth('the verified e-mail', () => render(VerifyPage, { token: 'abc' }), {
  'en-US': ['Email verification', 'Your email is verified.', 'Sign in to continue'],
  'pl-PL': ['Weryfikacja adresu e-mail', 'Twój adres e-mail został zweryfikowany.', 'Zaloguj się, aby kontynuować'],
});

describe('a verification that failed for want of an answer', () => {
  it('says so in the page language', async () => {
    verify.fails = true;
    context.locale = 'pl-PL';
    const html = await render(VerifyPage, { token: 'abc' });
    expect(html).toContain('Weryfikacja nie powiodła się.');
    expect(html).toContain('Potrzebujesz nowego linku?');
  });
});

inBoth('the account security page with 2FA off', () => render(SecurityPage), {
  'en-US': ['Account security', 'Two-step verification', 'Turn on two-step verification'],
  'pl-PL': ['Bezpieczeństwo konta', 'Weryfikacja dwuetapowa', 'Włącz weryfikację dwuetapową'],
});

describe('the account security page with 2FA on and fresh recovery codes', () => {
  it('renders in both languages, the count in the locale’s digits', async () => {
    mfa.status = { totpActive: true, recoveryCodesRemaining: 10000, socialLinks: [] };
    mfa.recoveryFlash = ['aaaa-bbbb'];
    const en = await render(SecurityPage);
    expect(en).toContain('Two-step verification is on');
    expect(en).toContain('Unused recovery codes remaining: 10,000');
    expect(en).toContain('Save your recovery codes');
    expect(en).toContain('Regenerate recovery codes');
    expect(en).not.toMatch(POLISH);

    context.locale = 'pl-PL';
    const pl = await render(SecurityPage);
    expect(pl).toContain('Weryfikacja dwuetapowa jest włączona');
    expect(pl).toMatch(/Pozostałe niewykorzystane kody odzyskiwania: 10\s000/);
    expect(pl).toContain('Zapisz kody odzyskiwania');
    expect(pl).toContain('Wygeneruj nowe kody odzyskiwania');
  });
});

describe('the account security page while confirming enrolment', () => {
  it('renders in both languages', async () => {
    mfa.setup = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Shop:buyer' };
    const en = await render(SecurityPage, { step: 'confirm' });
    expect(en).toContain('Scan and confirm');
    expect(en).toContain('Confirm and enable');
    context.locale = 'pl-PL';
    const pl = await render(SecurityPage, { step: 'confirm' });
    expect(pl).toContain('Zeskanuj i potwierdź');
    expect(pl).toContain('Potwierdź i włącz');
  });
});

inBoth('the organization security page', () => render(OrganizationSecurityPage, { done: '1' }), {
  'en-US': ['Organization security', 'Enforcement updated.', 'Require two-step verification for all members', 'Stop requiring two-step verification'],
  'pl-PL': [
    'Bezpieczeństwo organizacji',
    'Wymóg został zaktualizowany.',
    'Wymagaj weryfikacji dwuetapowej od wszystkich członków',
    'Wyłącz wymóg weryfikacji dwuetapowej',
  ],
});
