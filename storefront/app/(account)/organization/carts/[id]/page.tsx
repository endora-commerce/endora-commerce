import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getOrganizationCart, type OrgCartDetail } from '../../../../../lib/api/cart';
import { getAnonCartCookie, getSessionCookie } from '../../../../../lib/session';
import { getMe } from '../../../../../lib/api/account';
import { formatMoney } from '../../../../../lib/i18n/money';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../../lib/server-context';
import { tForLocale } from '../../../../../lib/i18n/messages';
import { format } from '../../../../../lib/i18n/format';
import { codeLabel } from '../../../../../lib/account/labels';
import {
  REJECT_REASON_MAX_LENGTH,
  orgCartDoneKey,
  orgCartErrorKey,
} from '../../../../../lib/account/org-cart-approval';
import { CartSubmitButton } from '../../../../../components/CartSubmitButton';
import { approveCartAction, rejectCartAction } from './actions';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * One cart of the Organization, for its administrator (issue #650): who owns
 * it, what is in it, what it totals and when it was sent — and, while it is
 * awaiting approval, the two answers. Approve is the one primary action; reject
 * sits behind a disclosure, away from it, because it needs a reason and cannot
 * be taken back.
 *
 * The role and the Organization are the API's to enforce (404 for a cart of
 * another Organization, 403 for a member); the page gates on the role too, to
 * say so rather than render an empty screen.
 */
