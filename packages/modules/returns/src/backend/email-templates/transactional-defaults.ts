// Default subject + content for the returns transactional emails (feature 047).

import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

export const RETURN_AUTHORIZED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your return was approved — RMA {{var rmaNumber}}',
    'pl-PL': 'Twój zwrot został zaakceptowany — RMA {{var rmaNumber}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-ok',
        heading: 'Return approved',
        text: [
          'Your return request has been approved. Your RMA number is {{var rmaNumber}}.',
          'Please write this RMA number on the package or the return label before sending the goods back.',
          'You can track the case from your account under Returns.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-ok',
        heading: 'Zwrot zaakceptowany',
        text: [
          'Twój wniosek o zwrot został zaakceptowany. Numer RMA to {{var rmaNumber}}.',
          'Umieść ten numer RMA na paczce lub etykiecie zwrotnej przed odesłaniem towaru.',
          'Status sprawy możesz śledzić w swoim koncie w sekcji Zwroty.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_REJECTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your return request was declined',
    'pl-PL': 'Twój wniosek o zwrot został odrzucony',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-no',
        heading: 'Return declined',
        text: [
          'We have reviewed your return request and are unable to accept it.',
          '{{if reason}}Reason: {{var reason}}{{/if}}',
          'If you have questions, you can reply on the case from your account under Returns.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-no',
        heading: 'Zwrot odrzucony',
        text: [
          'Rozpatrzyliśmy Twój wniosek o zwrot i nie możemy go zaakceptować.',
          '{{if reason}}Powód: {{var reason}}{{/if}}',
          'W razie pytań możesz odpowiedzieć w sprawie ze swojego konta w sekcji Zwroty.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

// ---------------------------------------------------------------------------
// `specs/180-off-platform-complaints/` phase A — the four notification e-mails
// (contracts/settings-emails-events.md §2, research R-5). Every subject names
// `{{var caseReference}}` (FR-A44); none promises a processing time.
// ---------------------------------------------------------------------------

export const RETURN_NEW_CASE_DEFAULT = {
  defaultSubject: {
    'en-US': 'New {{var kindLabel}} {{var caseReference}}',
    'pl-PL': 'Nowe zgłoszenie: {{var kindLabel}} {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-new-case',
        heading: 'New {{var kindLabel}} {{var caseReference}}',
        text: [
          'A customer filed a case on {{var submittedAt}}.',
          'Customer: {{var customerName}}',
          'Organization: {{var organizationName}}',
          'Products: {{var productList}}',
          '{{if offPlatform}}The goods were not bought on this platform.{{/if}}',
          '{{if adminCaseUrl}}Open the case: {{var adminCaseUrl}}{{/if}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-new-case',
        heading: 'Nowe zgłoszenie: {{var kindLabel}} {{var caseReference}}',
        text: [
          'Klient złożył zgłoszenie {{var submittedAt}}.',
          'Klient: {{var customerName}}',
          'Organizacja: {{var organizationName}}',
          'Produkty: {{var productList}}',
          '{{if offPlatform}}Towar nie został kupiony na tej platformie.{{/if}}',
          '{{if adminCaseUrl}}Otwórz zgłoszenie: {{var adminCaseUrl}}{{/if}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_SUBMITTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'We received your {{var kindLabel}} {{var caseReference}}',
    'pl-PL': 'Otrzymaliśmy Twoje zgłoszenie: {{var kindLabel}} {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-submitted',
        heading: 'We received your {{var kindLabel}}',
        text: [
          'Thank you. We received your {{var kindLabel}} {{var caseReference}} on {{var submittedAt}}.',
          'Products: {{var productList}}',
          'We will let you know as soon as we have reviewed it.',
          '{{if caseUrl}}You can follow the case in your account: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-submitted',
        heading: 'Otrzymaliśmy Twoje zgłoszenie',
        text: [
          'Dziękujemy. Otrzymaliśmy Twoje zgłoszenie ({{var kindLabel}}) {{var caseReference}} z dnia {{var submittedAt}}.',
          'Produkty: {{var productList}}',
          'Poinformujemy Cię, gdy je rozpatrzymy.',
          '{{if caseUrl}}Status zgłoszenia możesz śledzić w swoim koncie: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_COMMENT_ADDED_DEFAULT = {
  defaultSubject: {
    'en-US': 'A message about your case {{var caseReference}}',
    'pl-PL': 'Wiadomość w sprawie zgłoszenia {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-comment',
        heading: 'A message about your case {{var caseReference}}',
        text: [
          '{{var commentBody}}',
          '{{if caseUrl}}You can reply on the case in your account: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-comment',
        heading: 'Wiadomość w sprawie zgłoszenia {{var caseReference}}',
        text: [
          '{{var commentBody}}',
          '{{if caseUrl}}Możesz odpowiedzieć w zgłoszeniu w swoim koncie: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_STATUS_ENTERED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your case {{var caseReference}}: {{var statusName}}',
    'pl-PL': 'Twoje zgłoszenie {{var caseReference}}: {{var statusName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-status',
        heading: 'Your case {{var caseReference}} has a new status',
        text: [
          'The status of your case {{var caseReference}} is now: {{var statusName}}.',
          '{{if caseUrl}}See the details in your account: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-status',
        heading: 'Zmiana statusu zgłoszenia {{var caseReference}}',
        text: [
          'Twoje zgłoszenie {{var caseReference}} ma teraz status: {{var statusName}}.',
          '{{if caseUrl}}Szczegóły znajdziesz w swoim koncie: {{var caseUrl}}{{/if}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

// ---------------------------------------------------------------------------
// `specs/181-guest-complaints/` — complaints from guests without an account
// (contracts/settings-emails-events.md §2, research R-7). Sent in the sales
// channel's language; no default promises a processing time.
// ---------------------------------------------------------------------------

/**
 * The one-time link that starts a guest's complaint (FR-020, FR-025). It cannot be
 * switched off: it is the only way a guest can start one. The account sentence is
 * filled by the worker only for an address that belongs to an account.
 */
export const RETURN_GUEST_VERIFICATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'Confirm your e-mail address to file a complaint',
    'pl-PL': 'Potwierdź adres e-mail, aby złożyć reklamację',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-verify',
        heading: 'Confirm your e-mail address',
        text: [
          'To file a complaint about goods you bought elsewhere, open this link and choose Continue: {{var verifyUrl}}',
          'The link works once and for {{var linkValidMinutes}} minutes.',
          '{{if hasAccount}}This address belongs to a customer account. If you sign in first, the complaint will appear in your account: {{var signInUrl}}{{/if}}',
          'If you did not ask for this, you can ignore this e-mail.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-verify',
        heading: 'Potwierdź adres e-mail',
        text: [
          'Aby złożyć reklamację towaru kupionego gdzie indziej, otwórz ten link i wybierz Dalej: {{var verifyUrl}}',
          'Link działa jeden raz i przez {{var linkValidMinutes}} minut.',
          '{{if hasAccount}}Ten adres należy do konta klienta. Jeśli najpierw się zalogujesz, reklamacja pojawi się w Twoim koncie: {{var signInUrl}}{{/if}}',
          'Jeśli to nie Ty, zignoruj tę wiadomość.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
  nonDeactivatable: { reason: 'The only way a guest can start a complaint.' },
};

// The guest twins of the account e-mails (research R-7). Each carries the private
// tracking link where the account e-mail sends the customer to their account; none
// promises a processing time.

/**
 * The guest's confirmation (FR-036, FR-045). It cannot be switched off: the link it
 * carries is the guest's only lasting way back to the case.
 */
export const RETURN_GUEST_SUBMITTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'We received your complaint {{var caseReference}}',
    'pl-PL': 'Otrzymaliśmy Twoją reklamację {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-submitted',
        heading: 'We received your complaint',
        text: [
          'Thank you. We received your complaint {{var caseReference}} on {{var submittedAt}}.',
          'Products: {{var productList}}',
          'We will let you know as soon as we have reviewed it.',
          'Follow the case and reply to us with this private link. Keep it: anyone who has it can see the case. {{var trackingUrl}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-submitted',
        heading: 'Otrzymaliśmy Twoją reklamację',
        text: [
          'Dziękujemy. Otrzymaliśmy Twoją reklamację {{var caseReference}} z dnia {{var submittedAt}}.',
          'Produkty: {{var productList}}',
          'Poinformujemy Cię, gdy ją rozpatrzymy.',
          'Status reklamacji sprawdzisz i odpowiesz nam przez ten prywatny link. Zachowaj go: każdy, kto go ma, widzi zgłoszenie. {{var trackingUrl}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
  nonDeactivatable: { reason: "The guest's only lasting way back to the case." },
};

export const RETURN_GUEST_COMMENT_ADDED_DEFAULT = {
  defaultSubject: {
    'en-US': 'A message about your complaint {{var caseReference}}',
    'pl-PL': 'Wiadomość w sprawie reklamacji {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-comment',
        heading: 'A message about your complaint {{var caseReference}}',
        text: ['{{var commentBody}}', 'You can reply with your private link: {{var trackingUrl}}'].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-comment',
        heading: 'Wiadomość w sprawie reklamacji {{var caseReference}}',
        text: ['{{var commentBody}}', 'Możesz odpowiedzieć przez swój prywatny link: {{var trackingUrl}}'].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_GUEST_STATUS_ENTERED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your complaint {{var caseReference}}: {{var statusName}}',
    'pl-PL': 'Twoja reklamacja {{var caseReference}}: {{var statusName}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-status',
        heading: 'Your complaint {{var caseReference}} has a new status',
        text: [
          'The status of your complaint {{var caseReference}} is now: {{var statusName}}.',
          'See the details with your private link: {{var trackingUrl}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-status',
        heading: 'Zmiana statusu reklamacji {{var caseReference}}',
        text: [
          'Twoja reklamacja {{var caseReference}} ma teraz status: {{var statusName}}.',
          'Szczegóły zobaczysz przez swój prywatny link: {{var trackingUrl}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_GUEST_AUTHORIZED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your complaint was approved — RMA {{var rmaNumber}}',
    'pl-PL': 'Twoja reklamacja została zaakceptowana — RMA {{var rmaNumber}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-ok',
        heading: 'Complaint approved',
        text: [
          'Your complaint has been approved. Your RMA number is {{var rmaNumber}}.',
          'Please write this RMA number on the package before sending the goods back.',
          'Follow the case with your private link: {{var trackingUrl}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-ok',
        heading: 'Reklamacja zaakceptowana',
        text: [
          'Twoja reklamacja została zaakceptowana. Numer RMA to {{var rmaNumber}}.',
          'Umieść ten numer RMA na paczce przed odesłaniem towaru.',
          'Status reklamacji sprawdzisz przez swój prywatny link: {{var trackingUrl}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const RETURN_GUEST_REJECTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your complaint {{var caseReference}} was declined',
    'pl-PL': 'Twoja reklamacja {{var caseReference}} została odrzucona',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-no',
        heading: 'Complaint declined',
        text: [
          'We have reviewed your complaint {{var caseReference}} and are unable to accept it.',
          '{{if rejectionReason}}Reason: {{var rejectionReason}}{{/if}}',
          'If you have questions, you can reply with your private link: {{var trackingUrl}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-no',
        heading: 'Reklamacja odrzucona',
        text: [
          'Rozpatrzyliśmy Twoją reklamację {{var caseReference}} i nie możemy jej uznać.',
          '{{if rejectionReason}}Powód: {{var rejectionReason}}{{/if}}',
          'W razie pytań możesz odpowiedzieć przez swój prywatny link: {{var trackingUrl}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

/** A replaced link (FR-046): the earlier one no longer works. */
export const RETURN_GUEST_LINK_REISSUED_DEFAULT = {
  defaultSubject: {
    'en-US': 'A new link to your complaint {{var caseReference}}',
    'pl-PL': 'Nowy link do Twojej reklamacji {{var caseReference}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'return-guest-link',
        heading: 'A new link to your complaint',
        text: [
          'Here is a new private link to your complaint {{var caseReference}}. The earlier link no longer works.',
          '{{var trackingUrl}}',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'return-guest-link',
        heading: 'Nowy link do Twojej reklamacji',
        text: [
          'Oto nowy prywatny link do Twojej reklamacji {{var caseReference}}. Poprzedni link już nie działa.',
          '{{var trackingUrl}}',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
