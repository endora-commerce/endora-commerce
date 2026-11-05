import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Hook } from '../../../components/Hook';
import { RegisterForm } from '../../../components/auth/RegisterForm';
import { getRegistrationOptions } from '../../../lib/api/registry-lookup';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';
import { lookupCompanyAction, registerFormAction } from './actions';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront register page (T150 / FR-039). A Server Component shell around
 * the client {@link RegisterForm}: it reads the server context and whether the
 * company registry lookup is on (feature 173 — the options read fails closed,
 * so any error renders the manual form). Success redirects to a "check your
 * inbox" acknowledgement. A refused registration comes back as the form's
 * state, not in the URL; an old `?error=` link is ignored.
 */

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; email?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (params.status === 'pending') {
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

  const options = await getRegistrationOptions();

  return (
    <>
      <Hook code="register.top" />
      <div className="b2b-auth">
        <h1>{t('auth.register.heading')}</h1>
        <p>{t('auth.register.intro')}</p>
        <RegisterForm
          locale={locale}
          lookupEnabled={options.enabled}
          action={registerFormAction}
          lookupAction={lookupCompanyAction}
        />
        <p className="b2b-auth__hint">
          {t('auth.common.haveAccountPrompt')}{' '}
          <LocalizedLink href="/login">{t('nav.login')}</LocalizedLink>.
        </p>
      </div>
      <Hook code="register.bottom" />
    </>
  );
}