export default async function OrganizationCartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const query = await searchParams;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  if (!me.organization) return await localeRedirect('/account');
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  const back = (
    <p className="mb-3 mt-0 text-[13px]">
      <LocalizedLink href="/organization/carts">← {t('account.orgCart.back')}</LocalizedLink>
    </p>
  );
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>{t('account.orgCarts.heading')}</h2>
        <p className="b2b-auth__error">{t('account.orgCarts.adminOnly')}</p>
      </>
    );
  }

  const anon = await getAnonCartCookie();
  let cart: OrgCartDetail | null;
  try {
    cart = await getOrganizationCart({ session, ...(anon ? { anon } : {}) }, id, ctx);
  } catch {
    return (
      <>
        {back}
        <h2>{t('account.orgCarts.heading')}</h2>
        <p className="b2b-auth__error" role="alert">
          {t('account.orgCart.loadFailed')}
        </p>
      </>
    );
  }
  if (!cart) {
    return (
      <>
        {back}
        <h2>{t('account.orgCarts.heading')}</h2>
        <p className="b2b-auth__error" role="alert">
          {t('account.orgCart.notFound')}
        </p>
      </>
    );
  }

  const doneKey = orgCartDoneKey(query.done);
  const errorKey = orgCartErrorKey(query.error);
  const reasonInvalid = query.error === 'REASON_REQUIRED' || query.error === 'REASON_TOO_LONG';
  const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString(locale) : '—');
  const pending = cart.approvalStatus === 'pending';

  return (
    <>
      {back}
      <h2>{format(t('account.orgCart.heading'), { owner: cart.ownerDisplayName })}</h2>

      {doneKey ? (
        <p className="b2b-auth__success" role="status">
          {t(doneKey)}
        </p>
      ) : null}
      {errorKey && !reasonInvalid ? (
        <p className="b2b-auth__error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}

      <dl className="my-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13px]">
        <dt className="text-muted">{t('account.orgCarts.col.owner')}</dt>
        <dd className="m-0">{cart.ownerDisplayName}</dd>
        <dt className="text-muted">{t('account.common.status')}</dt>
        <dd className="m-0">
          <span className={`b2b-cart-status b2b-cart-status--${cart.status}`}>
            {codeLabel(t, 'account.cartStatus', cart.status)}
          </span>
        </dd>
        <dt className="text-muted">{t('account.orgCarts.col.approval')}</dt>
        <dd className="m-0">
          <span className={`b2b-cart-approval b2b-cart-approval--${cart.approvalStatus}`}>
            {codeLabel(t, 'account.cartApprovalStatus', cart.approvalStatus)}
          </span>
        </dd>
        <dt className="text-muted">{t('account.orgCart.submittedAt')}</dt>
        <dd className="m-0">{when(cart.submittedForApprovalAt)}</dd>
        {cart.approvedAt ? (
          <>
            <dt className="text-muted">{t('account.orgCart.approvedAt')}</dt>
            <dd className="m-0">{when(cart.approvedAt)}</dd>
          </>
        ) : null}
        {cart.rejectedAt ? (
          <>
            <dt className="text-muted">{t('account.orgCart.rejectedAt')}</dt>
            <dd className="m-0">{when(cart.rejectedAt)}</dd>
            <dt className="text-muted">{t('account.orgCart.rejectedReason')}</dt>
            <dd className="m-0 whitespace-pre-line">{cart.rejectedReason ?? '—'}</dd>
          </>
        ) : null}
        <dt className="text-muted">{t('account.common.total')}</dt>
        <dd className="m-0 font-semibold">{formatMoney(cart.total.amount, cart.total.currency)}</dd>
      </dl>

      <h3>{t('account.orgCart.lines')}</h3>
      {cart.items.length === 0 ? (
        <p>{t('account.orgCart.noLines')}</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('account.common.product')}</th>
              <th>{t('account.common.quantity')}</th>
              <th>{t('account.order.items.unitPrice')}</th>
              <th>{t('account.order.items.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {cart.items.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.displayName ?? t('account.orgCart.unknownProduct')}
                  {line.productSku ? (
                    <small className="block text-subtle">
                      {format(t('account.common.sku'), { sku: line.productSku })}
                    </small>
                  ) : null}
                </td>
                <td>{line.quantity}</td>
                <td>{formatMoney(line.unitPrice.amount, line.unitPrice.currency)}</td>
                <td>{formatMoney(line.lineTotal.amount, line.lineTotal.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{t('account.orgCart.decision')}</h3>
      {pending ? (
        <div className="grid gap-6">
          <form action={approveCartAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="cartId" value={cart.id} />
            <CartSubmitButton
              className="btn btn--dark min-h-11"
              label={t('account.orgCart.approve')}
              pendingLabel={t('account.orgCart.approving')}
            />
            <span className="text-[13px] text-muted">{t('account.orgCart.approveHint')}</span>
          </form>

          <details open={reasonInvalid} className="rounded-md border border-line p-[14px]">
            <summary className="min-h-11 cursor-pointer content-center text-[13px] font-medium">
              {t('account.orgCart.rejectToggle')}
            </summary>
            <form action={rejectCartAction} className="b2b-auth__form mt-3">
              <input type="hidden" name="cartId" value={cart.id} />
              <div className="b2b-auth__field">
                <label htmlFor="reject-reason">{t('account.orgCart.reasonLabel')}</label>
                <textarea
                  id="reject-reason"
                  name="reason"
                  rows={3}
                  required
                  maxLength={REJECT_REASON_MAX_LENGTH}
                  placeholder=" "
                  aria-describedby={reasonInvalid ? 'reject-reason-error' : 'reject-reason-hint'}
                  aria-invalid={reasonInvalid || undefined}
                />
              </div>
              {reasonInvalid && errorKey ? (
                <p id="reject-reason-error" className="b2b-auth__error m-0" role="alert">
                  {t(errorKey)}
                </p>
              ) : (
                <p id="reject-reason-hint" className="m-0 text-[12px] text-muted">
                  {t('account.orgCart.reasonHint')}
                </p>
              )}
              <div>
                <CartSubmitButton
                  className="btn btn--outline min-h-11"
                  label={t('account.orgCart.reject')}
                  pendingLabel={t('account.orgCart.rejecting')}
                />
              </div>
            </form>
          </details>
        </div>
      ) : (
        <p className="text-[13px] text-muted">{t('account.orgCart.notPending')}</p>
      )}
    </>
  );
}
