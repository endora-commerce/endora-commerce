import { defineMessages } from './define';

/**
 * The `chrome` namespace (issue #85): the home page, header, footer,
 * not-found, offline, PWA, analytics and consent, the dictionary pickers,
 * mobile overlays — and anything that fits no other area.
 *
 * Keys are `chrome.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`chrome.footer.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const chrome = defineMessages({
  'en-US': {},
  'pl-PL': {},
});
