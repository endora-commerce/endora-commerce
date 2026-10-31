import { defineMessages } from './define';

/**
 * The `account` namespace (issue #85): orders, quote requests, shopping lists,
 * returns, addresses, preferences, the organization pages, the account pages
 * and the account newsletter page.
 *
 * Keys are `account.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`account.orders.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const account = defineMessages({
  'en-US': {},
  'pl-PL': {},
});
