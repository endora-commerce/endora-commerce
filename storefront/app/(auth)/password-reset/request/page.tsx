import type { ReactNode } from 'react';
import { requestPasswordReset } from '../../../../lib/api/auth';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Password-reset request page (T152). Backend always replies 202 to defend
 * against account enumeration, so we render the same acknowledgement
 * regardless of whether the email matched a real account.
 */

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; email?: string; error?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  if (params.status === 'sent') {
    return (
      <div className="b2b-auth">
        <h1>{t('auth.passwordReset.sent.heading')}</h1>
        <p className="b2b-auth__success">
          {t('auth.passwordReset.sent.before')} <strong>{params.email}</strong>{' '}
          {t('auth.passwordReset.sent.after')}
        </p>
        <p className="b2b-auth__hint">
          {t('auth.passwordReset.sent.expiry')}{' '}
          <LocalizedLink href="/login">{t('auth.passwordReset.sent.backToSignIn')}</LocalizedLink>.
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>{t('auth.passwordReset.request.heading')}</h1>
      <p>{t('auth.passwordReset.request.intro')}</p>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
      <form action={requestAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="reset-email">{t('auth.field.email')}</label>
          <input id="reset-email" name="email" type="email" required autoComplete="email" placeholder=" " />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.passwordReset.request.submit')}</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        {t('auth.passwordReset.request.rememberedPrompt')}{' '}
        <LocalizedLink href="/login">{t('nav.login')}</LocalizedLink>.
      </p>
    </div>
  );
}

async function requestAction(formData: FormData): Promise<void> {
  'use server';
  const email = ((formData.get('email') as string) ?? '').trim();
  // Swallow errors — the backend's 202 + this page's identical UI are what
  // defends against account enumeration. The one exception is the request
  // limit: it is counted per address whether or not an account has it, so
  // saying "wait" reveals nothing, and saying "check your inbox" would promise
  // an e-mail that was not sent.
  let throttled: string | null = null;
  try {
    await requestPasswordReset(email);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.code === 'CUSTOMER_AUTHENTICATION_THROTTLED') {
      throttled = err.detail;
    }
  }
  if (throttled !== null) {
    return await localeRedirect(`/password-reset/request?error=${encodeURIComponent(throttled)}`);
  }
  return await localeRedirect(`/password-reset/request?status=sent&email=${encodeURIComponent(email)}`);
}
