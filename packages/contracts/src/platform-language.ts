// The language the platform answers a request in (feature 083, D-136).
//
// Named for the platform, not for an audience. The constant this replaces was
// `ADMIN_LANGUAGE_FALLBACK`, and the name is what made issue #234 invisible:
// a fallback called "admin" reads correctly in a resolver that only ever
// answered admins, so nobody asked why a buyer was reaching it.

import { z } from 'zod';

/**
 * The languages the platform ships translation bundles for.
 *
 * Distinct from `Language` in `i18n.ts`, which is the operator-configured
 * **content** language pool — BCP-47, database rows, extended at runtime by an
 * operator. This enum is extended only by shipping a bundle and changing this
 * line. `normalise` in `backend/src/kernel/i18n/request-language.ts` is the
 * bridge between the two, and a bridge needs both ends named.
 */
export const SupportedLanguageSchema = z.enum(['en', 'pl']);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

/** Convenience: every supported value as a runtime array. */
export const SUPPORTED_LANGUAGES = SupportedLanguageSchema.options;

/** The language the platform answers in when nothing else resolves. */
export const LANGUAGE_FALLBACK: SupportedLanguage = 'en';

/**
 * The shipped language a BCP-47 tag (`pl-PL`, a sales channel's
 * `defaultLanguage`, a document's `language`) is written in — its primary
 * subtag when the platform ships a bundle for it, else {@link LANGUAGE_FALLBACK}.
 *
 * For a backend module that composes prose for a reader whose language it holds
 * as a content-language tag and looks the sentence up in its own bundle.
 */
export function supportedLanguageOf(tag: string | null | undefined): SupportedLanguage {
  const primary = (tag ?? '').split(/[-_]/, 1)[0]?.trim().toLowerCase() ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : LANGUAGE_FALLBACK;
}
