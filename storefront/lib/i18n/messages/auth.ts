import { defineMessages } from './define';

/**
 * The `auth` namespace (issue #85): login, registration, verification,
 * password reset, invitations, the security pages and MFA.
 *
 * Keys are `auth.<screen>.<thing>` — the area, then the page or component
 * that renders the string, then what it is (`auth.login.heading`). Every key
 * is written in both blocks; `tsc` refuses a block with a key the other lacks.
 * Values with placeholders use `{name}` and are filled with `format` from
 * `../format`.
 */
export const auth = defineMessages({
  'en-US': {},
  'pl-PL': {},
});
