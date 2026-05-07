import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { confirmPasswordReset } from '../../../../lib/api/auth';
import { StorefrontApiError } from '../../../../lib/api/client';

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

  if (status === 'done') {
    return (
      <div className="b2b-auth">
        <h1>Password updated</h1>
        <p className="b2b-auth__success">You can now sign in with your new password.</p>
        <p>
          <Link href="/login">Continue to sign-in</Link>.
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="b2b-auth">
        <h1>Reset link missing</h1>
        <p className="b2b-auth__error">
          This page expects a <code>?token=</code> query parameter from your reset email.
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>Choose a new password</h1>
      {error ? <div className="b2b-auth__error">{error}</div> : null}
      <form action={confirmAction} className="b2b-auth__form">
        <input type="hidden" name="token" value={token} />
        <div className="b2b-auth__field">
          <label htmlFor="new-password">New password (min 12 characters)</label>
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
          <button type="submit">Update password</button>
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
      err instanceof StorefrontApiError ? err.message : 'Could not reset your password.';
    redirect(
      `/password-reset/confirm?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`,
    );
  }
  redirect(`/password-reset/confirm?status=done`);
}
