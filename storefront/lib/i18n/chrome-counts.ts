import { format } from './format';
import { tForLocale, type MessageKey } from './messages';
import { formatCount } from '../orderMinimum';
import { pluralForm } from './plural';

/**
 * Counted phrases of the `chrome` namespace (issue #85), in the right plural
 * form for the reader's language: Polish has three (one, then 2–4, then 5 and
 * up, with 12–14 taking the third), English two. The form is the
 * `Intl.PluralRules` category chosen by `pluralForm` (`./plural`), so each
 * phrase is keyed `<base>.<form>` in the catalogue, as
 * `lineGroups.summary.items.*` is.
 */
function counted(base: string, count: number, locale: string): string {
  const key = `${base}.${pluralForm(count, locale)}` as MessageKey;
  return format(tForLocale(locale)(key), { count: formatCount(count, locale) });
}

/** "4,218 products" — a department's product count, in the reader's plural form. */
export function productCountLabel(count: number, locale: string): string {
  return counted('chrome.shared.productCount', count, locale);
}

/** "3 items in cart" — the mini-cart badge's label, in the reader's plural form. */
export function miniCartCountLabel(count: number, locale: string): string {
  return counted('chrome.miniCart.count', count, locale);
}
