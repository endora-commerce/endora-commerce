/**
 * The locale the root layout stamped on `<html lang>`.
 *
 * Every other storefront component is handed its locale by the Server Component
 * that renders it. A Next.js `error.tsx` cannot be: an error boundary receives
 * exactly `{ error, reset }`, so the only place its language can come from is
 * the document the root layout already stamped (`<html lang={locale}>`).
 *
 * Read after mount, never during render, so the server's HTML and the first
 * client render agree on {@link FALLBACK_LOCALE} and hydration matches; the
 * buyer's language replaces it on the next tick.
 */
export const FALLBACK_LOCALE = 'en-US';

/** `<html lang>`, or the fallback with no document or an empty attribute. */
export function documentLocale(): string {
  if (typeof document === 'undefined') return FALLBACK_LOCALE;
  return document.documentElement.lang || FALLBACK_LOCALE;
}
