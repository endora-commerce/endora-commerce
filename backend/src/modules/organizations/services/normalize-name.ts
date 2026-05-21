/**
 * Diacritic-insensitive normalization for the Organization's `name_search`
 * column.
 *
 * Strips every Unicode combining mark using NFD decomposition, lowercases
 * the result, and collapses internal whitespace. Used both by the entity
 * `@BeforeCreate` / `@BeforeUpdate` hooks and by the picker endpoint when
 * normalizing the user's query string — guarantees that a search for
 * "lodz" hits "Łódź" and vice-versa.
 *
 * Implementation uses Node natives only (Principle IV — no new dep).
 */
export function normalizeOrganizationName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
