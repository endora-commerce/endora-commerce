import type { ReactNode } from 'react';
import { readAndClearCartMergeFlash } from '../lib/session';
import { getServerContext } from '../lib/server-context';

/**
 * Feature 037-cart-merge-on-login — post-login confirmation toast.
 *
 * Server component that reads the `b2b_cart_merge_flash` cookie on
 * render, deletes it in the same call (so the toast never reappears),
 * and renders the localized confirmation copy if the cookie was set.
 * Returns `null` when there is no flash to show — including when the
 * merge had no observable effect (FR-018).
 *
 * The toast lives in the root layout so it shows on whichever page the
 * login redirect lands on (the default `/account`, or a custom `?next=`
 * target like `/cart`). The dismiss control is a plain `<form>` with a
 * server-action no-op: the cookie has already been cleared on this
 * render, so a refresh or interaction simply repaints without the toast.
 */
export async function CartMergeToast(): Promise<ReactNode> {
  const outcome = await readAndClearCartMergeFlash();
  if (outcome === null) return null;

  const { locale } = await getServerContext();
  const message = pickToastCopy(locale, outcome);

  return (
    <div
      role="status"
      aria-live="polite"
      className="b2b-cart-merge-toast"
      data-testid="cart-merge-toast"
      data-outcome={outcome}
    >
      <span>{message}</span>
    </div>
  );
}

/**
 * Two-language inline copy. Wider i18n integration (admin dictionary
 * keys, custom-language fallback) is deferred until a story drives it;
 * meanwhile keeping the copy here avoids touching the dictionary build.
 */
function pickToastCopy(locale: string, outcome: 'adopted' | 'merged'): string {
  const isPolish = locale.toLowerCase().startsWith('pl');
  if (outcome === 'adopted') {
    return isPolish
      ? 'Twoje produkty z koszyka sprzed logowania zostały dodane do Twojego konta.'
      : "We've attached the basket you started before signing in to your account.";
  }
  return isPolish
    ? 'Dodaliśmy do Twojego koszyka produkty, które wybrałeś przed zalogowaniem.'
    : "We've added the items you picked before signing in to your existing cart.";
}
