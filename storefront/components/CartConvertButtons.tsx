import type { ReactNode } from 'react';

/**
 * CartConvertButtons (feature 027 US3) — Industria-themed.
 *
 * Cart → Quote Request CTA, designed to sit in the cart card footer
 * next to the ghost "Continue shopping" button. Uses `.btn .btn--outline`
 * so it reads as a secondary action without competing with the primary
 * checkout CTA in the sticky summary aside.
 *
 * The QR → Cart and ShoppingList → Cart conversions live on the
 * respective destination pages (QR detail, list detail), not here.
 *
 * Disabled when the cart is empty or when the buyer's Organization
 * can't transact (per feature 026's gating).
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
    <form action={convertToQrAction} style={{ display: 'inline-flex' }}>
      <button
        type="submit"
        className="btn btn--outline"
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? disabledReason ?? strings.convertToQrHint : strings.convertToQrHint}
        style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
        {strings.convertToQrLabel}
      </button>
    </form>
  );
}
