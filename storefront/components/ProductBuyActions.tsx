'use client';

import { useState, type ReactNode } from 'react';
import { addRfqDraftItem } from '../lib/rfqDraft';

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
  addToCartAction: (formData: FormData) => void | Promise<void>;
  addToCartLabel: string;
  /**
   * Optional action rendered as the first button in the row, before "Add to
   * quote" (e.g. the Add-to-shopping-list heart button).
   */
  leadingAction?: ReactNode;
  /**
   * Feature 044 / US3 — on phones the PDP shows a sticky add-to-cart bar with
   * its own quantity stepper + cart button. When that bar is present this hides
   * the inline quantity cluster + cart button on mobile (keeping the
   * shopping-list / quote actions) so the controls are not duplicated.
   */
  hideQuantityCartOnMobile?: boolean;
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
  hideQuantityCartOnMobile = false,
}: ProductBuyActionsProps): ReactNode {
  const units = packagingUnits ?? [];
  const defaultUnit = units.find((u) => u.isDefault) ?? null;
  // Default the selector to the operator's default unit when present, else to
  // single pieces (empty string).
  const [unitId, setUnitId] = useState<string>(defaultUnit?.id ?? '');
  const [qty, setQty] = useState(1);
  const [quoteAdded, setQuoteAdded] = useState(false);
  if (!showCart && !showQuote) return null;

  const selectedUnit = units.find((u) => u.id === unitId) ?? null;
  const resultingPieces = selectedUnit ? selectedUnit.baseQuantity * qty : null;
  // When the mobile sticky buy bar owns the quantity + cart, hide those inline
  // controls on phones to avoid the duplicated row the buyer would otherwise see.
  const mobileHide = hideQuantityCartOnMobile ? ' max-md:hidden' : '';

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
    <div className="flex flex-wrap items-center gap-2">
      {units.length > 0 ? (
        <select
          aria-label="Jednostka"
          value={unitId}
          onChange={(e): void => setUnitId(e.target.value)}
          className={`rounded-sm border border-line px-[8px] py-[6px] text-[13px]${mobileHide}`}
        >
          <option value="">{singlePieceLabel}</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.baseQuantity} {piecesLabel})
            </option>
          ))}
        </select>
      ) : null}

      <label htmlFor={`buy-qty-${productId}`} className={`text-[12px]${mobileHide}`}>
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
        className={`w-[5rem] rounded-sm border border-line px-[8px] py-[6px]${mobileHide}`}
      />

      {resultingPieces !== null ? (
        <span className={`text-[12px] text-muted${mobileHide}`}>
          = {resultingPieces.toLocaleString('pl-PL')} {piecesLabel}
        </span>
      ) : null}

      {leadingAction ?? null}

      {showQuote ? (
        <button type="button" onClick={addToQuote} className="btn btn--outline btn--sm">
          {quoteAdded ? 'Dodano ✓' : 'Dodaj do zapytania'}
        </button>
      ) : null}

      {showCart ? (
        <form action={addToCartAction} className={mobileHide ? 'max-md:hidden' : undefined}>
          <input type="hidden" name="productId" value={productId} />
          {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
          {selectedUnit ? (
            <input type="hidden" name="packagingUnitId" value={selectedUnit.id} />
          ) : null}
          <input type="hidden" name="quantity" value={qty} />
          <button type="submit" className="b2b-cta">
            {addToCartLabel}
          </button>
        </form>
      ) : null}
    </div>
  );
}
