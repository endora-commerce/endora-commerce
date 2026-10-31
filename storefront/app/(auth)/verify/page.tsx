import type { ReactNode } from 'react';
import { verifyEmail } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import type { Metadata } from 'next';
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
 * Email verification landing (T153). The registration mail links to
 * `/verify?token=...`; the page server-side calls the verify endpoint and
 * renders success/failure with no client JS.
 */

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const token = params.token;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (!token) {
    return (
      <div className="b2b-auth">
        <h1>{t('auth.verify.missing.heading')}</h1>
        <p className="b2b-auth__error">
          {t('auth.common.tokenMissingBefore')} <code>?token=</code>{' '}
          {t('auth.verify.missing.after')}
        </p>
      </div>
    );
  }

  let success = false;
  let error: string | null = null;
  try {
    await verifyEmail(token);
    success = true;
  } catch (err) {
    error = err instanceof StorefrontApiError ? err.detail : t('auth.verify.failed');
  }

  return (
    <div className="b2b-auth">
      <h1>{t('auth.verify.heading')}</h1>
      {success ? (
        <>
          <p className="b2b-auth__success">{t('auth.verify.success')}</p>
          <p>
            <LocalizedLink href="/login">{t('auth.verify.continue')}</LocalizedLink>.
          </p>
        </>
      ) : (
        <>
          <p className="b2b-auth__error">{error}</p>
          <p className="b2b-auth__hint">
            {t('auth.verify.newLinkPrompt')}{' '}
            <LocalizedLink href="/register">{t('auth.verify.registerAgain')}</LocalizedLink>
            {t('auth.verify.contactSupport')}
          </p>
        </>
      )}
    </div>
  );
}
