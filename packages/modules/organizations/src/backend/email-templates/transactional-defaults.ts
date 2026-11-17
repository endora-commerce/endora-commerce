// Default subject + content for organizations transactional emails (feature 047):
// email_verification, organization_invitation, customer_password_reset,
// new_org_registration, organization_approved, organization_rejected.
// Simple layout via shared header/footer embeds + heading / text / CTA.

import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

/**
 * Three of this module's emails may never be switched off (issue #89; the
 * password reset since issue #1371).
 *
 * The criterion is "required to get into an account", and the reason it bites
 * is `TemplateEmail.trySend`: a deactivated email answers `true`, meaning
 * *handled*, so the caller deliberately skips its legacy in-code builder. An
 * operator who switched `email_verification` off would therefore not degrade
 * registration — they would break it, silently, and the person who could not
 * verify has no way to tell anybody.
 *
 * `new_org_registration` is **not** here: it notifies administrators that
 * somebody registered, and an operator who does not want that notice is making
 * an ordinary business choice with no locked-out customer at the other end.
 */
const REQUIRED_FOR_ACCOUNT_ACCESS = {
  reason:
    'Required to create or regain access to an account — switching it off leaves the ' +
    'recipient with no way to complete the flow, and no fallback email is sent.',
} as const;

export const EMAIL_VERIFICATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'Verify your email — {{var organizationName}}',
    'pl-PL': 'Zweryfikuj swój adres e-mail — {{var organizationName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'verify',
        heading: 'Verify your email',
        text: [
          'Welcome to the B2B platform.',
          '',
          'Organization "{{var organizationName}}" was registered.',
          '',
          'Click the button below to verify your email address.',
          '',
          'If you did not register, you can ignore this message.',
        ].join('\n'),
        ctaLabel: 'Verify email',
        ctaHref: '{{var verifyUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'verify',
        heading: 'Zweryfikuj swój e-mail',
        text: [
          'Witamy na platformie B2B.',
          '',
          'Organizacja "{{var organizationName}}" została zarejestrowana.',
          '',
          'Kliknij przycisk poniżej, aby zweryfikować swój adres e-mail.',
          '',
          'Jeśli to nie Ty dokonałeś rejestracji, zignoruj tę wiadomość.',
        ].join('\n'),
        ctaLabel: 'Zweryfikuj e-mail',
        ctaHref: '{{var verifyUrl}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
  nonDeactivatable: REQUIRED_FOR_ACCOUNT_ACCESS,
};

