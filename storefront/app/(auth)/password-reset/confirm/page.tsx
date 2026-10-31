import type { ReactNode } from 'react';
import { confirmPasswordReset } from '../../../../lib/api/auth';
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
 * Password-reset confirm page (T152). The reset email links to
 * `/password-reset/confirm?token=...`; the user enters a new password,
 * we POST it, and redirect to `/login` on success.
 */

export default async function PasswordResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string; error?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const token = params.token ?? '';
  const status = params.status;
  const error = params.error;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (status === 'done') {
    return (
      <div className="b2b-auth">
        <h1>{t('auth.passwordReset.done.heading')}</h1>
        <p className="b2b-auth__success">{t('auth.passwordReset.done.body')}</p>
        <p>
          <LocalizedLink href="/login">{t('auth.passwordReset.done.continue')}</LocalizedLink>.
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="b2b-auth">
        <h1>{t('auth.passwordReset.missing.heading')}</h1>
        <p className="b2b-auth__error">
          {t('auth.common.tokenMissingBefore')} <code>?token=</code>{' '}
          {t('auth.passwordReset.missing.after')}
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>{t('auth.passwordReset.confirm.heading')}</h1>
      {error ? <div className="b2b-auth__error">{error}</div> : null}
      <form action={confirmAction} className="b2b-auth__form">
        <input type="hidden" name="token" value={token} />
        <div className="b2b-auth__field">
          <label htmlFor="new-password">{t('auth.passwordReset.confirm.newPassword')}</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            required
            minLength={12}
            maxLength={256}
            autoComplete="new-password"
            placeholder=" "
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.passwordReset.confirm.submit')}</button>
        </div>
      </form>
    </div>
  );
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const token = (formData.get('token') as string) ?? '';
  const newPassword = (formData.get('newPassword') as string) ?? '';
  try {
    await confirmPasswordReset(token, newPassword);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError
        ? err.detail
        : tForLocale((await getServerContext()).locale)('auth.passwordReset.confirm.failed');
    return await localeRedirect(
      `/password-reset/confirm?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`,
    );
  }
  return await localeRedirect(`/password-reset/confirm?status=done`);
}
