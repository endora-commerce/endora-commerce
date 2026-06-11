'use client';

import { useState, type ReactNode } from 'react';
import { addRfqDraftItem } from '../../lib/rfqDraft';

/**
 * "Add to quote request" button — pushes the product into the client-side RFQ
 * draft (`lib/rfqDraft`) instead of immediately creating a server-side request.
 * The buyer accumulates lines exactly like the cart, then reviews and submits
 * them on `/quote-request`.
 *
 * Renders an optional quantity input (PDP) and flashes a short "Added ✓"
 * confirmation. The header badge updates via the `b2b:rfq-draft:changed`
 * event the draft store dispatches.
 */
export function AddToRfqButton(props: {
  productId: string;
  productSlug: string;
  productName: string;
  unitPrice?: { amount: number; currency: string } | null;
  /** Show a quantity input alongside the button (PDP). */
  withQuantity?: boolean;
  /** Locale for the button copy (defaults to Polish, matching the storefront). */
  locale?: string;
  className?: string;
}): ReactNode {
  const pl = (props.locale ?? 'pl').startsWith('pl');
  const labels = pl
    ? { add: 'Dodaj do zapytania', added: 'Dodano ✓', qty: 'Ilość' }
    : { add: 'Add to quote', added: 'Added ✓', qty: 'Quantity' };

  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const onAdd = (): void => {
    addRfqDraftItem({
      productId: props.productId,
      slug: props.productSlug,
      name: props.productName,
      unitPrice: props.unitPrice ?? null,
      quantity: qty,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className={`flex items-center gap-2 ${props.className ?? ''}`}>
      {props.withQuantity ? (
        <>
          <label htmlFor={`rfq-qty-${props.productId}`} className="text-[12px]">
            {labels.qty}
          </label>
          <input
            id={`rfq-qty-${props.productId}`}
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
        </>
      ) : null}
      <button type="button" onClick={onAdd} className="btn btn--outline btn--sm">
        {added ? labels.added : labels.add}
      </button>
    </div>
  );
}
