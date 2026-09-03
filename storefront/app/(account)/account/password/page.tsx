import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../../lib/session';
import { changePassword } from '../../../../lib/api/account';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';

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
  if (!session) redirect('/login');
  const params = await searchParams;

  return (
    <>
      <h2>Change password</h2>
      {params.status === 'updated' ? (
        <p className="b2b-auth__success">Your password is updated.</p>
      ) : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}
      <form action={changePasswordAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="current-pw">Current password</label>
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
          <label htmlFor="new-pw">New password (min 12 characters)</label>
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
          <button type="submit">Update password</button>
        </div>
      </form>
    </>
  );
}

async function changePasswordAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const currentPassword = (formData.get('currentPassword') as string) ?? '';
  const newPassword = (formData.get('newPassword') as string) ?? '';
  try {
    await changePassword(session, currentPassword, newPassword);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not update your password.';
    redirect(`/account/password?error=${encodeURIComponent(message)}`);
  }
  redirect(`/account/password?status=updated`);
}
