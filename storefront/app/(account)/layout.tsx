import type { ReactNode } from 'react';
import { getSessionCookie, clearSessionCookie } from '../../lib/session';
import { getMe } from '../../lib/api/account';
import { logoutCustomer } from '../../lib/api/auth';
import { StorefrontApiError } from '../../lib/api/client';
import { ImpersonationBanner } from '../../components/ImpersonationBanner';
import { SignOutButton } from '../../components/account/SignOutButton';
import { localeRedirect } from '../../lib/i18n/navigation';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { getServerContext } from '../../lib/server-context';
import { tForLocale } from '../../lib/i18n/messages';

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
  if (!session) return await localeRedirect('/login?next=/account');

  let me;
  try {
    me = await getMe(session);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 401) {
      return await localeRedirect('/session-expired?next=/account');
    }
    throw err;
  }

  const isAdmin = me.customerAccount.role === 'organization_admin';
  const { locale, modules } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <section className="b2b-account">
      {me.impersonation ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ImpersonationBanner locale={locale}
            impersonatorAdminUserId={me.impersonation.impersonatorAdminUserId}
          />
        </div>
      ) : null}
      <aside className="b2b-account__nav" aria-label={t('nav.account')}>
        <strong>{me.customerAccount.firstName} {me.customerAccount.lastName}</strong>
        {me.organization ? <span className="muted">{me.organization.name}</span> : null}
        <LocalizedLink href="/account">{t('account.nav.profile')}</LocalizedLink>
        <LocalizedLink href="/addresses">{t('account.nav.addresses')}</LocalizedLink>
        <LocalizedLink href="/account/password">{t('account.nav.password')}</LocalizedLink>
        {/*
          Order placement, RFQ submission, shopping lists, and quick order all
          require an Organization (the backend 422s for org-less callers), so
          these features — and the Organization pages — are shown only to
          org-bound customers (feature 040, FR-003).
        */}
        {/*
          Constitution XVII item 5 (issue #666) — a link to a module's pages is
          rendered only while that module is present. `orders`, `organizations`
          and `addresses` declare `activation.nonDeactivatable`, so their links
          stay unconditional; the four below can be switched off.
        */}
        {me.organization ? (
          <>
            <LocalizedLink href="/orders">{t('account.nav.orders')}</LocalizedLink>
            {modules.isPresent('returns') ? (
              <LocalizedLink href="/returns">{t('account.nav.returns')}</LocalizedLink>
            ) : null}
            {modules.isPresent('quote_requests') ? (
              <LocalizedLink href="/quote-requests">{t('account.nav.quoteRequests')}</LocalizedLink>
            ) : null}
            {modules.isPresent('shopping_lists') ? (
              <LocalizedLink href="/shopping-lists">{t('account.nav.shoppingLists')}</LocalizedLink>
            ) : null}
            {modules.isPresent('quick_order') ? (
              <LocalizedLink href="/quick-order">{t('account.nav.quickOrder')}</LocalizedLink>
            ) : null}
            <LocalizedLink href="/organization">{t('account.nav.organization')}</LocalizedLink>
            <LocalizedLink href="/organization/addresses">{t('account.nav.organizationAddresses')}</LocalizedLink>
            {isAdmin ? <LocalizedLink href="/organization/members">{t('account.nav.members')}</LocalizedLink> : null}
          </>
        ) : null}
        <SignOutButton signOut={logoutAction} locale={locale} />
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
  return await localeRedirect('/login');
}
