import { INSTANCE_THEME_CODES } from './themes.generated';

/**
 * This storefront's own theme identity — feature
 * `specs/102-storefront-theme-discovery/`.
 *
 * `@endora-commerce/contracts` used to export a closed enum of theme codes, and
 * D-199 removed it: a theme is a token set a **third party** may publish as an
 * ordinary npm package, so no set the platform can compile is the whole set.
 * The question moved from *"is this one of our themes"* to *"does this
 * storefront have this theme"*, and only this instance can answer it — from the
 * packages it has installed and the blocks its own stylesheet declares.
 *
 * `themes.generated.ts` is that answer, produced at build time by
 * `scripts/generate-themes.mjs` (`pnpm --filter storefront run themes:generate`).
 */

/**
 * A theme code.
 *
 * It is `string`, and **that is the thing that was given up**: no compiler can
 * close a set a stranger extends after the compiler has run. The alias survives
 * the widening because the name is what tells a reader what the value is for;
 * it narrows nothing and must not be read as though it did. What replaces the
 * compile-time guarantee is `scripts/check-themes.mjs`, over the emitted
 * stylesheet, which covers third-party themes the enum never could.
 */
export type StorefrontThemeCode = string;

/**
 * The token set a channel gets when it names no theme, and the one it falls
 * back to when it names a theme this storefront does not have.
 *
 * It is an **instance constant** and must be a member of the generated
 * registry: a default no block defines would render every unbranded fallback
 * unbranded twice over. `check:themes` refuses it as `undefined-theme`, which is
 * the case a scaffold that deleted the reference themes would otherwise ship.
 */
export const DEFAULT_STOREFRONT_THEME_CODE: StorefrontThemeCode = 'industria';

/**
 * Does this storefront have this theme?
 *
 * The predicate over the generated registry, and deliberately **not** a regex
 * over the code's shape. An open predicate would make every well-formed string
 * a known theme, which deletes `unknownRequest` and the fallback with it: a typo
 * would stamp an unmatched `data-theme` and the shop would render unbranded —
 * the exact outcome `theme.ts` exists to prevent.
 */
export function isStorefrontThemeCode(value: unknown): value is StorefrontThemeCode {
  return (
    typeof value === 'string' &&
    (INSTANCE_THEME_CODES as readonly string[]).includes(value)
  );
}
