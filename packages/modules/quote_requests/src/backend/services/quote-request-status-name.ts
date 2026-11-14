import type { SupportedLanguage } from '@endora-commerce/contracts';
import { QUOTE_REQUEST_ADMIN_SEARCH_STATUS_KEYS } from '../admin-search-provider.js';

/** This module's own bundle, in a language. */
export type QuoteRequestsTranslate = (key: string, language: SupportedLanguage) => Promise<string>;

/**
 * A Quote Request status's name in `language`, in this module's one wording —
 * the bundle keys its global-search results already name a status with — so
 * that every surface naming a status, here or in another module through
 * `QuoteRequestReadPort.statusName` (issue #455), says the same thing. A code
 * outside the closed set answers as it is: there is nothing to translate.
 */
export async function quoteRequestStatusName(
  translate: QuoteRequestsTranslate,
  status: string,
  language: SupportedLanguage,
): Promise<string> {
  const key = QUOTE_REQUEST_ADMIN_SEARCH_STATUS_KEYS[status];
  return key === undefined ? status : translate(key, language);
}
