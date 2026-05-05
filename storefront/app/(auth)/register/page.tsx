import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { registerOrganization } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import { Hook } from '../../../components/Hook';

/**
 * Storefront register page (T150 / FR-039). Renders the registration form
 * and submits via a server action. Success redirects to a "check your inbox"
 * acknowledgement; the server action stores the error message in the URL on
 * failure so the page can render it without client JS.
 */

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; email?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const status = params.status;
  const error = params.error;

  if (status === 'pending') {
    return (
      <>
        <Hook code="register.top" />
        <div className="b2b-auth">
          <h1>Almost there</h1>
          <p className="b2b-auth__success">
            We sent a verification email to <strong>{params.email}</strong>. Click the link in
            that email to activate your account.
          </p>
          <p className="b2b-auth__hint">
            Already verified? <Link href="/login">Sign in</Link>.
          </p>
        </div>
        <Hook code="register.bottom" />
      </>
    );
  }

  return (
    <>
      <Hook code="register.top" />
      <div className="b2b-auth">
        <h1>Create your business account</h1>
        <p>Tell us about your organization. We use this to set up invoicing and tax handling.</p>
        {error ? <div className="b2b-auth__error">{error}</div> : null}
        <form action={registerAction} className="b2b-auth__form">
          <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
            <legend style={{ fontWeight: 600 }}>Organization</legend>
            <div className="b2b-auth__field">
              <label htmlFor="org-name">Legal name</label>
              <input id="org-name" name="organizationName" required maxLength={255} />
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="org-tax">Tax ID</label>
              <input id="org-tax" name="taxId" required minLength={8} maxLength={32} />
            </div>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="addr-street">Street</label>
                <input id="addr-street" name="street" required maxLength={255} />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="addr-city">City</label>
                <input id="addr-city" name="city" required maxLength={120} />
              </div>
            </div>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="addr-postal">Postal code</label>
                <input id="addr-postal" name="postalCode" required maxLength={20} />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="addr-country">Country (ISO-2)</label>
                <input
                  id="addr-country"
                  name="country"
                  required
                  minLength={2}
                  maxLength={2}
                  placeholder="PL"
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
            <legend style={{ fontWeight: 600 }}>Account owner</legend>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="user-first">First name</label>
                <input id="user-first" name="firstName" required maxLength={120} />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="user-last">Last name</label>
                <input id="user-last" name="lastName" required maxLength={120} />
              </div>
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="user-email">Email</label>
              <input id="user-email" name="email" type="email" required />
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="user-password">Password (min 12 characters)</label>
              <input
                id="user-password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={256}
              />
            </div>
          </fieldset>
          <input type="hidden" name="acceptedTermsVersion" value="2025-01" />
          <div className="b2b-auth__actions">
            <button type="submit">Create account</button>
          </div>
        </form>
        <p className="b2b-auth__hint">
          Already have an account? <Link href="/login">Sign in</Link>.
        </p>
      </div>
      <Hook code="register.bottom" />
    </>
  );
}

async function registerAction(formData: FormData): Promise<void> {
  'use server';
  const email = (formData.get('email') as string | null) ?? '';
  try {
    await registerOrganization({
      organization: {
        name: (formData.get('organizationName') as string) ?? '',
        taxId: (formData.get('taxId') as string) ?? '',
        registeredAddress: {
          street: (formData.get('street') as string) ?? '',
          city: (formData.get('city') as string) ?? '',
          postalCode: (formData.get('postalCode') as string) ?? '',
          country: ((formData.get('country') as string) ?? '').toUpperCase(),
        },
      },
      firstUser: {
        email,
        password: (formData.get('password') as string) ?? '',
        firstName: (formData.get('firstName') as string) ?? '',
        lastName: (formData.get('lastName') as string) ?? '',
      },
      acceptedTermsVersion: (formData.get('acceptedTermsVersion') as string) ?? '2025-01',
    });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Registration failed. Please try again.';
    redirect(`/register?error=${encodeURIComponent(message)}`);
  }
  redirect(`/register?status=pending&email=${encodeURIComponent(email)}`);
}
