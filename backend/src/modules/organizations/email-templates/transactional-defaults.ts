// Default subject + content for organizations transactional emails (feature 047):
// email_verification, organization_invitation, new_org_registration.
// Simple layout via shared header/footer embeds + heading / text / CTA.

import { simpleEmailBodyTree } from '@b2b/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

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
