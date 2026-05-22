import type { ReactNode } from 'react';

/**
 * CartLine (feature 027 US1).
 *
 * Server-component-friendly per-line row. Dispatches three Next.js
 * server actions wired by the parent (the cart page):
 *   - `updateAction`     — PATCH the qty (auto-saved by the parent
 *                          form on submit; debounce-on-change is the
 *                          parent's job; the form re-submits on every
 *                          change at the browser layer)
 *   - `removeAction`     — DELETE the line
 *   - `saveToListAction` — POST to `/api/v1/cart/items/:id/save-to-shopping-list`
 *                          (opens the list picker via a separate page
 *                          flow today; once a modal exists this becomes
 *                          a direct save)
 *
 * Browser-verification note: the qty input's 500 ms auto-save debounce
 * is browser-side state (`useEffect` + `setTimeout`). The server-side
 * shell here renders a plain `<form>` so SSR / no-JS still works (the
 * buyer can hit "Save" to submit the same form).
 */

export interface CartLineViewModel {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
  unavailable?: boolean;
  unavailableReason?: 'out_of_stock' | 'not_purchasable' | 'no_price_in_customer_list' | null;
  /** Resolved + display-ready name; the parent looked it up. */
  productName: string;
}

interface CartLineProps {
  line: CartLineViewModel;
  updateAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  saveToListAction: (formData: FormData) => Promise<void>;
  strings: {
    qtyLabel: string;
    unitPriceLabel: string;
    lineTotalLabel: string;
    removeLabel: string;
    saveToListLabel: string;
    unavailable: {
      out_of_stock: string;
      not_purchasable: string;
      no_price_in_customer_list: string;
    };
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.amount.toFixed(2)} ${m.currency}`;
}

export function CartLine({
  line,
  updateAction,
  removeAction,
  saveToListAction,
  strings,
}: CartLineProps): ReactNode {
  const unavailableLabel =
    line.unavailable && line.unavailableReason
      ? strings.unavailable[line.unavailableReason]
      : null;
  return (
    <li
      className="b2b-cart__line"
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
        gap: '1rem',
        alignItems: 'center',
        padding: '0.75rem 0',
        borderBottom: '1px solid #e5e5e5',
        opacity: line.unavailable ? 0.55 : 1,
      }}
    >
      <span className="b2b-cart__line-name">{line.productName}</span>

      <form
        action={updateAction}
        className="b2b-cart__line-qty"
        style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}
      >
        <input type="hidden" name="itemId" value={line.id} />
        <label htmlFor={`qty-${line.id}`} className="sr-only">
          {strings.qtyLabel}
        </label>
        <input
          id={`qty-${line.id}`}
          type="number"
          name="quantity"
          min={1}
          defaultValue={line.quantity}
          aria-label={strings.qtyLabel}
          style={{ width: '4rem' }}
        />
        <button type="submit" className="sr-only">
          {strings.qtyLabel}
        </button>
      </form>

      <span className="b2b-cart__line-unit-price" aria-label={strings.unitPriceLabel}>
        {formatMoney(line.unitPrice)}
      </span>

      <span className="b2b-cart__line-total" aria-label={strings.lineTotalLabel}>
        {formatMoney(line.lineTotal)}
      </span>

      <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <form action={saveToListAction}>
          <input type="hidden" name="itemId" value={line.id} />
          <button type="submit" className="b2b-cart__line-save-to-list">
            {strings.saveToListLabel}
          </button>
        </form>
        <form action={removeAction}>
          <input type="hidden" name="itemId" value={line.id} />
          <button type="submit" className="b2b-cart__line-remove" aria-label={strings.removeLabel}>
            ×
          </button>
        </form>
      </span>

      {unavailableLabel ? (
        <span
          className="b2b-cart__line-unavailable"
          style={{ gridColumn: '1 / -1', color: '#a06000', fontSize: '0.85rem' }}
        >
          {unavailableLabel}
        </span>
      ) : null}
    </li>
  );
}
