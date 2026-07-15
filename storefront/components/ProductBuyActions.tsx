'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { addRfqDraftItem } from '../lib/rfqDraft';
import { ADD_TO_CART_IDLE, type AddToCartResult } from '../lib/cartAddState';
import { CartAddedPopup } from './CartAddedPopup';
import { CartSubmitButton } from './CartSubmitButton';

/**
 * PDP purchase row: a single styled quantity input shared by both the
 * "Add to quote" and "Add to cart" actions, rendered in that order.
 *
 * Feature 043 — when the product has packaging units (e.g. a pallet), a
 * selector lets the buyer order by the unit. The quantity input then counts
 * units, and the resulting line is `baseQuantity × units` pieces (resolved on
 * the server from the selected `packagingUnitId`).
 */
export interface ProductPackagingUnitOption {
  id: string;
  name: string;
  baseQuantity: number;
  isDefault: boolean;
}

export interface ProductBuyActionsProps {
  productId: string;
  productSlug: string;
  /** Display name carried into the client-side quote-request draft. */
  productName: string;
  /** Optional catalogue unit-price snapshot stored on the RFQ draft line. */
  unitPrice?: { amount: number; currency: string } | null;
  variantId?: string | undefined;
  /** Show the "Add to cart" button (product is purchasable / in stock). */
  showCart: boolean;
  /** Show the "Add to quote" button (RFQ enabled for this storefront). */
  showQuote: boolean;
  /** Feature 043 — packaging units available for this product (may be empty). */
  packagingUnits?: ProductPackagingUnitOption[] | undefined;
  /** Localized "single piece" option label for the packaging selector. */
  singlePieceLabel?: string | undefined;
  /** Localized pieces unit word (e.g. "szt."). */
  piecesLabel?: string | undefined;
  addToCartAction: (
    prevState: AddToCartResult,
    formData: FormData,
  ) => AddToCartResult | Promise<AddToCartResult>;
  addToCartLabel: string;
  /**
   * Optional action rendered in the top row next to the quantity cluster
   * (e.g. the Add-to-shopping-list heart button).
   */
  leadingAction?: ReactNode;
  /**
   * Optional secondary action rendered in the actions row alongside the
   * shopping-list and quote buttons (e.g. the Add-to-compare toggle).
   */
  compareAction?: ReactNode;
}

export function ProductBuyActions({
  productId,
  productSlug,
  productName,
  unitPrice,
  variantId,
  showCart,
  showQuote,
  packagingUnits,
  singlePieceLabel = 'szt.',
  piecesLabel = 'szt.',
  addToCartAction,
  addToCartLabel,
  leadingAction,
  compareAction,
}: ProductBuyActionsProps): ReactNode {
  const units = packagingUnits ?? [];
  const defaultUnit = units.find((u) => u.isDefault) ?? null;
  // Default the selector to the operator's default unit when present, else to
  // single pieces (empty string).
  const [unitId, setUnitId] = useState<string>(defaultUnit?.id ?? '');
  const [qty, setQty] = useState(1);
  const [quoteAdded, setQuoteAdded] = useState(false);
  // `CartSubmitButton` renders its own pending spinner via `useFormStatus`, so
  // the action's `isPending` flag isn't needed here.
  const [cartState, cartFormAction] = useActionState(addToCartAction, ADD_TO_CART_IDLE);
  if (!showCart && !showQuote) return null;

  const selectedUnit = units.find((u) => u.id === unitId) ?? null;
  const resultingPieces = selectedUnit ? selectedUnit.baseQuantity * qty : null;

  const addToQuote = (): void => {
    // Piece-based: when a packaging unit is selected we add the resulting
    // piece count to the draft (labelled packaging lines come from the
    // cart → quote-request conversion instead).
    addRfqDraftItem({
      productId,
      slug: productSlug,
      name: productName,
      unitPrice: unitPrice ?? null,
      quantity: resultingPieces ?? qty,
    });
    setQuoteAdded(true);
    window.setTimeout(() => setQuoteAdded(false), 1500);
  };

  return (
    // On desktop, shrink to the widest row (the secondary actions row) instead
    // of the full column, so the full-width cart CTA lines up with those buttons
    // rather than sticking out past them (`md:self-start` opts out of the
    // parent's stretch). On mobile keep it full-width for a big tap target.
    <div className="flex w-full flex-col gap-3 md:w-fit md:self-start">
      {/* Quantity cluster (packaging unit + amount). */}
      <div className="flex flex-wrap items-center gap-2">
        {units.length > 0 ? (
          <select
            aria-label="Jednostka"
            value={unitId}
            onChange={(e): void => setUnitId(e.target.value)}
            className="rounded-sm border border-line px-[8px] py-[6px] text-[13px]"
          >
            <option value="">{singlePieceLabel}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.baseQuantity} {piecesLabel})
              </option>
            ))}
          </select>
        ) : null}

        <label htmlFor={`buy-qty-${productId}`} className="text-[12px]">
          Ilość
        </label>
        <input
          id={`buy-qty-${productId}`}
          type="number"
          min={1}
          max={9999}
          value={qty}
          onChange={(e): void => {
            const n = Number(e.target.value);
            setQty(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
          }}
          className="w-[5rem] rounded-sm border border-line px-[8px] py-[6px]"
        />

        {resultingPieces !== null ? (
          <span className="text-[12px] text-muted">
            = {resultingPieces.toLocaleString('pl-PL')} {piecesLabel}
          </span>
        ) : null}
      </div>

      {/* Primary CTA — Add to cart. Prominent, full-width, dark (Industria
          `.btn--dark.btn--lg.btn--block` in the reference pricepanel). */}
      {showCart ? (
        <form action={cartFormAction} className="w-full">
          <input type="hidden" name="productId" value={productId} />
          {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
          {selectedUnit ? (
            <input type="hidden" name="packagingUnitId" value={selectedUnit.id} />
          ) : null}
          <input type="hidden" name="quantity" value={qty} />
          <CartSubmitButton
            className="b2b-cta h-[48px] w-full justify-center text-[14px] font-semibold"
            label={addToCartLabel}
            icon={<CartIcon />}
          />
        </form>
      ) : null}

      {/* Secondary actions — shopping list, compare, quote. Stacked full-width
          on mobile (matching the cart CTA), a compact row on desktop. */}
      {leadingAction || compareAction || showQuote ? (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          {leadingAction ?? null}
          {compareAction ?? null}
          {showQuote ? (
            <button
              type="button"
              onClick={addToQuote}
              className="btn btn--outline h-[40px] w-full justify-center md:w-auto"
            >
              {quoteAdded ? 'Dodano ✓' : 'Dodaj do zapytania'}
            </button>
          ) : null}
        </div>
      ) : null}

      {showCart ? <CartAddedPopup state={cartState} /> : null}
    </div>
  );
}

function CartIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  );
}
