import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  activateMfa,
  disableMfa,
  getMfaStatus,
  regenerateMfaRecoveryCodes,
  startMfaSetup,
  unlinkMfaSocialIdentity,
} from '../../../lib/api/mfa';
import { SocialLinksPanel } from '../../../components/account/SocialLinksPanel';
import { StorefrontApiError } from '../../../lib/api/client';
import { getServerContext } from '../../../lib/server-context';
import {
  clearMfaSetupCookie,
  getMfaSetupCookie,
  getSessionCookie,
  readAndClearMfaRecoveryFlash,
  setMfaRecoveryFlash,
  setMfaSetupCookie,
} from '../../../lib/session';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { tForLocale } from '../../../lib/i18n/messages';
import { format } from '../../../lib/i18n/format';
import { formatCount } from '../../../lib/orderMinimum';

type Translate = ReturnType<typeof tForLocale>;

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront account security page (feature 042, US1). Lets a customer enable
 * TOTP 2FA (scan → confirm → save recovery codes), disable it, and regenerate
 * recovery codes. Multi-step state is carried in short-lived httpOnly cookies
 * so the flow survives the server-action round-trips.
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');

  // Constitution XVII item 5 — this whole page is `mfa`'s contribution to the
  // storefront, so it goes when the module does. Without this it kept offering
  // "Turn on two-step verification" for a capability that was switched off, and every server
  // action below answered 503 on the click. Absence is projected rather than
  // inferred from that 503: the page is not rendered at all.
  const { modules, locale } = await getServerContext();
  if (!modules.isPresent('mfa')) notFound();
  const t = tForLocale(locale);

  const params = await searchParams;

  const status = await getMfaStatus(session);
  const recoveryFlash = await readAndClearMfaRecoveryFlash();

  return (
    <div className="b2b-auth">
      <h1>{t('auth.security.heading')}</h1>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}

      {recoveryFlash ? <RecoveryCodes codes={recoveryFlash} t={t} /> : null}

      {status.totpActive ? (
        <ActivePanel remaining={formatCount(status.recoveryCodesRemaining, locale)} t={t} />
      ) : params.step === 'confirm' ? (
        await ConfirmPanel({ t })
      ) : (
        <StartPanel t={t} />
      )}

      {/* Issue #194 — the identities that can sign into this account. The
          server sends them; the panel renders nothing when there are none. */}
      <SocialLinksPanel
        links={status.socialLinks}
        locale={locale}
        unlinkAction={unlinkSocialAction}
      />
    </div>
  );
}

function StartPanel({ t }: { t: Translate }): ReactNode {
  return (
    <section>
      <h2>{t('auth.security.start.heading')}</h2>
      <p>{t('auth.security.start.intro')}</p>
      <form action={startAction}>
        <button type="submit">{t('auth.security.start.submit')}</button>
      </form>
    </section>
  );
}

async function ConfirmPanel({ t }: { t: Translate }): Promise<ReactNode> {
  const setup = await getMfaSetupCookie();
  if (!setup) {
    return await localeRedirect('/account/security');
  }
  return (
    <section>
      <h2>{t('auth.security.confirm.heading')}</h2>
      <p>{t('auth.security.confirm.intro')}</p>
      <p>
        <code>{setup.otpauthUri}</code>
      </p>
      <p>
        {t('auth.mfa.manualKey')} <code>{setup.secret}</code>
      </p>
      <form action={confirmAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="confirm-code">{t('auth.mfa.sixDigitCode')}</label>
          <input
            id="confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.security.confirm.submit')}</button>
        </div>
      </form>
    </section>
  );
}

function ActivePanel({ remaining, t }: { remaining: string; t: Translate }): ReactNode {
  return (
    <section>
      <h2>{t('auth.security.active.heading')}</h2>
      <p>{format(t('auth.security.active.remaining'), { count: remaining })}</p>
      <form action={disableAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="disable-code">{t('auth.security.active.disableLabel')}</label>
          <input id="disable-code" name="code" autoComplete="one-time-code" required placeholder="123456" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.security.active.disable')}</button>
        </div>
      </form>
      <form action={regenerateAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="regen-code">{t('auth.security.active.regenerateLabel')}</label>
          <input id="regen-code" name="code" inputMode="numeric" required placeholder="123456" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.security.active.regenerate')}</button>
        </div>
      </form>
    </section>
  );
}

function RecoveryCodes({ codes, t }: { codes: string[]; t: Translate }): ReactNode {
  return (
    <section className="b2b-auth__recovery">
      <h2>{t('auth.security.recovery.heading')}</h2>
      <p>{t('auth.security.recovery.intro')}</p>
      <ul>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function startAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');
  try {
    const { secret, otpauthUri } = await startMfaSetup(session);
    await setMfaSetupCookie({ secret, otpauthUri });
  } catch (err) {
    return await localeRedirect(`/account/security?error=${encodeURIComponent(await errMsg(err))}`);
  }
  return await localeRedirect('/account/security?step=confirm');
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    const { recoveryCodes } = await activateMfa(session, code);
    await clearMfaSetupCookie();
    await setMfaRecoveryFlash(recoveryCodes);
  } catch (err) {
    return await localeRedirect(`/account/security?step=confirm&error=${encodeURIComponent(await errMsg(err))}`);
  }
  return await localeRedirect('/account/security');
}

async function disableAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    await disableMfa(session, code);
  } catch (err) {
    return await localeRedirect(`/account/security?error=${encodeURIComponent(await errMsg(err))}`);
  }
  return await localeRedirect('/account/security');
}

async function regenerateAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    const { recoveryCodes } = await regenerateMfaRecoveryCodes(session, code);
    await setMfaRecoveryFlash(recoveryCodes);
  } catch (err) {
    return await localeRedirect(`/account/security?error=${encodeURIComponent(await errMsg(err))}`);
  }
  return await localeRedirect('/account/security');
}

async function unlinkSocialAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/security');
  const provider = (formData.get('provider') as string) ?? '';
  if (provider !== 'google' && provider !== 'microsoft') return await localeRedirect('/account/security');
  try {
    await unlinkMfaSocialIdentity(session, provider);
  } catch (err) {
    // The refusal lands here too — the backend has the last word on whether an
    // account may lose a link, and its sentence is already localized.
    return await localeRedirect(`/account/security?error=${encodeURIComponent(await errMsg(err))}`);
  }
  return await localeRedirect('/account/security');
}

async function errMsg(err: unknown): Promise<string> {
  if (err instanceof StorefrontApiError) return err.detail;
  return tForLocale((await getServerContext()).locale)('auth.security.failed');
}
