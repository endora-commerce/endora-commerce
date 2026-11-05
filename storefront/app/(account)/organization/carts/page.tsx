import type { ReactNode } from 'react';
import {
  listOrganizationCarts,
  type OrgCartSummary,
} from '../../../../lib/api/cart';
import { getSessionCookie, getAnonCartCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { codeLabel } from '../../../../lib/account/labels';
import { format } from '../../../../lib/i18n/format';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { organizationAreaAccess } from '../../../../lib/account/organization-area';
import { NetMoney, OrgCartOwner } from '../../../../components/account/OrgCartParts';
import { orgCartOrderHref } from '../../../../lib/account/org-cart-order';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The Organization's carts, for the members who may approve them (feature 027
 * US4; feature 170, FR-033).
 *
 * Lists every cart owned by a member of the caller's Organization, each
 * linked to its detail (`[id]/page.tsx`, where a pending one is approved or
 * rejected — issue #650). The backend gates the list on `carts.approve`
 * (`403` otherwise); the page asks the same of the session to say so rather
 * than render an empty screen, and sends a personal Organization's member to
 * the account page (FR-070a).
 *
 * Browser-verification note: layout + status-badge styling needs eyes.
 * The data flow is a plain server-side fetch.
 */
export default async function OrganizationCartsPage({
  searchParams,
}: {
  /** Issue #650 — `?approval=pending` narrows the list to the carts awaiting an answer. */
  searchParams: Promise<{ approval?: string }>;
}): Promise<ReactNode> {
  const onlyPending = (await searchParams).approval === 'pending';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const access = organizationAreaAccess(me, 'carts');
  if (access === 'absent' || !me.organization) return await localeRedirect('/account');
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  if (access === 'refused') {
    return (
      <>
        <h2>{t('account.orgCarts.heading')}</h2>
        <p className="b2b-auth__error">{t('account.orgCarts.approverOnly')}</p>
      </>
    );
  }

  const anon = await getAnonCartCookie();
  let carts: OrgCartSummary[] = [];
  let loadError: string | null = null;
  try {
    const res = await listOrganizationCarts(
      {
        ...(session ? { session } : {}),
        ...(anon ? { anon } : {}),
      },
      onlyPending ? { approvalStatus: ['pending'] } : undefined,
    );
    carts = res.data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : t('account.orgCarts.loadFailed');
  }

  return (
    <>
      <h2>{t('account.orgCarts.heading')}</h2>
      <p className="b2b-auth__hint">
        {format(t('account.orgCarts.intro'), { organization: me.organization.name })}
      </p>

      <nav aria-label={t('account.orgCarts.filter.label')} className="my-3 flex gap-2 text-[13px]">
        <LocalizedLink
          href="/organization/carts"
          aria-current={onlyPending ? undefined : 'page'}
          className={`btn btn--sm min-h-11 ${onlyPending ? 'btn--ghost' : 'btn--outline'}`}
        >
          {t('account.orgCarts.filter.all')}
        </LocalizedLink>
        <LocalizedLink
          href="/organization/carts?approval=pending"
          aria-current={onlyPending ? 'page' : undefined}
          className={`btn btn--sm min-h-11 ${onlyPending ? 'btn--outline' : 'btn--ghost'}`}
        >
          {t('account.orgCarts.filter.pending')}
        </LocalizedLink>
      </nav>

      {loadError ? <p className="b2b-auth__error">{loadError}</p> : null}

      {carts.length === 0 ? (
        <p>{t(onlyPending ? 'account.orgCarts.emptyPending' : 'account.orgCarts.empty')}</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('account.orgCarts.col.owner')}</th>
              <th>{t('account.common.status')}</th>
              <th>{t('account.orgCarts.col.approval')}</th>
              <th>{t('account.common.items')}</th>
              <th>{t('account.common.total')}</th>
              <th>{t('account.orgCarts.col.lastActivity')}</th>
              <th>{t('account.orgCarts.col.submitted')}</th>
              <th>{t('account.orgCarts.col.cart')}</th>
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => {
              const orderHref = orgCartOrderHref(cart, me.customerAccount);
              return (
                <tr key={cart.id}>
                  <td>
                    <OrgCartOwner name={cart.ownerDisplayName} email={cart.ownerEmail} />
                  </td>
                  <td>
                    <span className={`b2b-cart-status b2b-cart-status--${cart.status}`}>
                      {codeLabel(t, 'account.cartStatus', cart.status)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`b2b-cart-approval b2b-cart-approval--${cart.approvalStatus}`}
                    >
                      {codeLabel(t, 'account.cartApprovalStatus', cart.approvalStatus)}
                    </span>
                  </td>
                  {/* Issue #751 — an order empties the cart it was placed from, so a
                      completed cart's count and total are not zero: they are the
                      order's, linked for a viewer the order page answers, and
                      otherwise not here. */}
                  {orderHref ? (
                    <td colSpan={2}>
                      <LocalizedLink href={orderHref}>{t('account.orgCart.viewOrder')}</LocalizedLink>
                    </td>
                  ) : (
                    <>
                      <td>{cart.status === 'completed' ? '—' : cart.itemCount}</td>
                      <td>
                        {cart.status === 'completed' ? (
                          '—'
                        ) : (
                          <NetMoney money={cart.total} netLabel={t('commerce.common.net')} />
                        )}
                      </td>
                    </>
                  )}
                  <td>{new Date(cart.lastActivityAt).toLocaleString(locale)}</td>
                  <td>
                    {cart.submittedForApprovalAt
                      ? new Date(cart.submittedForApprovalAt).toLocaleString(locale)
                      : '—'}
                  </td>
                  <td>
                    <LocalizedLink href={`/organization/carts/${encodeURIComponent(cart.id)}`}>
                      {cart.approvalStatus === 'pending'
                        ? t('account.orgCarts.review')
                        : t('account.common.open')}
                    </LocalizedLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
