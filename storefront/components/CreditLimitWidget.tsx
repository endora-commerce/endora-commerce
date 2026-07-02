import type { ReactNode } from 'react';
import type { CreditLimitView } from '../lib/api/credit-limit';
import { formatMoney } from '../lib/i18n/money';

/**
 * Credit limit summary widget (T219). Used by Account and Checkout to
 * show granted / available / reserved breakdown with a tiny progress
 * indicator. Pure presentational — caller decides whether to render.
 */

export interface CreditLimitWidgetProps {
  limit: CreditLimitView;
  /** When true, expands the active-reservations table inline. */
  showReservations?: boolean;
  /** Active Sales Channel display locale (e.g. `pl-PL`). */
  locale?: string;
}

export function CreditLimitWidget(props: CreditLimitWidgetProps): ReactNode {
  const { limit, locale } = props;
  const money = (amount: number): string => formatMoney(amount, limit.currency, locale);
  const reservedSum = limit.grantedAmount - limit.availableAmount;
  const fillPct =
    limit.grantedAmount > 0
      ? Math.min(100, Math.max(0, (reservedSum / limit.grantedAmount) * 100))
      : 0;

  return (
    <section className="rounded-md border border-line bg-surface p-[16px]">
      <h3 className="m-0 mb-2 text-[1rem]">Credit limit</h3>
      <p className="m-0 mb-2">
        <strong>{money(limit.availableAmount)}</strong>{' '}
        available of{' '}
        {money(limit.grantedAmount)}
        {' · '}
        <span className="text-muted">
          {money(reservedSum)} reserved across{' '}
          {limit.activeReservations.length} order(s)
        </span>
      </p>
      <div aria-hidden="true" className="h-[6px] overflow-hidden rounded-[3px] bg-surface-alt">
        <div
          // Width + colour are data-driven (utilisation) — kept inline/conditional.
          className={`h-full ${fillPct > 90 ? 'bg-bad' : 'bg-accent'}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {props.showReservations && limit.activeReservations.length > 0 ? (
        <table className="b2b-account__table mt-3">
          <thead>
            <tr>
              <th>Order</th>
              <th>Reserved</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {limit.activeReservations.map((r) => (
              <tr key={r.orderId}>
                <td>{r.orderId.slice(0, 8)}</td>
                <td>{money(r.amount)}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
