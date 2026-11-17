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
