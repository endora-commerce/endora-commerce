import type { ReactNode } from 'react';

/**
 * CartLine — Industria-themed cart row (feature 027 US1).
 *
 * Matches the layout from
 * `specs/b2b-platform-storefront-ui/project/industria-views-checkout.jsx`
 * (checkout step 0 — the cart): a 6-column grid
 *   [media | name+sku | qty stepper | unit price | line total | remove]
 * with a per-line `<form>` for each mutation so SSR / no-JS still works.
 *
 * The 500 ms auto-save debounce on the qty input is browser-side state
 * the parent page wires; the SSR shell ships a small "↻" submit button.
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
  /** Optional SKU surfaced above the name. */
  sku?: string | null;
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
    updateLabel?: string;
    unavailable: {
      out_of_stock: string;
      not_purchasable: string;
      no_price_in_customer_list: string;
    };
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}`;
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
    <div className={`cart-line${line.unavailable ? ' is-unavailable' : ''}`}>
      <div className="cart-line__media" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 6V4h8v2" />
        </svg>
      </div>

      <div className="cart-line__body">
        {line.sku ? <span className="cart-line__sku">{line.sku}</span> : null}
        <span className="cart-line__name">{line.productName}</span>
        {unavailableLabel ? (
          <span className="cart-line__unavailable">{unavailableLabel}</span>
        ) : null}
        <form action={saveToListAction} style={{ marginTop: 4 }}>
          <input type="hidden" name="itemId" value={line.id} />
          <button type="submit" className="cart-line__save-link">
            {strings.saveToListLabel}
          </button>
        </form>
      </div>

      <form action={updateAction} className="cart-line__stepper">
        <input type="hidden" name="itemId" value={line.id} />
        <div className="qty__stepper" role="group" aria-label={strings.qtyLabel}>
          <button
            type="submit"
            name="quantity"
            value={Math.max(1, line.quantity - 1)}
            aria-label="−"
            title="−"
          >
            −
          </button>
          <input
            type="number"
            name="quantity"
            min={1}
            defaultValue={line.quantity}
            aria-label={strings.qtyLabel}
          />
          <button
            type="submit"
            name="quantity"
            value={line.quantity + 1}
            aria-label="+"
            title="+"
          >
            +
          </button>
        </div>
      </form>

      <span className="cart-line__unit" aria-label={strings.unitPriceLabel}>
        {formatMoney(line.unitPrice)}
      </span>

      <span className="cart-line__total" aria-label={strings.lineTotalLabel}>
        {formatMoney(line.lineTotal)}
      </span>

      <form action={removeAction}>
        <input type="hidden" name="itemId" value={line.id} />
        <button
          type="submit"
          className="cart-line__remove"
          aria-label={strings.removeLabel}
          title={strings.removeLabel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
