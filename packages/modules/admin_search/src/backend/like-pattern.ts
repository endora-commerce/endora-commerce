import { isUuidShape } from '@endora-commerce/contracts';
/**
 * Literal matching for `ILIKE … ESCAPE '\'` (spec FR-012, research R-9).
 *
 * Internal to `admin_search`: a provider receives the text already escaped as
 * `AdminSearchProviderQuery.likeEscaped`, so no provider module imports a
 * helper from this one (that would be a module-boundary reach).
 */

/** Escape `\`, `%` and `_` so the text matches itself and nothing else. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Whether `text` is a UUID — every provider then also matches its record's `id` (FR-010). */
export function isUuid(text: string): boolean {
  return isUuidShape(text);
}
