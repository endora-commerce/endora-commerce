// Default subject + content for the returns transactional emails (feature 047).

import { simpleEmailBodyTree } from '@b2b/email-components/defaults/simple-email-body';

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
