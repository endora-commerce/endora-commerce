'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { addRfqDraftItem } from '../lib/rfqDraft';
import { trackAddToCart, trackAddToQuoteRequest, type GaLineItem } from '../lib/analytics/ecommerce';
import { ADD_TO_CART_IDLE, type AddToCartResult } from '../lib/cartAddState';
import { quoteAddButtonLabel } from '../lib/buyActionLabels';
import { tForLocale } from '../lib/i18n/messages';
import {
  clampQuantity,
  minimumStatement,
  normaliseOnBlur,
  orderFloor,
  quantityOnUnitChange,
} from '../lib/orderMinimum';
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
  /** Feature 155 — minimum units of this unit per order of the product; `null`/absent = none. */
  minOrderUnits?: number | null | undefined;
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
  /** Localized "single piece" option label for the packaging selector; defaults to the catalogue's in `locale`. */
  singlePieceLabel?: string | undefined;
  /** Localized pieces unit word (e.g. "szt."); defaults to the catalogue's in `locale`. */
  piecesLabel?: string | undefined;
  /**
   * Feature 155 (FR-014) — the product's pieces minimum; `null`/absent = none. The quantity
   * input starts at the applicable minimum (the selected unit's, when one is selected) and does
   * not offer less; the minimum is stated beside it.
   */
  minOrderQuantity?: number | null | undefined;
  /**
   * Request locale — every label, the minimum statement and the piece count are rendered in it
   * (U4: the controls' own copy was a Polish literal whatever the page's language).
   */
  locale?: string | undefined;
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
  singlePieceLabel,
  piecesLabel,
  minOrderQuantity = null,
  locale = 'pl-PL',
  addToCartAction,
  addToCartLabel,
  leadingAction,
  compareAction,
}: ProductBuyActionsProps): ReactNode {
  const t = tForLocale(locale);
  const singlePiece = singlePieceLabel ?? t('product.packaging.singlePiece');
  const pieces = piecesLabel ?? t('product.packaging.pieces');
  const units = packagingUnits ?? [];
  const defaultUnit = units.find((u) => u.isDefault) ?? null;
  // Default the selector to the operator's default unit when present, else to
  // single pieces (empty string).
  const [unitId, setUnitId] = useState<string>(defaultUnit?.id ?? '');
  const product = { minOrderQuantity };
  // Feature 155 — the input starts at the applicable minimum. `qtyText` holds what the buyer
  // typed, unclamped, so typing "15" over a floor of 10 is not rewritten keystroke by keystroke;
  // it is normalised on blur, and every consumer reads the clamped `qty` below.
  const [qtyText, setQtyText] = useState<string>(() => String(orderFloor(product, defaultUnit)));
  const [quoteAdded, setQuoteAdded] = useState(false);
  // `CartSubmitButton` renders its own pending spinner via `useFormStatus`, so
  // the action's `isPending` flag isn't needed here.
  const [cartState, cartFormAction] = useActionState(addToCartAction, ADD_TO_CART_IDLE);

  const selectedUnit = units.find((u) => u.id === unitId) ?? null;
  const floor = orderFloor(product, selectedUnit);
  const qty = clampQuantity(qtyText, floor);
  const statement = minimumStatement(product, selectedUnit, locale);
  const statementId = `buy-min-${productId}`;
  const resultingPieces = selectedUnit ? selectedUnit.baseQuantity * qty : null;

  // Feature 049 — the GA line item built from the info the PDP already has.
  // SKU is not available in this component; it is simply omitted from the
  // payload (the collector drops absent fields).
  const gaItem = (): GaLineItem => ({
    sku: productId,
    name: productName,
    price: unitPrice?.amount ?? 0,
    quantity: resultingPieces ?? qty,
    ...(unitPrice?.currency ? { currency: unitPrice.currency } : {}),
  });

  // Feature 049 — fire add_to_cart (Enhanced Ecommerce + custom events) once
  // per successful server-action add, keyed off the success token.
  const lastCartToken = useRef(0);
  useEffect(() => {
    if (cartState.status === 'success' && cartState.token !== lastCartToken.current) {
      lastCartToken.current = cartState.token;
      trackAddToCart(gaItem());
    }
    // gaItem reads current qty/unit; intentionally keyed on cartState only.

  }, [cartState]);

  // Nothing to render when neither action is offered. The guard sits below the
  // hooks above — not above them — because a hook may not follow an early
  // return: `showCart` and `showQuote` come off props, so a render in which
  // both go false would run two hooks fewer than the render before it. Both
  // hooks are inert here anyway: with no cart form there is no server action
  // to move `cartState` off its idle value, and the effect fires only on a
  // success token it has not already seen.
  if (!showCart && !showQuote) return null;

  const addToQuote = (): void => {
    trackAddToQuoteRequest(gaItem());
    // Piece-based: when a packaging unit is selected we add the resulting
    // piece count to the draft (labelled packaging lines come from the
    // cart → quote-request conversion instead). Feature 155 (FR-032): the input is floored at
    // the minimum already; passing it keeps the draft line at or above it after the add too.
    addRfqDraftItem(
      {
        productId,
        slug: productSlug,
        name: productName,
        unitPrice: unitPrice ?? null,
        quantity: resultingPieces ?? qty,
      },
      minOrderQuantity ?? null,
    );
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
            aria-label={t('product.buy.unit')}
            value={unitId}
            onChange={(e): void => {
              const next = units.find((u) => u.id === e.target.value) ?? null;
              setQtyText(String(quantityOnUnitChange(qty, floor, orderFloor(product, next))));
              setUnitId(e.target.value);
            }}
            className="rounded-sm border border-line px-[8px] py-[6px] text-[13px]"
          >
            <option value="">{singlePiece}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.baseQuantity} {pieces})
              </option>
            ))}
          </select>
        ) : null}

        <label htmlFor={`buy-qty-${productId}`} className="text-[12px]">
          {t('common.quantity')}
        </label>
        <input
          id={`buy-qty-${productId}`}
          type="number"
          min={floor}
          max={Math.max(9999, floor)}
          step={1}
          inputMode="numeric"
          value={qtyText}
          {...(statement ? { 'aria-describedby': statementId } : {})}
          onChange={(e): void => setQtyText(e.target.value)}
          onBlur={(): void => setQtyText(normaliseOnBlur(qtyText, floor))}
          className="w-[5rem] rounded-sm border border-line px-[8px] py-[6px]"
        />

        {resultingPieces !== null ? (
          <span className="text-[12px] text-muted">
            = {resultingPieces.toLocaleString(locale)} {pieces}
          </span>
        ) : null}
      </div>

      {/* Feature 155 (FR-014) — the minimum, stated directly under the control it constrains. */}
      {statement ? (
        <p id={statementId} className="-mt-1 text-[12px] text-muted">
          {statement}
        </p>
      ) : null}

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
              {quoteAddButtonLabel(quoteAdded, locale)}
            </button>
          ) : null}
        </div>
      ) : null}

      {showCart ? (
        <CartAddedPopup
          state={cartState}
          locale={locale}
          addedLabel={t('product.cartPopup.added')}
          goToCartLabel={t('product.cartPopup.goToCart')}
          continueLabel={t('product.cartPopup.continue')}
          closeLabel={t('product.cartPopup.close')}
        />
      ) : null}
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
