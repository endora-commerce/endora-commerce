import type { ScopePickerValue } from '@endora-commerce/admin-kit/components';

/** Pick the language used for content/meta saves — must be in scope.languages. */
export function resolveScopedContentLanguage(
  scope: ScopePickerValue,
  activeLanguage: string | null,
): string | null {
  if (activeLanguage && scope.languages.includes(activeLanguage)) return activeLanguage;
  return scope.languages[0] ?? null;
}

/**
 * Issue #1461 (CONTENT-02) — whether two scopes hold the same channels and
 * languages. Order is not a change: the picker and the server need not list
 * them in the same order, and a just-saved scope must read as clean.
 */
export function isSameScope(a: ScopePickerValue, b: ScopePickerValue): boolean {
  const same = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && [...x].sort().every((value, index) => value === [...y].sort()[index]);
  return same(a.salesChannelIds, b.salesChannelIds) && same(a.languages, b.languages);
}
