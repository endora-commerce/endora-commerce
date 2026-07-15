'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { AddToCartResult } from '../lib/cartAddState';

/**
 * Confirmation popup shown after a PDP add-to-cart. Reacts to the
 * `useActionState` result of the add-to-cart form: on success it announces
 * "product added" (with a link to the cart) and refreshes the header cart badge
 * via the `b2b:cart:changed` event; on error it surfaces the message. The popup
 * auto-dismisses and can be closed manually. Replaces the previous behaviour of
 * force-redirecting the buyer to `/cart`.
 */
export function CartAddedPopup({
  state,
  cartHref = '/cart',
  addedLabel = 'Produkt został dodany do koszyka.',
  goToCartLabel = 'Przejdź do koszyka',
  continueLabel = 'Kontynuuj zakupy',
  closeLabel = 'Zamknij',
}: {
  state: AddToCartResult;
  cartHref?: string;
  addedLabel?: string;
  goToCartLabel?: string;
  continueLabel?: string;
  closeLabel?: string;
}): ReactNode {
  const [view, setView] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (state.status === 'success') {
      // No navigation now, so tell the header cart badge to refresh itself.
      window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      setView({ ok: true, text: addedLabel });
      const id = window.setTimeout(() => setView(null), 8000);
      return () => window.clearTimeout(id);
    }
    if (state.status === 'error') {
      setView({ ok: false, text: state.message });
      const id = window.setTimeout(() => setView(null), 6000);
      return () => window.clearTimeout(id);
    }
    return undefined;
    // Re-run whenever the action returns a new state object (success tokens make
    // repeated adds distinct).
  }, [state, addedLabel]);

  if (!view) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-sm items-start gap-3 rounded-md border px-4 py-3 text-[13px] shadow-lg md:inset-x-auto md:right-4 md:left-auto',
        view.ok ? 'border-line bg-ok-soft text-ok' : 'border-line bg-bad-soft text-bad',
      ].join(' ')}
    >
      <span className="mt-[1px] shrink-0" aria-hidden="true">
        {view.ok ? <CheckIcon /> : <AlertIcon />}
      </span>
      <div className="flex-1">
        <p className="font-medium">{view.text}</p>
        {view.ok ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView(null)}
              className="btn btn--outline h-[34px] px-3 text-[12px]"
            >
              {continueLabel}
            </button>
            <Link
              href={cartHref}
              className="btn btn--dark h-[34px] px-3 text-[12px] no-underline"
            >
              {goToCartLabel}
            </Link>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setView(null)}
        aria-label={closeLabel}
        className="shrink-0 text-current opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
