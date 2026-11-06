import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { SIGN_IN_ERRORS, signInErrorMessage } from '../../lib/auth/sign-in-errors';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #808 — invitation acceptance carried a sentence in its own `?error=`
 * (the API's `detail`, or a translated fallback) and rendered it as given, and
 * sent one to `/login?error=` when the token was empty. A code travels now:
 * the page words the codes of its own vocabulary and reads anything else as
 * its generic failure; `/login` gets a code from the sign-in vocabulary.
 *
 * The failure is split by stage (architect ruling on #822, 2026-11-06): an
 * accept refusal stays on the invitation page; once the account exists, a
 * sign-in refusal or a required second step goes to `/login`, whose
 * `SIGN_IN_TO_CONTINUE` says the account was created.
 */

let locale = 'en-US';
let acceptFailure: Error | null = null;
let loginFailure: Error | null = null;
let loginAnswer: unknown = { status: 'authenticated', sessionCookieValue: 'cookie' };

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
vi.mock('../../lib/i18n/localized-link', () => ({
  LocalizedLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('../../lib/session', () => ({
  setSessionCookie: async () => undefined,
}));
vi.mock('../../lib/api/organization', () => ({
  acceptInvitation: async () => {
    if (acceptFailure) throw acceptFailure;
    return { customerAccount: { email: 'jan@example.com' } };
  },
}));
vi.mock('../../lib/api/auth', () => ({
  loginCustomer: async () => {
    if (loginFailure) throw loginFailure;
    return loginAnswer;
  },
}));

type Page = (props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string>>;
}) => unknown;
const Accept = (await import('../../app/(auth)/invitations/[token]/accept/page')).default as Page;

async function tree(sp: Record<string, string> = {}, token = 'tok'): Promise<unknown> {
  return Accept({ params: Promise.resolve({ token }), searchParams: Promise.resolve(sp) });
}
async function text(sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await tree(sp)) as React.ReactNode}</>));
}
async function submit(fields: Record<string, string>): Promise<string> {
  const action = actionsOf(await tree()).get('acceptInvitationAction')!;
  return redirectOf(() => action(form(fields) as never));
}

const FIELDS = { token: 'tok', firstName: 'Jan', lastName: 'Kowalski', password: 'long-enough-password' };

beforeEach(() => {
  locale = 'en-US';
  acceptFailure = null;
  loginFailure = null;
  loginAnswer = { status: 'authenticated', sessionCookieValue: 'cookie' };
});

describe('a crafted ?error= never reaches the invitation page', () => {
  it.each(['Twoje zaproszenie wygasło — zadzwoń 555 000 111', 'SOMETHING_ELSE', 'constructor', '__proto__'])(
    '%s reads as the generic failure',
    async (crafted) => {
      const out = await text({ error: crafted });
      expect(out).not.toContain(crafted);
      expect(out).toContain('Could not accept invitation. Try again.');
    },
  );

  it('shows no error without the parameter', async () => {
    expect(await text({})).not.toContain('Could not accept invitation');
  });
});

