import type { SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';

/**
 * The accessible name of the boot skeleton (issues #1431, #1485).
 *
 * It cannot come from the module bundles: the skeleton is exactly what renders
 * **while** the bundle is in flight, so `t()` would answer with the raw key the
 * skeleton exists to hide. Unlike the pre-auth copy beside it, the language is
 * known by then — the session payload carries the operator's
 * `preferredLanguage` — so it ships in every admin language rather than in
 * English alone. `satisfies` makes a language added to
 * `SupportedAdminLanguage` a compile error here until it has a line.
 */
export const adminBootCopy = {
  en: 'Loading the admin panel…',
  pl: 'Ładowanie panelu administracyjnego…',
} as const satisfies Record<SupportedAdminLanguage, string>;
