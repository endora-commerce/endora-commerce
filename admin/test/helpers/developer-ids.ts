/**
 * An identifier written where a person's words belong: `customerNote`,
 * `select-all`, `select-ORD-1`, `deliveryAddress-street` (issue #1475, UX audit
 * SALES-10). An `aria-label` of that shape is read aloud verbatim, in English,
 * whatever the operator's language, and it replaces the visible label as the
 * control's accessible name (WCAG 2.2 SC 2.5.3, 4.1.2).
 */
export const DEVELOPER_ID = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$|^[a-z][a-z0-9]*(?:-[A-Za-z0-9]+)+$/;

/** Every `aria-label` under `container` that is an identifier rather than words. */
export function developerIdLabels(container: Element): string[] {
  return Array.from(container.querySelectorAll('[aria-label]'))
    .map((element) => element.getAttribute('aria-label') ?? '')
    .filter((label) => DEVELOPER_ID.test(label));
}

/**
 * The element with `id`, failing like a `getBy*` query when there is none.
 * For a test that needs one control among several sharing a name (the street
 * of the delivery and of the billing address) without asserting the name.
 */
export function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`No element with id "${id}"`);
  return element;
}