describe('each invitation code reads in English and Polish', () => {
  it.each([
    ['TOKEN_INVALID_OR_EXPIRED', 'This link is invalid or has expired.', 'Ten link jest nieprawidłowy lub wygasł.'],
    ['EMAIL_ALREADY_REGISTERED', 'An account with this email address already exists.', 'Konto z tym adresem e-mail już istnieje.'],
    [
      'VALIDATION_FAILED',
      'Check the details you entered. The password needs at least 12 characters.',
      'Sprawdź wpisane dane. Hasło musi mieć co najmniej 12 znaków.',
    ],
    ['INVITATION_FAILED', 'Could not accept invitation. Try again.', 'Nie udało się przyjąć zaproszenia. Spróbuj ponownie.'],
  ] as const)('%s', async (code, en, pl) => {
    expect(await text({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text({ error: code })).toContain(pl);
  });

  it.each(['SIGN_IN_TO_CONTINUE', 'SALES_CHANNEL_NOT_PERMITTED', 'CUSTOMER_AUTHENTICATION_THROTTLED'])(
    'a sign-in code %s is not the invitation page’s',
    async (code) => {
      expect(await text({ error: code })).toContain('Could not accept invitation. Try again.');
    },
  );
});

describe('what /login says once the account exists, in English and Polish', () => {
  it.each([
    ['SIGN_IN_TO_CONTINUE', 'Account created. Please sign in to continue.', 'Konto zostało utworzone. Zaloguj się, aby kontynuować.'],
    ['sales_channel_not_permitted', 'This account does not have access to this store.', 'To konto nie ma dostępu do tego sklepu.'],
    [
      'CUSTOMER_AUTHENTICATION_THROTTLED',
      'Too many attempts were made for this account',
      'Dla tego konta podjęto zbyt wiele prób',
    ],
  ] as const)('%s', (code, en, pl) => {
    expect(signInErrorMessage(code, 'en-US')).toContain(en);
    expect(signInErrorMessage(code, 'pl-PL')).toContain(pl);
  });
});

describe('the action redirects with a code, never a sentence', () => {
  it('carries the API code the page names', async () => {
    acceptFailure = new StorefrontApiError(400, 'TOKEN_INVALID_OR_EXPIRED', 'Invitation has expired.');
    expect(await submit(FIELDS)).toBe('/invitations/tok/accept?error=TOKEN_INVALID_OR_EXPIRED');
    acceptFailure = new StorefrontApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
    expect(await submit(FIELDS)).toBe('/invitations/tok/accept?error=EMAIL_ALREADY_REGISTERED');
  });

  it('carries INVITATION_FAILED for a refusal it cannot name, or no API answer', async () => {
    acceptFailure = new StorefrontApiError(404, 'NOT_FOUND', 'Organization no longer exists.');
    expect(await submit(FIELDS)).toBe('/invitations/tok/accept?error=INVITATION_FAILED');
    acceptFailure = new Error('fetch failed');
    expect(await submit(FIELDS)).toBe('/invitations/tok/accept?error=INVITATION_FAILED');
  });

  it('an accept refusal stays on the invitation page, even one the sign-in also names', async () => {
    acceptFailure = new StorefrontApiError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'Kein Zugang.');
    expect(await submit(FIELDS)).toBe('/invitations/tok/accept?error=INVITATION_FAILED');
  });

  it('a sign-in refusal after the account was created goes to /login with the sign-in code', async () => {
    loginFailure = new StorefrontApiError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'Kein Zugang.');
    expect(await submit(FIELDS)).toBe('/login?error=sales_channel_not_permitted');
    loginFailure = new StorefrontApiError(429, 'CUSTOMER_AUTHENTICATION_THROTTLED', 'Zbyt wiele prób.');
    expect(await submit(FIELDS)).toBe('/login?error=CUSTOMER_AUTHENTICATION_THROTTLED');
  });

  it('a sign-in that fails without a code it names goes to /login with SIGN_IN_TO_CONTINUE', async () => {
    loginFailure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await submit(FIELDS)).toBe('/login?error=SIGN_IN_TO_CONTINUE');
    loginFailure = new Error('fetch failed');
    expect(await submit(FIELDS)).toBe('/login?error=SIGN_IN_TO_CONTINUE');
  });

  it('a sign-in that needs a second step goes to /login with SIGN_IN_TO_CONTINUE', async () => {
    loginAnswer = { status: 'mfa_required' };
    expect(await submit(FIELDS)).toBe('/login?error=SIGN_IN_TO_CONTINUE');
    expect(SIGN_IN_ERRORS.errorKey('SIGN_IN_TO_CONTINUE')).toBe('auth.invitation.signInToContinue');
  });

  it('sends an empty token to /login with a sign-in code', async () => {
    const to = await submit({ ...FIELDS, token: '  ' });
    expect(to).toBe('/login?error=INVITATION_INVALID');
    expect(SIGN_IN_ERRORS.isCode('INVITATION_INVALID')).toBe(true);
    expect(SIGN_IN_ERRORS.errorKey('INVITATION_INVALID')).toBe('auth.invitation.invalidLink');
  });

  it('signs in and lands on the account', async () => {
    expect(await submit(FIELDS)).toBe('/account');
  });
});
