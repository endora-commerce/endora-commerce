import type { ReactNode } from 'react';
import type { CreditLimitView } from '../lib/api/credit-limit';

/**
 * Credit limit summary widget (T219). Used by Account and Checkout to
 * show granted / available / reserved breakdown with a tiny progress
 * indicator. Pure presentational — caller decides whether to render.
 */

export interface CreditLimitWidgetProps {
  limit: CreditLimitView;
  /** When true, expands the active-reservations table inline. */
  showReservations?: boolean;
}

export function CreditLimitWidget(props: CreditLimitWidgetProps): ReactNode {
  const { limit } = props;
  const reservedSum = limit.grantedAmount - limit.availableAmount;
  const fillPct =
    limit.grantedAmount > 0
      ? Math.min(100, Math.max(0, (reservedSum / limit.grantedAmount) * 100))
      : 0;

  return (
    <section
      className="b2b-credit-widget"
      style={{
        background: 'var(--b2b-color-surface, #fff)',
        border: '1px solid var(--b2b-color-border, #e5e5e5)',
        borderRadius: 'var(--b2b-radius, 8px)',
        padding: 'var(--b2b-spacing, 16px)',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Credit limit</h3>
      <p style={{ margin: '0 0 8px' }}>
        <strong>
          {limit.availableAmount.toFixed(2)} {limit.currency}
        </strong>{' '}
        available of{' '}
        {limit.grantedAmount.toFixed(2)} {limit.currency}
        {' · '}
        <span className="muted">
          {reservedSum.toFixed(2)} {limit.currency} reserved across{' '}
          {limit.activeReservations.length} order(s)
        </span>
      </p>
      <div
        aria-hidden="true"
        style={{
          height: 6,
          background: 'var(--b2b-color-bg, #fafafa)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: '100%',
            background: fillPct > 90 ? 'var(--b2b-color-danger, #b91c1c)' : 'var(--b2b-color-accent, #1d4ed8)',
          }}
        />
      </div>
      {props.showReservations && limit.activeReservations.length > 0 ? (
        <table className="b2b-account__table" style={{ marginTop: 12 }}>
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
                <td>
                  {r.amount.toFixed(2)} {limit.currency}
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
