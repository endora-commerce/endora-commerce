import type { ScopePickerValue } from '@endora-commerce/admin-kit/components';

/** Pick the language used for content/meta saves — must be in scope.languages. */
export function resolveScopedContentLanguage(
  scope: ScopePickerValue,
  activeLanguage: string | null,
): string | null {
  if (activeLanguage && scope.languages.includes(activeLanguage)) return activeLanguage;
  return scope.languages[0] ?? null;
}
