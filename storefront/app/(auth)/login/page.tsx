import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { loginCustomer } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import {
  clearAnonCartCookie,
  setCartMergeFlash,
  setSessionCookie,
} from '../../../lib/session';
import { Hook } from '../../../components/Hook';

/**
 * Storefront login page (T151 / FR-040). Submits via a server action,
 * persists the session cookie via `setSessionCookie`, and redirects to the
 * `next` query parameter (default: `/account`). The form exposes an
 * optional 2FA code field — passed straight through to the backend so
 * second-factor enforcement can be turned on without a UI change.
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const error = params.error;
  const nextPath = sanitiseNext(params.next);

  return (
    <>
      <Hook code="login.top" />
      <div className="b2b-auth">
        <h1>Sign in</h1>
        <p>Use your work email and password.</p>
        {error ? <div className="b2b-auth__error">{error}</div> : null}
        <form action={loginAction} className="b2b-auth__form">
          <input type="hidden" name="next" value={nextPath} />
          <div className="b2b-auth__field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" name="email" type="email" required autoComplete="email" placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder=" "
            />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="login-2fa">Two-factor code (if enabled)</label>
            <input
              id="login-2fa"
              name="twoFactorCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
            />
          </div>
          <div className="b2b-auth__actions">
            <button type="submit">Sign in</button>
          </div>
        </form>
        <p className="b2b-auth__hint">
          Forgot your password? <Link href="/password-reset/request">Reset it</Link>.
        </p>
        <p className="b2b-auth__hint">
          New here? <Link href="/register">Create an account</Link>.
        </p>
      </div>
      <Hook code="login.bottom" />
    </>
  );
}

async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const email = (formData.get('email') as string) ?? '';
  const password = (formData.get('password') as string) ?? '';
  const twoFactorCode = (formData.get('twoFactorCode') as string | null) || undefined;
  const next = sanitiseNext((formData.get('next') as string) ?? '/account');

  // Only the network/auth call is wrapped — the `redirect()` calls below must
  // stay OUTSIDE the try, otherwise Next's `NEXT_REDIRECT` control-flow throw
  // is caught here and re-routed into the error branch, blanking the page.
  let result;
  try {
    result = await loginCustomer({
      email,
      password,
      ...(twoFactorCode ? { twoFactorCode } : {}),
    });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : 'Sign-in failed. Please try again.';
    redirect(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  if (!result.sessionCookieValue) {
    redirect(
      `/login?error=${encodeURIComponent('Sign-in failed. Please try again.')}&next=${encodeURIComponent(next)}`,
    );
  }
  await setSessionCookie(result.sessionCookieValue);
  // Feature 037 — when the login carried an anonymous cart and the
  // backend's merge had an observable effect, write a short-lived flash
  // cookie so the next page render can show the confirmation toast.
  // `noop` outcomes deliberately skip the flash (FR-018).
  if (
    result.cartMerge?.outcome === 'adopted' ||
    result.cartMerge?.outcome === 'merged'
  ) {
    // The anon cart was drained into the customer cart and marked completed
    // backend-side; drop the now-stale anon cookie so later reads (e.g. after
    // a session expiry) don't fall back to that emptied cart and make the cart
    // appear to vanish.
    await clearAnonCartCookie();
    await setCartMergeFlash(result.cartMerge.outcome);
  }
  redirect(next);
}

/** Only allow same-origin paths in `?next=` to defend against open-redirect. */
function sanitiseNext(input: string | undefined): string {
  if (!input) return '/account';
  if (!input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}
