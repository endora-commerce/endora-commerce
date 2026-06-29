// Default subject + content for organizations transactional emails (feature 047):
// email_verification, organization_invitation, new_org_registration. Reproduces
// the legacy builder text (SC-003) with email-safe components + default blocks.

const LANGS = ['en-US', 'pl-PL'];

function bodyTree(text: string) {
  return {
    root: { props: {} },
    content: [
      { type: 'EmailInsertBlock', props: { id: 'hdr', code: 'default_email_header' } },
      { type: 'EmailText', props: { id: 'body', text, align: 'left' } },
      { type: 'EmailInsertBlock', props: { id: 'ftr', code: 'default_email_footer' } },
    ],
    zones: {},
  };
}

export const EMAIL_VERIFICATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'Verify your email — {{var organizationName}}',
    'pl-PL': 'Zweryfikuj swój adres e-mail — {{var organizationName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        [
          'Welcome to the B2B platform.',
          '',
          'Organization "{{var organizationName}}" was registered.',
          '',
          'Verify your email address by opening this link:',
          '{{var verifyUrl}}',
          '',
          'If you did not register, you can ignore this message.',
        ].join('\n'),
      ),
      'pl-PL': bodyTree(
        [
          'Witamy na platformie B2B.',
          '',
          'Organizacja "{{var organizationName}}" została zarejestrowana.',
          '',
          'Zweryfikuj swój adres e-mail, otwierając ten link:',
          '{{var verifyUrl}}',
          '',
          'Jeśli to nie Ty dokonałeś rejestracji, zignoruj tę wiadomość.',
        ].join('\n'),
      ),
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
      'en-US': bodyTree(
        [
          'Hi,',
          '',
          '{{var inviterName}} invited you to join "{{var organizationName}}" on the B2B platform',
          'as {{var roleLabel}}.',
          '',
          'Accept the invitation here (link expires {{var expiresOn}}):',
          '{{var acceptUrl}}',
          '',
          'If you did not expect this email, you can safely ignore it — the link will',
          'expire on its own and no account will be created.',
        ].join('\n'),
      ),
      'pl-PL': bodyTree(
        [
          'Cześć,',
          '',
          '{{var inviterName}} zaprosił(a) Cię do organizacji "{{var organizationName}}" na platformie B2B',
          'jako {{var roleLabel}}.',
          '',
          'Zaakceptuj zaproszenie tutaj (link wygasa {{var expiresOn}}):',
          '{{var acceptUrl}}',
          '',
          'Jeśli nie spodziewałeś się tej wiadomości, możesz ją zignorować — link',
          'wygaśnie samoczynnie i żadne konto nie zostanie utworzone.',
        ].join('\n'),
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const NEW_ORG_REGISTRATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'Nowa Organizacja: {{var organizationName}}',
    'pl-PL': 'Nowa Organizacja: {{var organizationName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        [
          'Zarejestrowała się nowa Organizacja na platformie B2B.',
          '',
          '  Nazwa:   {{var organizationName}}',
          '  NIP/VAT: {{var taxId}}',
          '  Status:  {{var statusLabel}}',
          '',
          'Otwórz w Panelu Administracyjnym: {{var linkPath}}',
        ].join('\n'),
      ),
      'pl-PL': bodyTree(
        [
          'Zarejestrowała się nowa Organizacja na platformie B2B.',
          '',
          '  Nazwa:   {{var organizationName}}',
          '  NIP/VAT: {{var taxId}}',
          '  Status:  {{var statusLabel}}',
          '',
          'Otwórz w Panelu Administracyjnym: {{var linkPath}}',
        ].join('\n'),
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
