import type { ReactNode } from 'react';
import { completeMfaSetupTicket } from '../../../../lib/api/mfa';
import { StorefrontApiError } from '../../../../lib/api/client';
import {
  clearMfaSetupTicketCookie,
  getMfaSetupTicketCookie,
  setMfaRecoveryFlash,
  setSessionCookie,
} from '../../../../lib/session';
import { Hook } from '../../../../components/Hook';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront forced-enrolment screen (feature 042, US3). Reached when login
 * returned `mfaSetupRequired` (2FA enforced for the account's scope). The
 * customer scans the secret and confirms a code; on success a session is
 * issued and recovery codes are shown on the account security page.
 */
export default async function ForcedSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const nextPath = sanitiseNext(params.next);
  const ticket = await getMfaSetupTicketCookie();
  if (!ticket) {
    return await localeRedirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <>
      <Hook code="login.top" />
      <div className="b2b-auth">
        <h1>{t('auth.mfaSetup.heading')}</h1>
        <p>{t('auth.mfaSetup.intro')}</p>
        {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
        <p>
          <code>{ticket.otpauthUri}</code>
        </p>
        <p>
          {t('auth.mfa.manualKey')} <code>{ticket.secret}</code>
        </p>
        <form action={completeAction} className="b2b-auth__form">
          <input type="hidden" name="next" value={nextPath} />
          <div className="b2b-auth__field">
            <label htmlFor="setup-code">{t('auth.mfa.sixDigitCode')}</label>
            <input
              id="setup-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456"
            />
          </div>
          <div className="b2b-auth__actions">
            <button type="submit">{t('auth.mfaSetup.submit')}</button>
          </div>
        </form>
      </div>
      <Hook code="login.bottom" />
    </>
  );
}

async function completeAction(formData: FormData): Promise<void> {
  'use server';
  const code = ((formData.get('code') as string) ?? '').trim();
  const next = sanitiseNext((formData.get('next') as string) ?? '/account');
  const ticket = await getMfaSetupTicketCookie();
  if (!ticket) {
    return await localeRedirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const t = tForLocale((await getServerContext()).locale);

  let result;
  try {
    result = await completeMfaSetupTicket(ticket.setupTicket, code);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : t('auth.mfaSetup.failed');
    return await localeRedirect(`/login/setup?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  if (!result.sessionCookieValue) {
    return await localeRedirect(`/login/setup?error=${encodeURIComponent(t('auth.mfaSetup.failed'))}&next=${encodeURIComponent(next)}`);
  }
  await setSessionCookie(result.sessionCookieValue);
  await clearMfaSetupTicketCookie();
  // Surface the recovery codes once on the security page.
  await setMfaRecoveryFlash(result.recoveryCodes);
  return await localeRedirect('/account/security');
}

function sanitiseNext(input: string | undefined): string {
  if (!input) return '/account';
  if (!input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}
