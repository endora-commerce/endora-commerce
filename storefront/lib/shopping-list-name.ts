import { isAutoDefaultShoppingList } from '@endora-commerce/contracts';
import type { tForLocale } from './i18n/messages';

/**
 * A shopping list's name as the storefront shows it (owner ruling on PR #760,
 * issue #751): the default list the platform created, while nobody has renamed
 * it, in the shop language; any other list by the name the customer gave it.
 * Presentation only — the stored name is not changed.
 */
export function shoppingListDisplayName(
  list: { readonly name: string; readonly isDefault: boolean },
  t: ReturnType<typeof tForLocale>,
): string {
  return isAutoDefaultShoppingList(list) ? t('account.shoppingLists.autoDefaultName') : list.name;
}
