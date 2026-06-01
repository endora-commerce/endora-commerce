import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionCookie, clearSessionCookie } from '../../lib/session';
import { getMe, getMyCustomerProfile } from '../../lib/api/account';
import { logoutCustomer } from '../../lib/api/auth';
import { StorefrontApiError } from '../../lib/api/client';
import { ImpersonationBanner } from '../../components/ImpersonationBanner';

/**
 * Authenticated route-group layout (T154 + T155). Loads `/me` once for the
 * sidebar so individual pages don't have to re-fetch the customer just to
 * render the navigation. If the session is missing or expired, the layout
 * redirects to `/login?next=...` instead of leaking a half-rendered page.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account');

  let me;
  try {
    me = await getMe(session);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 401) {
      redirect('/session-expired?next=/account');
    }
    // Feature 040 — standalone (org-less) customers cannot load the org-bound
    // `/me` (422). Render a reduced account shell (no organization features,
    // FR-003) from the org-optional profile instead of erroring.
    if (err instanceof StorefrontApiError && err.status === 422) {
      const profile = await getMyCustomerProfile(session);
      return (
        <section className="b2b-account">
          <aside className="b2b-account__nav" aria-label="Account">
            <strong>
              {profile.firstName} {profile.lastName}
            </strong>
            <Link href="/account">Profile</Link>
            <Link href="/account/orders">Orders</Link>
            <Link href="/addresses">Addresses</Link>
            <Link href="/account/password">Change password</Link>
            <Link href="/account/two-factor">Two-factor</Link>
            <form action={logoutAction}>
              <button type="submit" className="b2b-account__logout">
                Sign out
              </button>
            </form>
          </aside>
          <div className="b2b-account__panel">{children}</div>
        </section>
      );
    }
    throw err;
  }

  const isAdmin = me.customerAccount.role === 'organization_admin';

  return (
    <section className="b2b-account">
      {me.impersonation ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ImpersonationBanner
            impersonatorAdminUserId={me.impersonation.impersonatorAdminUserId}
          />
        </div>
      ) : null}
      <aside className="b2b-account__nav" aria-label="Account">
        <strong>{me.customerAccount.firstName} {me.customerAccount.lastName}</strong>
        <span className="muted">{me.organization.name}</span>
        <Link href="/account">Profile</Link>
        <Link href="/account/orders">Orders</Link>
        <Link href="/quote-requests">Quote requests</Link>
        <Link href="/shopping-lists">Shopping lists</Link>
        <Link href="/quick-order">Quick order</Link>
        <Link href="/account/password">Change password</Link>
        <Link href="/account/two-factor">Two-factor</Link>
        <Link href="/addresses">My addresses</Link>
        <Link href="/organization">Organization</Link>
        <Link href="/organization/addresses">Org addresses</Link>
        {isAdmin ? <Link href="/organization/members">Members</Link> : null}
        <form action={logoutAction}>
          <button type="submit" className="b2b-account__logout">
            Sign out
          </button>
        </form>
      </aside>
      <div className="b2b-account__panel">{children}</div>
    </section>
  );
}

async function logoutAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  await logoutCustomer(session);
  await clearSessionCookie();
  redirect('/login');
}
