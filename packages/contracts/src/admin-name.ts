/**
 * The admin name rule's shared half — feature 161, G15 redesign
 * (`specs/161-price-book-editor/research.md` R14).
 *
 * `catalog` stores, per admin language, a sort and search key for every
 * product (generated columns built by its SQL function `catalog_admin_fold`);
 * `price_lists` orders the attribute and category lines of a price book by the
 * same fold in TypeScript. This is that fold, kept beside the SQL one by a
 * parity test (`backend/test/integration/price_lists/admin-name-rule-parity.test.ts`):
 * lower case; `ł→l`, `đ→d`, `ø→o`, `ß→s`, `æ→a`; NFKD with the combining
 * marks removed. Compared bytewise, it orders `Ążur` with `A` and `Łącznik`
 * with `L`, the same on every machine and in every database locale.
 */

/** The admin UI languages that have stored keys; any other language reads `en`. */
export const ADMIN_NAME_LANGUAGES = ['en', 'pl'] as const;
export type AdminNameLanguage = (typeof ADMIN_NAME_LANGUAGES)[number];

/** The admin language a tag (`pl`, `pl-PL`, `de`, `null`) orders and searches by. */
export function adminNameLanguage(tag: string | null | undefined): AdminNameLanguage {
  const primary = (tag ?? '').split('-')[0]!.toLowerCase();
  return (ADMIN_NAME_LANGUAGES as readonly string[]).includes(primary) ? (primary as AdminNameLanguage) : 'en';
}

const FOLDED: Record<string, string> = { ł: 'l', đ: 'd', ø: 'o', ß: 's', æ: 'a' };

/** Case- and accent-fold a name the way `catalog_admin_fold` does. */
export function foldAdminName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[łđøßæ]/g, (c) => FOLDED[c]!)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}
