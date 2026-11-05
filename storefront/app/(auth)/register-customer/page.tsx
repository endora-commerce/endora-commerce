import type { ReactNode } from 'react';
import { registerStandaloneCustomer } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import { setSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { subscribeNewsletter } from '../../../lib/api/newsletter';
import { getCustomerRegistrationOptions } from '../../../lib/api/customer-registration';
import { NewsletterConsent } from '../../../components/newsletter/NewsletterConsent';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Feature 040, US1 — standalone (org-less) customer registration. On success
 * the backend logs the new account straight in, so the server action persists
 * the session cookie and redirects to the account area.
 *
 * Issue #756 — when `customers.allow_registration_without_organization` is
 * off, the page says so before anything is typed: the notice and the link to
 * the organization registration, and no form. The backend's
 * REGISTRATION_REQUIRES_ORGANIZATION refusal stays the fallback, for a setting
 * switched off between render and submit (`?orgRequired=1`), and it is also
 * what answers when the setting could not be read and the form was shown.
 */
export default async function RegisterCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; orgRequired?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const orgRequired = params.orgRequired === '1';
  const { ctx, anonymousAccess, locale } = await getServerContext();
  const t = tForLocale(locale);
  // `specs/154-sales-channel-access/` — individual self-registration signs the
  // new account in at once, which would be a way into a store that serves
  // signed-in business customers only. The backend refuses it there; this
  // page does not offer it. The middleware already sends anonymous visitors to
  // the sign-in page; this catches a signed-in visitor arriving by link.
  if (!anonymousAccess) return await localeRedirect('/login');
  const channelCode = ctx.salesChannelCode ?? 'default';
  // Unreadable counts as offered: the form is what this page rendered before
  // the read existed, and the backend still refuses on submit.
  const offered =
    (await getCustomerRegistrationOptions(ctx))?.allowRegistrationWithoutOrganization !== false;

  const orgRequiredMessage = (
    <>
      {t('auth.registerCustomer.orgRequiredBefore')}{' '}
      <LocalizedLink href="/register">{t('auth.registerCustomer.orgRequiredLink')}</LocalizedLink>
      {t('auth.registerCustomer.orgRequiredAfter')}
    </>
  );
  const signInHint = (
    <p className="b2b-auth__hint">
      {t('auth.common.haveAccountPrompt')}{' '}
      <LocalizedLink href="/login">{t('nav.login')}</LocalizedLink>.
    </p>
  );

  if (!offered || orgRequired) {
    return (
      <div className="b2b-auth">
        <h1>{t('auth.registerCustomer.heading')}</h1>
        {orgRequired ? (
          <div className="b2b-auth__error">{orgRequiredMessage}</div>
        ) : (
          <p className="b2b-auth__notice" role="status">
            {orgRequiredMessage}
          </p>
        )}
        {signInHint}
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>{t('auth.registerCustomer.heading')}</h1>
      <p>{t('auth.registerCustomer.intro')}</p>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
      <form action={registerCustomerAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="first">{t('auth.field.firstName')}</label>
            <input id="first" name="firstName" required maxLength={120} placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="last">{t('auth.field.lastName')}</label>
            <input id="last" name="lastName" required maxLength={120} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="email">{t('auth.field.email')}</label>
          <input id="email" name="email" type="email" required placeholder=" " />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="password">{t('auth.field.newPasswordMin')}</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            placeholder=" "
          />
        </div>
        <input type="hidden" name="acceptedTermsVersion" value="2025-01" />
        <div className="b2b-auth__field">
          <NewsletterConsent channelCode={channelCode} ctx={ctx} />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.common.createAccount')}</button>
        </div>
      </form>
      {signInHint}
    </div>
  );
}

async function registerCustomerAction(formData: FormData): Promise<void> {
  'use server';
  let result;
  try {
    result = await registerStandaloneCustomer({
      email: (formData.get('email') as string) ?? '',
      password: (formData.get('password') as string) ?? '',
      firstName: (formData.get('firstName') as string) ?? '',
      lastName: (formData.get('lastName') as string) ?? '',
      acceptedTermsVersion: (formData.get('acceptedTermsVersion') as string) ?? '2025-01',
    });
  } catch (err) {
    if (err instanceof StorefrontApiError && err.code === 'REGISTRATION_REQUIRES_ORGANIZATION') {
      return await localeRedirect('/register-customer?orgRequired=1');
    }
    const message =
      err instanceof StorefrontApiError
        ? err.detail
        : tForLocale((await getServerContext()).locale)('auth.register.failed');
    return await localeRedirect(`/register-customer?error=${encodeURIComponent(message)}`);
  }
  // Newsletter consent (feature 048): subscribe the new account's email when the
  // consent checkbox was ticked. Never block registration on a subscribe failure.
  if (formData.get('newsletterConsent') === 'on' && result.customerAccount?.email) {
    try {
      const { ctx } = await getServerContext();
      await subscribeNewsletter({
        email: result.customerAccount.email,
        channelCode: ctx.salesChannelCode ?? 'default',
        source: 'registration',
      });
    } catch {
      // ignore — consent subscription is best-effort
    }
  }
  if (result.sessionCookieValue) {
    await setSessionCookie(result.sessionCookieValue);
  }
  return await localeRedirect('/account');
}
