import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { MfaStatus } from '../../lib/api/mfa';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from './i18n/text';
import { SECURITY_ERRORS } from '../../lib/auth/mfa-errors';

/**
 * Issue #935 — `/account/security` renders the "turn off" control from the
 * server's verdict. While the customer's only second factor is required — by
 * `mfa.storefront.totp_enforced` on this channel or by the organization's
 * policy — the form is not offered and the page says why; a refusal that
 * arrives anyway (a stale page) is worded from its code.
 */

let locale = 'en-US';
let status: MfaStatus;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getMfaSetupCookie: async () => null,
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
vi.mock('../../lib/api/mfa', () => ({
  getMfaStatus: async () => status,
  startMfaSetup: async () => undefined,
  activateMfa: async () => undefined,
  disableMfa: async () => undefined,
  regenerateMfaRecoveryCodes: async () => undefined,
  unlinkMfaSocialIdentity: async () => undefined,
}));

const { default: SecurityPage } = await import('../../app/account/security/page');

const ACTIVE: MfaStatus = {
  totpActive: true,
  recoveryCodesRemaining: 8,
  totpEnabledForScope: true,
  totpEnforcedForScope: false,
  canDisable: true,
  disableBlockedReason: null,
  socialLinks: [],
};
const REQUIRED: MfaStatus = {
  ...ACTIVE,
  totpEnforcedForScope: true,
  canDisable: false,
  disableBlockedReason: 'factor_required',
};

async function tree(sp: Record<string, string> = {}): Promise<unknown> {
  return (SecurityPage as unknown as (p: { searchParams: Promise<Record<string, string>> }) => unknown)({
    searchParams: Promise.resolve(sp),
  });
}
async function html(sp: Record<string, string> = {}): Promise<string> {
  return renderToString(<>{(await tree(sp)) as React.ReactNode}</>);
}

const BLOCKED_EN =
  'Two-step verification is required for your account, so it cannot be turned off here. The store or your organization requires it; if it should be lifted, ask your organization’s administrator.';
const BLOCKED_PL =
  'Weryfikacja dwuetapowa jest wymagana na Twoim koncie, więc nie można jej tu wyłączyć. Wymaga jej sklep albo Twoja organizacja; jeśli wymaganie ma zostać zniesione, zapytaj administratora organizacji.';

beforeEach(() => {
  locale = 'en-US';
  status = ACTIVE;
});

describe('/account/security — turning the last factor off (issue #935)', () => {
  it('offers the form when the server allows it', async () => {
    const out = await html();
    expect(visibleText(out)).toContain('Turn off two-step verification');
    expect(out).toContain('id="disable-code"');
    expect(visibleText(out)).not.toContain(BLOCKED_EN);
  });

  it('hides the form and says why while a requirement keeps the factor, in English and Polish', async () => {
    status = REQUIRED;
    const out = await html();
    expect(out).not.toContain('id="disable-code"');
    expect(visibleText(out)).not.toContain('Turn off two-step verification');
    expect(visibleText(out)).toContain(BLOCKED_EN);
    // Regenerating the codes keeps the factor, so it is still offered.
    expect(visibleText(out)).toContain('Regenerate recovery codes');

    locale = 'pl-PL';
    expect(visibleText(await html())).toContain(BLOCKED_PL);
  });

  it('carries the refusal as its code and words it in both languages', async () => {
    // What `disableAction` puts after `?error=` for the backend's refusal.
    const refusal = new StorefrontApiError(409, 'MFA_LAST_FACTOR_REQUIRED', 'Weryfikacji dwuetapowej nie można wyłączyć…');
    expect(SECURITY_ERRORS.failureCode(refusal, 'FAILED')).toBe('MFA_LAST_FACTOR_REQUIRED');

    status = REQUIRED;
    const en = visibleText(await html({ error: 'MFA_LAST_FACTOR_REQUIRED' }));
    expect(en).toContain('Two-step verification cannot be turned off, because the store or your organization requires it for your account.');
    locale = 'pl-PL';
    const pl = visibleText(await html({ error: 'MFA_LAST_FACTOR_REQUIRED' }));
    expect(pl).toContain('Nie można wyłączyć weryfikacji dwuetapowej, bo sklep albo Twoja organizacja wymaga jej na Twoim koncie.');
  });
});
