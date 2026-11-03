/**
 * What one `filter[attr.<key>]` means for one product value (issue #684): the
 * value, rendered as `String` renders it, is one of the requested values — and
 * a multiselect matches when **any** of its options does, each option rendered
 * the same way. An empty multiselect matches nothing, and so does a key the
 * product does not carry (`undefined`).
 *
 * This is the page-side half of the listing's attribute filter. The statement
 * half is `CatalogQueryService#attributeCondition`, which restates this rule in
 * SQL; `backend/test/contract/catalog/products-list-filtered-paging.test.ts`
 * holds the two together. Change one, change the other.
 */
export function attributeFilterMatches(value: unknown, wanted: readonly string[]): boolean {
  if (value === undefined) return false;
  const rendered = Array.isArray(value) ? value.map((option) => String(option)) : [String(value)];
  return rendered.some((text) => wanted.includes(text));
}
