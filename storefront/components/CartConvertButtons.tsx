import type { ReactNode } from 'react';

/**
 * CartConvertButtons (feature 027 US3).
 *
 * Cart → Quote Request CTA. The QR → Cart and ShoppingList → Cart
 * conversions live on the respective destination pages (QR detail, list
 * detail), not here.
 *
 * Disabled when the cart is empty or when the buyer's Organization
 * can't transact (per feature 026's gating).
 *
 * Browser-verification note: visual / disabled-state styling needs
 * eyes; the form submission is a plain server action.
 */

interface CartConvertButtonsProps {
  disabled: boolean;
  disabledReason: string | null;
  convertToQrAction: (formData: FormData) => Promise<void>;
  strings: {
    convertToQrLabel: string;
    convertToQrHint: string;
  };
}

export function CartConvertButtons({
  disabled,
  disabledReason,
  convertToQrAction,
  strings,
}: CartConvertButtonsProps): ReactNode {
  return (
    <div className="b2b-cart__convert" style={{ marginTop: '1.5rem' }}>
      <form action={convertToQrAction} style={{ display: 'inline-block' }}>
        <button
          type="submit"
          disabled={disabled}
          aria-disabled={disabled}
          title={disabled ? disabledReason ?? strings.convertToQrHint : strings.convertToQrHint}
        >
          {strings.convertToQrLabel}
        </button>
      </form>
    </div>
  );
}
