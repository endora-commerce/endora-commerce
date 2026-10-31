import { defineMessages } from './define';

/**
 * The `content` namespace (issue #85): the blog, the contact page, the
 * newsletter components and other CMS-shaped content.
 *
 * Keys are `content.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`content.blog.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const content = defineMessages({
  'en-US': {},
  'pl-PL': {},
});
