import type { ReactNode } from 'react';
import type { OrderPayer, PaidOrderDetail, PaidOrderSummary } from '@endora-commerce/contracts';
import { OrderItemRows } from '../orders/OrderItemRows';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import { formatMoney } from '../../lib/i18n/money';
import { codeLabel } from '../../lib/account/labels';
import { can, isAdministrator, type OrganizationPermissionSession } from '../../lib/organization-permissions';
import { publicApiBaseUrl } from '../../lib/env.mjs';

/**
 * `specs/182-related-payers/` US3 — *Orders we pay for*, the payer's read-only view of the
 * orders billed to its Organization (FR-070, FR-071), and the *Paid by* line on the buyer's
 * own order (FR-073). The invoices are reached from each order's detail, never from a
 * storefront invoice list (RP-13).
 */

const VIEW_PAID_ORDERS = 'related_payers.view_paid_orders';

/**
 * Whether the account offers *Orders we pay for*: the module present (FR-101) and the member
 * holding *View orders we pay for*, which the Organization's Administrator always does. The
 * API is the gate; this only keeps a link from leading to a not-found page.
 */
export function showsPaidOrders(
  me: { customerAccount: OrganizationPermissionSession; organization: unknown } | null,
  modules: { isPresent(id: string): boolean },
): boolean {
  if (!me?.organization || !modules.isPresent('related_payers')) return false;
  return isAdministrator(me.customerAccount) || can(me.customerAccount, VIEW_PAID_ORDERS);
}

/** The invoice PDF of an order the caller pays for, through the payer's own route (RP-13). */
export function paidOrderInvoiceDownloadUrl(orderId: string, invoiceId: string): string {
  return `${publicApiBaseUrl()}/api/v1/account/paid-orders/${orderId}/invoices/${invoiceId}/pdf`;
}

export function PaidOrdersTable({ orders, locale }: { orders: readonly PaidOrderSummary[]; locale: string }): ReactNode {
  const t = tForLocale(locale);
  if (orders.length === 0) return <p>{t('account.paidOrders.empty')}</p>;
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>{t('account.orders.col.order')}</th>
          <th>{t('account.paidOrders.col.buyer')}</th>
          <th>{t('account.orders.col.placed')}</th>
          <th>{t('account.common.status')}</th>
          <th>{t('account.orders.col.payment')}</th>
          <th className="text-right">{t('account.common.total')}</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>
              <LocalizedLink href={`/paid-orders/${o.id}`} className="b2b-account__link">
                {o.businessId}
              </LocalizedLink>
            </td>
            <td>{o.buyerName}</td>
            <td>{new Date(o.placedAt).toLocaleDateString(locale)}</td>
            <td>{o.statusLabel}</td>
            <td>{codeLabel(t, 'account.paymentStatus', o.paymentStatus)}</td>
            <td className="text-right">{formatMoney(o.total, o.currency, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** FR-071 — read-only: what the payer pays and is invoiced for, and no buyer action. */
export function PaidOrderDetailView({ order, locale }: { order: PaidOrderDetail; locale: string }): ReactNode {
  const t = tForLocale(locale);
  const billing = order.billingAddress;
  const money = (amount: number) => formatMoney(amount, order.currency, locale);
  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        {order.invoices.map((inv) => (
          <a
            key={inv.id}
            href={paidOrderInvoiceDownloadUrl(order.id, inv.id)}
            target="_blank"
            rel="noreferrer"
            className="btn btn--outline btn--sm"
          >
            {format(t('account.order.downloadInvoice'), { number: inv.number })}
          </a>
        ))}
        <LocalizedLink href="/paid-orders" className="btn btn--ghost btn--sm">
          {t('account.paidOrders.all')}
        </LocalizedLink>
      </div>

      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">{t('account.paidOrders.col.buyer')}</th>
            <td>{order.buyerName}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.order.status.order')}</th>
            <td>{order.statusLabel}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.order.status.payment')}</th>
            <td>{codeLabel(t, 'account.paymentStatus', order.paymentStatus)}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.order.status.placed')}</th>
            <td>{new Date(order.placedAt).toLocaleString(locale)}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.paidOrders.deliveryMethod')}</th>
            <td>{order.deliveryMethodName}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-10">{t('account.paidOrders.billedTo')}</h2>
      <address className="not-italic">
        {[billing.companyName, billing.recipientName, billing.street, `${billing.postalCode} ${billing.city}`, billing.country]
          .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
          .filter((line, i, all) => all.indexOf(line) === i)
          .map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        {billing.taxId ? <span className="block">{format(t('account.paidOrders.taxId'), { taxId: billing.taxId })}</span> : null}
      </address>

      <h2 className="mt-10">{t('account.common.items')}</h2>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.common.product')}</th>
            <th>{t('account.common.quantity')}</th>
            <th>{t('account.order.items.unitPrice')}</th>
            <th className="text-right">{t('account.order.items.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          <OrderItemRows order={{ items: order.items, itemGroups: [], currency: order.currency }} locale={locale} />
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3} className="text-right">{t('account.order.totals.subtotal')}</th>
            <td className="text-right">{money(order.subtotal)}</td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">{t('account.order.totals.tax')}</th>
            <td className="text-right">{money(order.taxTotal)}</td>
          </tr>
          {order.discountTotal > 0 ? (
            <tr>
              <th colSpan={3} className="text-right">{t('account.order.totals.discount')}</th>
              <td className="text-right">−{money(order.discountTotal)}</td>
            </tr>
          ) : null}
          <tr>
            <th colSpan={3} className="text-right">{t('account.order.totals.delivery')}</th>
            <td className="text-right">{money(order.deliveryTotal)}</td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">
              <strong>{t('account.common.total')}</strong>
            </th>
            <td className="text-right">
              <strong>{money(order.total)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

/** FR-073 — *Paid by* on the buyer's order; nothing for an order the buyer pays. */
export function OrderPayerLine({ payer, locale }: { payer: OrderPayer | null | undefined; locale: string }): ReactNode {
  if (!payer) return null;
  const t = tForLocale(locale);
  return (
    <p className="b2b-order-payer">
      {format(t('account.order.paidBy'), { name: payer.name })}
    </p>
  );
}
