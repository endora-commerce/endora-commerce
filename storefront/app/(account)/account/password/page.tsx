import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../../lib/session';
import { changePassword } from '../../../../lib/api/account';
import { StorefrontApiError } from '../../../../lib/api/client';
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
 * Change password (T154 / FR-040). Re-uses `POST /api/v1/me/password` —
 * argon2-verifies the current password then re-hashes the new one.
 */

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const params = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <>
      <h2>{t('account.password.heading')}</h2>
      {params.status === 'updated' ? (
        <p className="b2b-auth__success">{t('account.password.updated')}</p>
      ) : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}
      <form action={changePasswordAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="current-pw">{t('account.password.current')}</label>
          <input
            id="current-pw"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            placeholder=" "
          />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="new-pw">{t('account.password.new')}</label>
          <input
            id="new-pw"
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
          <button type="submit">{t('account.password.submit')}</button>
        </div>
      </form>
    </>
  );
}

async function changePasswordAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const currentPassword = (formData.get('currentPassword') as string) ?? '';
  const newPassword = (formData.get('newPassword') as string) ?? '';
  const { locale } = await getServerContext();
  try {
    await changePassword(session, currentPassword, newPassword);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : tForLocale(locale)('account.password.failed');
    return await localeRedirect(`/account/password?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/account/password?status=updated`);
}
