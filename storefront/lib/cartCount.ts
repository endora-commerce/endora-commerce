import { getCartItemCountAction } from './actions/cart';

/**
 * The live cart line count, as every cart badge reads it from its effect.
 *
 * Resolved through a server action rather than a browser fetch to the backend:
 * the cart identity cookies are httpOnly and scoped to the storefront origin,
 * so only the storefront's own server can present them (`lib/actions/cart.ts`).
 *
 * Three badges are mounted at once — the desktop header, the mobile header and
 * the mobile tab bar — and each asks on mount, on every navigation and on every
 * `b2b:cart:changed`, so the read in flight is shared rather than repeated.
 * Nothing is kept once it settles: the next ask is a fresh read.
 *
 * Answers `null` when the read fails, so a badge keeps its last good value
 * instead of flashing an empty cart.
 */
let inFlight: Promise<number | null> | null = null;

export function loadCartItemCount(): Promise<number | null> {
  if (!inFlight) {
    const read = getCartItemCountAction()
      .then((count): number | null => (typeof count === 'number' ? count : null))
      .catch((): null => null)
      .finally(() => {
        if (inFlight === read) inFlight = null;
      });
    inFlight = read;
  }
  return inFlight;
}
