// Default subject + content for the transactional e-mail this module declares
// in its manifest (feature 047): the operator-triggered password reset
// (issue #1295). Simple layout via the shared header/footer embeds + heading /
// text / CTA, as every other module's defaults.

import type { EmailDefaults } from '@endora-commerce/contracts';
import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * English first: `TransactionalEmailService` passes the first language as the
 * content resolver's `fallbackLanguage`, so a language with no content reads
 * English (owner ruling, 2026-09-01).
 */
const LANGS = ['en-US', 'pl-PL'];

/**
 * The e-mail an operator sends with **Reset password** on the admin customer
 * screen.
 *
 * It was a hard-coded English message handed straight to the mailer — no code,
 * no template, no language — so a customer of a Polish store read English, and
 * the store could not edit its wording or branding (issue #1295).
 *
 * `nonDeactivatable`, on the criterion `organizations` states for
 * `email_verification` (issue #89): it is how the customer regains access to
 * the account. A deactivated e-mail answers `trySend` with *handled*, so no
 * fallback goes out — an operator who switched it off would click *Reset
 * password* and the customer would receive nothing.
 *
 * The link is also written into the body copy, so the plain-text part carries
 * it and a client that does not render the button still reaches the page.
 */
export const ADMIN_PASSWORD_RESET_DEFAULT = {
  defaultSubject: {
    'en-US': 'Set a new password',
    'pl-PL': 'Ustaw nowe hasło',
  },
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'admin-password-reset',
        heading: 'Set a new password',
        text: [
          'Hi,',
          '',
          'An administrator started a password reset for your account. Click the button below to set a new password.',
          '',
          'If the button does not work, open this link: {{var resetUrl}}',
          '',
          'If you did not expect this message, you can ignore it — your current password stays unchanged.',
        ].join('\n'),
        ctaLabel: 'Set a new password',
        ctaHref: '{{var resetUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'admin-password-reset',
        heading: 'Ustaw nowe hasło',
        text: [
          'Dzień dobry,',
          '',
          'Administrator rozpoczął resetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby ustawić nowe hasło.',
          '',
          'Jeśli przycisk nie działa, otwórz ten link: {{var resetUrl}}',
          '',
          'Jeśli nie spodziewasz się tej wiadomości, zignoruj ją — Twoje obecne hasło pozostaje bez zmian.',
        ].join('\n'),
        ctaLabel: 'Ustaw nowe hasło',
        ctaHref: '{{var resetUrl}}',
      }),
    },
  },
  languages: LANGS,
  nonDeactivatable: {
    reason:
      'Required to regain access to an account — switching it off leaves the customer with no ' +
      'way to set a new password, and no fallback email is sent.',
  },
} satisfies EmailDefaults & { languages: string[] };
