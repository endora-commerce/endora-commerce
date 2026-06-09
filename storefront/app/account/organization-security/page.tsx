import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { setOrganizationMfaPolicy } from '../../../lib/api/mfa';
import { StorefrontApiError } from '../../../lib/api/client';
import { getSessionCookie } from '../../../lib/session';

/**
 * Storefront organization-security page (feature 042, US3). An Organization
 * Administrator can require (or stop requiring) 2FA for their organization's
 * members. The backend enforces the org-admin role; a regular member's action
 * is refused.
 */
export default async function OrganizationSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/organization-security');
  const params = await searchParams;

  return (
    <div className="b2b-auth">
      <h1>Organization security</h1>
      <p>Require two-factor authentication for everyone in your organization.</p>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
      {params.done ? <p>Enforcement updated.</p> : null}
      <form action={enforceAction} className="b2b-auth__form">
        <input type="hidden" name="value" value="true" />
        <button type="submit">Require 2FA for all members</button>
      </form>
      <form action={enforceAction} className="b2b-auth__form">
        <input type="hidden" name="value" value="false" />
        <button type="submit">Stop requiring 2FA</button>
      </form>
    </div>
  );
}

async function enforceAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/organization-security');
  const enforce = (formData.get('value') as string) === 'true';
  try {
    await setOrganizationMfaPolicy(session, enforce);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : 'Could not update enforcement.';
    redirect(`/account/organization-security?error=${encodeURIComponent(message)}`);
  }
  redirect('/account/organization-security?done=1');
}
