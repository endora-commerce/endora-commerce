import type { ReactNode } from 'react';
import { registerOrganization } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import { Hook } from '../../../components/Hook';
import { CountryPicker } from '../../../lib/dictionary/pickers/CountryPicker';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront register page (T150 / FR-039). Renders the registration form
 * and submits via a server action. Success redirects to a "check your inbox"
 * acknowledgement; the server action stores the error message in the URL on
 * failure so the page can render it without client JS.
 */

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; email?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const status = params.status;
  const error = params.error;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (status === 'pending') {
    return (
      <>
        <Hook code="register.top" />
        <div className="b2b-auth">
          <h1>{t('auth.register.pending.heading')}</h1>
          <p className="b2b-auth__success">
            {t('auth.register.pending.sentBefore')} <strong>{params.email}</strong>
            {t('auth.register.pending.sentAfter')}
          </p>
          <p className="b2b-auth__hint">
            {t('auth.register.pending.verifiedPrompt')}{' '}
            <LocalizedLink href="/login">{t('nav.login')}</LocalizedLink>.
          </p>
        </div>
        <Hook code="register.bottom" />
      </>
    );
  }

  return (
    <>
      <Hook code="register.top" />
      <div className="b2b-auth">
        <h1>{t('auth.register.heading')}</h1>
        <p>{t('auth.register.intro')}</p>
        {error ? <div className="b2b-auth__error">{error}</div> : null}
        <form action={registerAction} className="b2b-auth__form">
          <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
            <legend style={{ fontWeight: 600 }}>{t('auth.register.organizationLegend')}</legend>
            <div className="b2b-auth__field">
              <label htmlFor="org-name">{t('auth.register.legalName')}</label>
              <input id="org-name" name="organizationName" required maxLength={255} placeholder=" " />
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="org-tax">{t('auth.register.taxId')}</label>
              <input id="org-tax" name="taxId" required minLength={8} maxLength={32} placeholder=" " />
            </div>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="addr-street">{t('auth.register.street')}</label>
                <input id="addr-street" name="street" required maxLength={255} placeholder=" " />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="addr-city">{t('checkout.address.city')}</label>
                <input id="addr-city" name="city" required maxLength={120} placeholder=" " />
              </div>
            </div>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="addr-postal">{t('checkout.address.postalCode')}</label>
                <input id="addr-postal" name="postalCode" required maxLength={20} placeholder=" " />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="addr-country">{t('auth.register.country')}</label>
                <CountryPicker
                  id="addr-country"
                  name="country"
                  required
                  defaultValue="PL"
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
            <legend style={{ fontWeight: 600 }}>{t('auth.register.ownerLegend')}</legend>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="user-first">{t('auth.field.firstName')}</label>
                <input id="user-first" name="firstName" required maxLength={120} placeholder=" " />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="user-last">{t('auth.field.lastName')}</label>
                <input id="user-last" name="lastName" required maxLength={120} placeholder=" " />
              </div>
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="user-email">{t('auth.field.email')}</label>
              <input id="user-email" name="email" type="email" required placeholder=" " />
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="user-password">{t('auth.field.newPasswordMin')}</label>
              <input
                id="user-password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={256}
                placeholder=" "
              />
            </div>
          </fieldset>
          <input type="hidden" name="acceptedTermsVersion" value="2025-01" />
          <div className="b2b-auth__actions">
            <button type="submit">{t('auth.common.createAccount')}</button>
          </div>
        </form>
        <p className="b2b-auth__hint">
          {t('auth.common.haveAccountPrompt')}{' '}
          <LocalizedLink href="/login">{t('nav.login')}</LocalizedLink>.
        </p>
      </div>
      <Hook code="register.bottom" />
    </>
  );
}

async function registerAction(formData: FormData): Promise<void> {
  'use server';
  const email = (formData.get('email') as string | null) ?? '';
  try {
    await registerOrganization({
      organization: {
        name: (formData.get('organizationName') as string) ?? '',
        taxId: (formData.get('taxId') as string) ?? '',
        registeredAddress: {
          street: (formData.get('street') as string) ?? '',
          city: (formData.get('city') as string) ?? '',
          postalCode: (formData.get('postalCode') as string) ?? '',
          country: ((formData.get('country') as string) ?? '').toUpperCase(),
        },
      },
      firstUser: {
        email,
        password: (formData.get('password') as string) ?? '',
        firstName: (formData.get('firstName') as string) ?? '',
        lastName: (formData.get('lastName') as string) ?? '',
      },
      acceptedTermsVersion: (formData.get('acceptedTermsVersion') as string) ?? '2025-01',
    });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError
        ? err.detail
        : tForLocale((await getServerContext()).locale)('auth.register.failed');
    return await localeRedirect(`/register?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/register?status=pending&email=${encodeURIComponent(email)}`);
}
