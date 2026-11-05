import type { ReactNode } from 'react';
import { getSessionCookie, clearSessionCookie } from '../../lib/session';
import { getMe } from '../../lib/api/account';
import { listOrganizationCarts } from '../../lib/api/cart';
import { logoutCustomer } from '../../lib/api/auth';
import { StorefrontApiError } from '../../lib/api/client';
import { ImpersonationBanner } from '../../components/ImpersonationBanner';
import { SignOutButton } from '../../components/account/SignOutButton';
import { localeRedirect } from '../../lib/i18n/navigation';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { getServerContext } from '../../lib/server-context';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import { isCompanyOrganization, organizationAreaAccess } from '../../lib/account/organization-area';

/**
 * Authenticated route-group layout (T154 + T155). Loads `/me` once for the
 * sidebar so individual pages don't have to re-fetch the customer just to
 * render the navigation. If the session is missing or expired, the layout
 * redirects to `/login?next=...` instead of leaking a half-rendered page.
 *
 * Feature 170 (FR-057, FR-070a): *Members* and *Roles* are offered to the
 * Organization's administrators and *Carts to approve* to the members holding
 * `carts.approve`, with the count of carts waiting — none of the three in a
 * personal Organization, whose member is its Administrator
 * (`lib/account/organization-area.ts`). Nor, since issue #757, the
 * *Organization* and *Org addresses* links or the Organization's name under the
 * customer's: a personal Organization is not a company.
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

  const { locale, modules } = await getServerContext();
  const t = tForLocale(locale);
  const company = organizationAreaAccess(me, 'summary') === 'allowed';
  const manages = organizationAreaAccess(me, 'members') === 'allowed';
  const approves = organizationAreaAccess(me, 'carts') === 'allowed';
  const waiting = approves ? await pendingCartCount(session) : null;

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
        {me.organization && isCompanyOrganization(me.organization) ? (
          <span className="muted">{me.organization.name}</span>
        ) : null}
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
            {company ? (
              <>
                <LocalizedLink href="/organization">{t('account.nav.organization')}</LocalizedLink>
                <LocalizedLink href="/organization/addresses">{t('account.nav.organizationAddresses')}</LocalizedLink>
              </>
            ) : null}
            {manages ? (
              <>
                <LocalizedLink href="/organization/members">{t('account.nav.members')}</LocalizedLink>
                <LocalizedLink href="/organization/roles">{t('account.nav.roles')}</LocalizedLink>
              </>
            ) : null}
            {approves ? (
              <LocalizedLink href="/organization/carts?approval=pending">
                {waiting
                  ? format(t('account.nav.cartsToApproveCount'), { count: waiting.toLocaleString(locale) })
                  : t('account.nav.cartsToApprove')}
              </LocalizedLink>
            ) : null}
          </>
        ) : null}
        <SignOutButton signOut={logoutAction} locale={locale} />
      </aside>
      <div className="b2b-account__panel">{children}</div>
    </section>
  );
}

/**
 * How many of the Organization's carts await an answer, or `null` when the
 * count cannot be read — the link is offered either way, only its count is not.
 */
async function pendingCartCount(session: string): Promise<number | null> {
  try {
    const res = await listOrganizationCarts({ session }, { approvalStatus: ['pending'] });
    return res.meta.totalCount;
  } catch {
    return null;
  }
}

async function logoutAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  await logoutCustomer(session);
  await clearSessionCookie();
  return await localeRedirect('/login');
}
