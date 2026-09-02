import {
  DEFAULT_STOREFRONT_THEME_CODE,
  isStorefrontThemeCode,
  type StorefrontThemeCode,
} from '@endora-commerce/contracts';

/**
 * Which token set this request renders in — feature `005-sales-channels`.
 *
 * The channel's `themeCode` selects a `:root[data-theme='<code>']` block in
 * `app/globals.css`. The decision is made on the server, before the first byte
 * of HTML, because a theme applied after hydration is a flash of the wrong
 * brand: `@theme inline` maps every Tailwind utility onto the Tier-1 variables
 * by reference, so the attribute on `<html>` is the whole mechanism and it has
 * to be in the markup the buyer's browser first parses.
 */

export interface ResolvedStorefrontTheme {
  /** The token set to render in. Always a code this storefront implements. */
  readonly code: StorefrontThemeCode;
  /**
   * What the channel asked for, when that is not what it got. `null` when the
   * channel named a theme this storefront implements, or named none at all.
   */
  readonly unknownRequest: string | null;
}

/**
 * Pure half of the decision, exported so the SSR-only test harness can assert
 * it without a render.
 *
 * ## What "refuses rather than guesses" means for a buyer-facing page
 *
 * Feature `005-sales-channels`' R-3 made the storefront responsible for
 * refusing to render an unknown theme, and left "refuse" undefined. It is
 * defined here, and it is **not** a blank page.
 *
 * The page a buyer asked for is not the operator's mistake to pay for. An
 * unknown `themeCode` means one of two things — a channel configured against a
 * fork's theme catalogue, or a typo — and neither is a reason to answer a
 * shopper with an error. So the render proceeds in
 * {@link DEFAULT_STOREFRONT_THEME_CODE}, and the refusal is aimed where it can
 * be acted on: the requested code is reported to the operator's logs, once per
 * distinct code per process, and it is **never** silently written back or
 * treated as valid. Guessing — matching a prefix, folding a separator, picking
 * the "nearest" theme — is the thing that is refused: a channel whose brand is
 * wrong renders in the reference brand, visibly the default, rather than in
 * some third brand nobody chose.
 *
 * A channel that names **no** theme is not an unknown theme and is not
 * reported: `themeCode` is nullable and the default is the answer the field's
 * absence has always meant.
 */
export function resolveStorefrontTheme(
  themeCode: string | null | undefined,
): ResolvedStorefrontTheme {
  if (themeCode === null || themeCode === undefined || themeCode === '') {
    return { code: DEFAULT_STOREFRONT_THEME_CODE, unknownRequest: null };
  }
  if (isStorefrontThemeCode(themeCode)) {
    return { code: themeCode, unknownRequest: null };
  }
  return { code: DEFAULT_STOREFRONT_THEME_CODE, unknownRequest: themeCode };
}

/**
 * Codes already reported in this process.
 *
 * A misconfigured channel is misconfigured on *every* request, so an
 * unconditional warning would put one line per page view into the operator's
 * log and bury the one that matters. The set is per process and never cleared:
 * a fixed configuration stops producing the code, and a restart re-reports it.
 */
const reported = new Set<string>();

/**
 * {@link resolveStorefrontTheme} plus the operator-facing half. This is what
 * the request path calls; the pure function above is what the tests assert.
 */
export function themeForChannel(
  themeCode: string | null | undefined,
  channelCode?: string | undefined,
): StorefrontThemeCode {
  const resolved = resolveStorefrontTheme(themeCode);
  if (resolved.unknownRequest !== null && !reported.has(resolved.unknownRequest)) {
    reported.add(resolved.unknownRequest);
    // The operator's only signal that a channel is configured against a theme
    // this storefront does not ship. `Hook.tsx` reports a failed CMS hook the
    // same way; there is no other log sink on the server render path.
    console.warn(
      `[storefront] sales channel ${channelCode ?? '(unresolved)'} requests theme ` +
        `"${resolved.unknownRequest}", which this storefront does not implement; ` +
        `rendering "${resolved.code}".`,
    );
  }
  return resolved.code;
}

/** Test seam: forget which unknown codes have already been reported. */
export function resetThemeWarnings(): void {
  reported.clear();
}