export const ORGANIZATION_INVITATION_DEFAULT = {
  defaultSubject: {
    'en-US': "You're invited to join {{var organizationName}}",
    'pl-PL': 'Zaproszenie do organizacji {{var organizationName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'invite',
        heading: "You're invited",
        text: [
          'Hi,',
          '',
          '{{var inviterName}} invited you to join "{{var organizationName}}" on the B2B platform as {{var roleLabel}}.',
          '',
          'The invitation link expires {{var expiresOn}}.',
          '',
          'If you did not expect this email, you can safely ignore it.',
        ].join('\n'),
        ctaLabel: 'Accept invitation',
        ctaHref: '{{var acceptUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'invite',
        heading: 'Zaproszenie',
        text: [
          'Cześć,',
          '',
          '{{var inviterName}} zaprosił(a) Cię do organizacji "{{var organizationName}}" na platformie B2B jako {{var roleLabel}}.',
          '',
          'Link wygasa {{var expiresOn}}.',
          '',
          'Jeśli nie spodziewałeś się tej wiadomości, możesz ją zignorować.',
        ].join('\n'),
        ctaLabel: 'Zaakceptuj zaproszenie',
        ctaHref: '{{var acceptUrl}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
  nonDeactivatable: REQUIRED_FOR_ACCOUNT_ACCESS,
};

/**
 * The e-mail a customer asks for on the storefront's *Forgot password* page
 * (issue #1371). The route minted a token and mailed nothing, so a customer who
 * forgot the password could not get back into the account.
 *
 * `nonDeactivatable` on the criterion above: it is how the customer regains
 * access, and a deactivated e-mail answers `trySend` with *handled*, so no
 * fallback would go out either.
 *
 * The link is also written into the body copy, so the plain-text part carries
 * it and a client that does not render the button still reaches the page.
 */
export const PASSWORD_RESET_DEFAULT = {
  defaultSubject: {
    'en-US': 'Reset your password',
    'pl-PL': 'Zresetuj hasło',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'password-reset',
        heading: 'Reset your password',
        text: [
          'Hi,',
          '',
          'We received a request to reset the password of your account. Click the button below to set a new password.',
          '',
          'If the button does not work, open this link: {{var resetUrl}}',
          '',
          'If you did not ask for this, you can ignore this message — your current password stays unchanged.',
        ].join('\n'),
        ctaLabel: 'Set a new password',
        ctaHref: '{{var resetUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'password-reset',
        heading: 'Zresetuj hasło',
        text: [
          'Dzień dobry,',
          '',
          'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby ustawić nowe hasło.',
          '',
          'Jeśli przycisk nie działa, otwórz ten link: {{var resetUrl}}',
          '',
          'Jeśli to nie Ty o to prosiłeś, zignoruj tę wiadomość — Twoje obecne hasło pozostaje bez zmian.',
        ].join('\n'),
        ctaLabel: 'Ustaw nowe hasło',
        ctaHref: '{{var resetUrl}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
  nonDeactivatable: REQUIRED_FOR_ACCOUNT_ACCESS,
};

export const NEW_ORG_REGISTRATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'New organization: {{var organizationName}}',
    'pl-PL': 'Nowa organizacja: {{var organizationName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'new-org',
        heading: 'New organization registered',
        text: [
          'A new organization registered on the B2B platform.',
          '',
          '  Name:    {{var organizationName}}',
          '  Tax ID:  {{var taxId}}',
          '  Status:  {{var statusLabel}}',
          '',
          'Open in Admin: {{var linkPath}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'new-org',
        heading: 'Nowa organizacja',
        text: [
          'Zarejestrowała się nowa organizacja na platformie B2B.',
          '',
          '  Nazwa:   {{var organizationName}}',
          '  NIP/VAT: {{var taxId}}',
          '  Status:  {{var statusLabel}}',
          '',
          'Otwórz w Panelu Administracyjnym: {{var linkPath}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

/**
 * The two messages a moderated organisation's administrator receives
 * (`specs/093-backend-delivered-prose/` § Out of scope — the seam-B carve-out).
 *
 * They were finished Polish sentences composed inside
 * `OrganizationModerationService` and handed straight to the transport: no
 * code, no template, no language. A buyer on an English sales channel received
 * Polish unconditionally, and unlike an operator a buyer has no admin panel to
 * go and check the facts in.
 *
 * English is the primary copy and `en-US` is first in {@link LANGS}, which is
 * what `TransactionalEmailService` passes as the content resolver's
 * `fallbackLanguage` — so a language with no content, and a language that could
 * not be resolved at all, both read English (owner ruling, 2026-09-01). The
 * Polish here is the copy these two e-mails already shipped, moved rather than
 * retranslated.
 *
 * Neither is `nonDeactivatable`. The criterion the two above it meet is
 * "required to create or regain access to an account"; a status notice is not
 * that — the organisation's administrator can sign in and read the same status
 * on their own screen — so switching it off stays an ordinary business choice.
 */
export const ORGANIZATION_APPROVED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your organization has been verified',
    'pl-PL': 'Twoja Organizacja została zweryfikowana',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'org-approved',
        heading: 'Your organization has been verified',
        text: [
          'Hi,',
          '',
          'Organization "{{var organizationName}}" has been verified successfully and can now place Orders and Requests for Quotation.',
          '',
          'Thank you.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'org-approved',
        heading: 'Twoja Organizacja została zweryfikowana',
        text: [
          'Witaj,',
          '',
          'Organizacja "{{var organizationName}}" została pomyślnie zweryfikowana i może teraz składać Zamówienia oraz Zapytania Ofertowe.',
          '',
          'Dziękujemy.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const ORGANIZATION_REJECTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Organization registration rejected',
    'pl-PL': 'Rejestracja Organizacji odrzucona',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'org-rejected',
        heading: 'Organization registration rejected',
        text: [
          'Hi,',
          '',
          'Unfortunately, the registration of organization "{{var organizationName}}" was rejected for the following reason:',
          '',
          '{{var reason}}',
          '',
          'If you have any questions, please contact the platform administrators.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'org-rejected',
        heading: 'Rejestracja Organizacji odrzucona',
        text: [
          'Witaj,',
          '',
          'Niestety, rejestracja Organizacji "{{var organizationName}}" została odrzucona z następującego powodu:',
          '',
          '{{var reason}}',
          '',
          'W razie pytań prosimy o kontakt z administracją platformy.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
