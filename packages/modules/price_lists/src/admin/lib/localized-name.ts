import { useCallback } from 'react';
import { useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { adminLanguageToLocale, pickCategoryDisplayName } from '@endora-commerce/admin-kit/components';

/**
 * A catalogue name in the admin language, picked as every admin surface picks
 * it (`pickCategoryDisplayName`: the language's tag, then `en-US`, then any
 * non-empty one, then `fallback`). Categories, products and sales channels all
 * arrive with `name` keyed by language tag; rendering the map as it came would
 * put an object into the tree.
 */
export function useLocalizedName(): (name: Record<string, string> | undefined, fallback: string) => string {
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);
  return useCallback(
    (name: Record<string, string> | undefined, fallback: string): string =>
      name ? pickCategoryDisplayName(name, fallback, locale) : fallback,
    [locale],
  );
}
