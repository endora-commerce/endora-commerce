import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { loginCustomer } from '../../../../../lib/api/auth';
import { acceptInvitation } from '../../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../../lib/api/client';
import { setSessionCookie } from '../../../../../lib/session';

/**
 * Invitation redemption (email link → `/invitations/:token/accept`).
 * Matches `buildInvitationEmail` in the backend; submits to
 * `POST /api/v1/organizations/invitations/:token/accept`, then signs in.
 */

export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const { token } = await params;
  const { error } = await searchParams;

  return (
    <div className="b2b-auth">
      <h1>Accept invitation</h1>
      <p>Set your name and password to join the organization.</p>
      {error ? <div className="b2b-auth__error">{error}</div> : null}
      <form action={acceptInvitationAction} className="b2b-auth__form">
        <input type="hidden" name="token" value={token} />
        <div className="b2b-auth__field">
          <label htmlFor="invite-fn">First name</label>
          <input id="invite-fn" name="firstName" required autoComplete="given-name" maxLength={120} />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="invite-ln">Last name</label>
          <input id="invite-ln" name="lastName" required autoComplete="family-name" maxLength={120} />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="invite-pw">Password (at least 12 characters)</label>
          <input
            id="invite-pw"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            autoComplete="new-password"
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Create account</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        Wrong link? Ask your admin for a new invitation or{' '}
        <Link href="/login">sign in</Link> if you already have an account.
      </p>
    </div>
  );
}

async function acceptInvitationAction(formData: FormData): Promise<void> {
  'use server';

  const token = (formData.get('token') as string) ?? '';
  const firstName = ((formData.get('firstName') as string) ?? '').trim();
  const lastName = ((formData.get('lastName') as string) ?? '').trim();
  const password = (formData.get('password') as string) ?? '';

  const redirectWithError = (message: string): never => {
    const q = new URLSearchParams({ error: message });
    if (!token.trim()) {
      redirect(`/login?${q.toString()}`);
    }
    redirect(`/invitations/${encodeURIComponent(token)}/accept?${q.toString()}`);
  };

  if (!token.trim()) {
    redirectWithError('Invitation link is invalid.');
  }

  try {
    const { customerAccount } = await acceptInvitation(token, {
      password,
      firstName,
      lastName,
    });
    const login = await loginCustomer({
      email: customerAccount.email,
      password,
    });
    if (!login.sessionCookieValue) {
      redirectWithError('Account created but session could not be started. Sign in manually.');
      return;
    }
    await setSessionCookie(login.sessionCookieValue);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not accept invitation. Try again.';
    redirectWithError(message);
  }

  redirect('/account');
}
