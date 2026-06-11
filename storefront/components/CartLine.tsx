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
  /** Optional PDP slug — when set the name links back to the product card. */
  productSlug?: string | null;
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
    <div
      className={`grid grid-cols-[56px_1fr_130px_110px_130px_28px] items-center gap-[14px] border-b border-line px-[22px] py-[14px] last:border-b-0 max-[720px]:grid-cols-[56px_1fr_auto] max-[720px]:gap-y-[10px] max-[720px]:[grid-template-areas:'media_body_actions''stepper_unit_total']${
        line.unavailable ? ' opacity-60' : ''
      }`}
    >
      <div
        className="grid h-[56px] w-[56px] place-items-center rounded-sm bg-surface-alt text-line-strong [&_svg]:h-[60%] [&_svg]:w-[60%] max-[720px]:[grid-area:media]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 6V4h8v2" />
        </svg>
      </div>

      <div className="flex min-w-0 flex-col gap-[2px] max-[720px]:[grid-area:body]">
        {line.sku ? (
          <span className="truncate font-mono text-[11px] uppercase text-muted">{line.sku}</span>
        ) : null}
        {line.productSlug ? (
          <a
            href={`/p/${encodeURIComponent(line.productSlug)}`}
            className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg no-underline hover:underline"
          >
            {line.productName}
          </a>
        ) : (
          <span className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg">
            {line.productName}
          </span>
        )}
        {unavailableLabel ? (
          <span className="mt-[2px] text-[11px] text-muted">{unavailableLabel}</span>
        ) : null}
        <form action={saveToListAction} className="mt-1">
          <input type="hidden" name="itemId" value={line.id} />
          <button
            type="submit"
            className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted underline underline-offset-2"
          >
            {strings.saveToListLabel}
          </button>
        </form>
      </div>

      <form action={updateAction} className="max-[720px]:[grid-area:stepper]">
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

      <span
        className="text-right font-mono text-[13px] text-fg-soft max-[720px]:[grid-area:unit]"
        aria-label={strings.unitPriceLabel}
      >
        {formatMoney(line.unitPrice)}
      </span>

      <span
        className="text-right font-mono text-[14px] font-semibold text-fg max-[720px]:[grid-area:total]"
        aria-label={strings.lineTotalLabel}
      >
        {formatMoney(line.lineTotal)}
      </span>

      <form action={removeAction} className="max-[720px]:justify-self-end max-[720px]:[grid-area:actions]">
        <input type="hidden" name="itemId" value={line.id} />
        <button
          type="submit"
          className="grid h-[28px] w-[28px] cursor-pointer place-items-center rounded-sm border border-transparent bg-transparent text-muted transition hover:bg-surface-alt hover:text-[#b91c1c]"
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
