import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — `/preferences`, `/account/password` and `/account/security`
 * carry a code in `?error=`, never a sentence.
 */

let locale = 'en-US';
let failure: Error | null = null;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getMfaSetupCookie: async () => ({ secret: 'SECRET', otpauthUri: 'otpauth://totp/x' }),
  setMfaSetupCookie: async () => undefined,
  clearMfaSetupCookie: async () => undefined,
  setMfaRecoveryFlash: async () => undefined,
  readAndClearMfaRecoveryFlash: async () => null,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    ctx: { locale },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: { id: 'acc-1', organizationRole: null, permissions: [] },
    organization: null,
    impersonation: null,
  }),
  changePassword: refuse,
}));
vi.mock('../../lib/api/methods', () => ({ listPaymentMethods: async () => [], listDeliveryMethods: async () => [] }));
vi.mock('../../lib/api/organization', () => ({ listAddresses: async () => [] }));
vi.mock('../../lib/api/quick-order', () => ({
  getQuickOrderPreference: async () => null,
  upsertQuickOrderPreference: refuse,
}));
vi.mock('../../lib/api/mfa', () => ({
  getMfaStatus: async () => ({ totpActive: false, recoveryCodesRemaining: 0, socialLinks: [] }),
  startMfaSetup: refuse,
  activateMfa: refuse,
  disableMfa: refuse,
  regenerateMfaRecoveryCodes: refuse,
  unlinkMfaSocialIdentity: refuse,
}));

const { default: PreferencesPage } = await import('../../app/(account)/preferences/page');
const { default: PasswordPage } = await import('../../app/(account)/account/password/page');
const { default: SecurityPage } = await import('../../app/account/security/page');

type Page = (props: { searchParams: Promise<Record<string, string>> }) => unknown;
const PAGES: Record<string, Page> = {
  preferences: PreferencesPage as unknown as Page,
  password: PasswordPage as unknown as Page,
  security: SecurityPage as unknown as Page,
};

async function tree(page: string, sp: Record<string, string> = {}): Promise<unknown> {
  return PAGES[page]!({ searchParams: Promise.resolve(sp) });
}
async function text(page: string, sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await tree(page, sp)) as React.ReactNode}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
});

describe('a crafted ?error= never reaches the page', () => {
  it.each([
    ['preferences', 'Could not save your preferences.'],
    ['password', 'Could not update your password.'],
    ['security', 'Something went wrong. Please try again.'],
  ])('%s', async (page, generic) => {
    for (const crafted of ['Konto zablokowane — zadzwoń 555 000 111', 'SOMETHING_ELSE', 'constructor']) {
      const out = await text(page, { error: crafted });
      expect(out).not.toContain(crafted);
      expect(out).toContain(generic);
    }
  });
});

describe('each known code reads in English and Polish', () => {
  it.each([
    ['password', 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.', 'Obecne hasło jest nieprawidłowe.'],
    [
      'password',
      'VALIDATION_FAILED',
      'The new password does not meet the requirements. Use at least 12 characters.',
      'Nowe hasło nie spełnia wymagań. Użyj co najmniej 12 znaków.',
    ],
    [
      'security',
      'MFA_INVALID_CODE',
      'That code was not accepted. A code from your authenticator app is only valid for about half a minute, so wait for the next one and enter it without spaces; a recovery code can be used only once.',
      'Ten kod nie został przyjęty. Kod z aplikacji uwierzytelniającej jest ważny tylko przez około pół minuty, więc poczekaj na kolejny i wpisz go bez spacji; kodu odzyskiwania można użyć tylko raz.',
    ],
    ['preferences', 'SAVE_FAILED', 'Could not save your preferences.', 'Nie udało się zapisać ustawień.'],
  ])('%s %s', async (page, code, en, pl) => {
    expect(await text(page, { error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text(page, { error: code })).toContain(pl);
  });
});

describe('the actions redirect with a code, never a sentence', () => {
  it('password carries the API code it names, or CHANGE_FAILED', async () => {
    const action = actionsOf(await tree('password')).get('changePasswordAction')!;
    const data = form({ currentPassword: 'old', newPassword: 'new-password-123' });
    failure = new StorefrontApiError(401, 'CURRENT_PASSWORD_INVALID', 'Obecne hasło jest nieprawidłowe.');
    expect(await redirectOf(() => action(data as never))).toBe('/account/password?error=CURRENT_PASSWORD_INVALID');
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await redirectOf(() => action(data as never))).toBe('/account/password?error=CHANGE_FAILED');
  });

  it('preferences carries SAVE_FAILED', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const action = actionsOf(await tree('preferences')).get('saveAction')!;
    expect(await redirectOf(() => action(form({}) as never))).toBe('/preferences?error=SAVE_FAILED');
  });

  it('security’s confirm keeps the step and carries the MFA code', async () => {
    failure = new StorefrontApiError(400, 'MFA_INVALID_CODE', 'Ten kod nie został przyjęty.');
    const action = actionsOf(await tree('security', { step: 'confirm' })).get('confirmAction')!;
    expect(await redirectOf(() => action(form({ code: '000000' }) as never))).toBe(
      '/account/security?step=confirm&error=MFA_INVALID_CODE',
    );
  });

  it('security’s unlink carries the API code it names, or FAILED', async () => {
    const action = actionsOf(await tree('security')).get('unlinkSocialAction')!;
    failure = new StorefrontApiError(409, 'MFA_SOCIAL_LAST_CREDENTIAL', 'To ostatnia tożsamość logowania…');
    expect(await redirectOf(() => action(form({ provider: 'google' }) as never))).toBe(
      '/account/security?error=MFA_SOCIAL_LAST_CREDENTIAL',
    );
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await redirectOf(() => action(form({ provider: 'google' }) as never))).toBe('/account/security?error=FAILED');
  });
});
