import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requestPasswordReset } from '../../../../lib/api/auth';

/**
 * Password-reset request page (T152). Backend always replies 202 to defend
 * against account enumeration, so we render the same acknowledgement
 * regardless of whether the email matched a real account.
 */

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; email?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  if (params.status === 'sent') {
    return (
      <div className="b2b-auth">
        <h1>Check your inbox</h1>
        <p className="b2b-auth__success">
          If <strong>{params.email}</strong> matches an account, we just emailed a reset link.
        </p>
        <p className="b2b-auth__hint">
          The link expires in 24 hours. <Link href="/login">Back to sign-in</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>Reset your password</h1>
      <p>Enter your account email — we&apos;ll send a reset link if it matches.</p>
      <form action={requestAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="reset-email">Email</label>
          <input id="reset-email" name="email" type="email" required autoComplete="email" placeholder=" " />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Send reset link</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        Remembered it? <Link href="/login">Sign in</Link>.
      </p>
    </div>
  );
}

async function requestAction(formData: FormData): Promise<void> {
  'use server';
  const email = ((formData.get('email') as string) ?? '').trim();
  // Always swallow errors — the backend's 202 + this page's identical UI
  // are what defends against account enumeration.
  try {
    await requestPasswordReset(email);
  } catch {
    /* ignore */
  }
  redirect(`/password-reset/request?status=sent&email=${encodeURIComponent(email)}`);
}
