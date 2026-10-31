import { defineMessages } from './define';

/**
 * The `commerce` namespace (issue #85): cart, checkout, catalog, the product
 * page and product listings, compare, and the product components.
 *
 * Keys are `commerce.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`commerce.cart.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const commerce = defineMessages({
  'en-US': {},
  'pl-PL': {},
});
