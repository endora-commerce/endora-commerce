import { StorefrontApiError } from './client';

/**
 * `MODULE_DISABLED` → a typed absence — feature 073 / US1 (T041), R-8.
 *
 * The storefront decides what to render from the **presence projection**, not
 * from a 503. This helper is the defence-in-depth half: the projection and the
 * gate can disagree for the length of one cache window, and when they do, the
 * request that slips through must produce the same *absence* the projection
 * would have produced — not a default, and not a crash.
 *
 * Both failure modes exist in this codebase today and they are opposites:
 *
 *  - `getShopInfo`, `getHomepageConfig`, `fetchPwaConfig`, `getCartItemCount`
 *    and `getMe` swallow **every** error into a default, so a disabled module
 *    is indistinguishable from a network blip and the page keeps rendering an
 *    empty module surface — the opposite of absence;
 *  - `getBlogIndex` maps 404 to `null` but **rethrows** every other status, so
 *    a gated `blog` throws a render error instead of disappearing.
 *
 * One helper, applied at both, is what makes the two behave the same way.
 */

/** True when the backend refused because the module is not effectively present. */
export function isModuleDisabled(err: unknown): boolean {
  return err instanceof StorefrontApiError && err.code === 'MODULE_DISABLED';
}

/**
 * Run `fetcher`; answer `absent` when the owning module is switched off.
 *
 * Every other error propagates. That asymmetry is the point: "the module is
 * gone" is a decision the platform made and the page renders around it, while
 * "the backend is broken" is not something a storefront should quietly paper
 * over with an empty list.
 */
export async function withModuleAbsence<T, A>(
  fetcher: () => Promise<T>,
  absent: A,
): Promise<T | A> {
  try {
    return await fetcher();
  } catch (err) {
    if (isModuleDisabled(err)) return absent;
    throw err;
  }
}
