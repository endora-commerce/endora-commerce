/**
 * An order status as the admin screens read it: the stable `code` and the
 * operator's per-language names (`order_statuses.name`, e.g.
 * `{ en: 'New', pl: 'Nowy' }`), plus the language-independent `defaultName`
 * where the response carries it.
 */
export interface OrderStatusNames {
  code: string;
  name: Record<string, string>;
  defaultName?: string | null;
}

/**
 * An order status's name in the admin's language (issue #1809).
 *
 * The names are operator content stored per language, so the response carries
 * all of them and the reader picks one (`specs/conventions/module-i18n.md`, the
 * *operator content* kind). The ladder: the admin's language, a regional entry
 * of it (`pl-PL`), the status's default name, English, any entry, and the code
 * last — so an empty or missing entry never renders a blank badge.
 */
export function orderStatusName(status: OrderStatusNames | undefined, language: string, code?: string): string {
  if (!status) return code ?? '';
  const names = status.name ?? {};
  const regional = Object.keys(names).find((key) => key.startsWith(`${language}-`));
  return (
    names[language] ||
    (regional ? names[regional] : '') ||
    status.defaultName ||
    names['en'] ||
    names['en-US'] ||
    Object.values(names).find((value) => value !== '') ||
    status.code
  );
}
