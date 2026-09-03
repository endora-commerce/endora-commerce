import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { registerStandaloneCustomer } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import { setSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { subscribeNewsletter } from '../../../lib/api/newsletter';
import { NewsletterConsent } from '../../../components/newsletter/NewsletterConsent';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Feature 040, US1 — standalone (org-less) customer registration. On success
 * the backend logs the new account straight in, so the server action persists
 * the session cookie and redirects to the account area. When the platform has
 * disabled org-less registration, the backend returns
 * REGISTRATION_REQUIRES_ORGANIZATION and the page surfaces a clear message with
 * a link to the organization-registration flow.
 */
export default async function RegisterCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; orgRequired?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const orgRequired = params.orgRequired === '1';
  const { ctx } = await getServerContext();
  const channelCode = ctx.salesChannelCode ?? 'default';

  return (
    <div className="b2b-auth">
      <h1>Create your account</h1>
      <p>Register a personal account to browse and order. You can be linked to an organization later.</p>
      {orgRequired ? (
        <div className="b2b-auth__error">
          Registration without an organization is currently disabled.{' '}
          <Link href="/register">Register your organization</Link> instead.
        </div>
      ) : params.error ? (
        <div className="b2b-auth__error">{params.error}</div>
      ) : null}
      <form action={registerCustomerAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="first">First name</label>
            <input id="first" name="firstName" required maxLength={120} placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="last">Last name</label>
            <input id="last" name="lastName" required maxLength={120} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required placeholder=" " />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="password">Password (min 12 characters)</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            placeholder=" "
          />
        </div>
        <input type="hidden" name="acceptedTermsVersion" value="2025-01" />
        <div className="b2b-auth__field">
          <NewsletterConsent channelCode={channelCode} ctx={ctx} />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Create account</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        Already have an account? <Link href="/login">Sign in</Link>.
      </p>
    </div>
  );
}

async function registerCustomerAction(formData: FormData): Promise<void> {
  'use server';
  let result;
  try {
    result = await registerStandaloneCustomer({
      email: (formData.get('email') as string) ?? '',
      password: (formData.get('password') as string) ?? '',
      firstName: (formData.get('firstName') as string) ?? '',
      lastName: (formData.get('lastName') as string) ?? '',
      acceptedTermsVersion: (formData.get('acceptedTermsVersion') as string) ?? '2025-01',
    });
  } catch (err) {
    if (err instanceof StorefrontApiError && err.code === 'REGISTRATION_REQUIRES_ORGANIZATION') {
      redirect('/register-customer?orgRequired=1');
    }
    const message =
      err instanceof StorefrontApiError ? err.message : 'Registration failed. Please try again.';
    redirect(`/register-customer?error=${encodeURIComponent(message)}`);
  }
  // Newsletter consent (feature 048): subscribe the new account's email when the
  // consent checkbox was ticked. Never block registration on a subscribe failure.
  if (formData.get('newsletterConsent') === 'on' && result.customerAccount?.email) {
    try {
      const { ctx } = await getServerContext();
      await subscribeNewsletter({
        email: result.customerAccount.email,
        channelCode: ctx.salesChannelCode ?? 'default',
        source: 'registration',
      });
    } catch {
      // ignore — consent subscription is best-effort
    }
  }
  if (result.sessionCookieValue) {
    await setSessionCookie(result.sessionCookieValue);
  }
  redirect('/account');
}
