/**
 * Default content for the `invoice_issued` transactional email (feature 047).
 * Simple layout: header → heading → details → download CTA → footer.
 */

import { simpleEmailBodyTree } from '@b2b/email-components/defaults/simple-email-body';

const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

export const INVOICE_ISSUED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Invoice {{var invoice.number}}',
    'pl-PL': 'Faktura {{var invoice.number}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'invoice',
        heading: 'Your invoice',
        text: [
          'Your invoice has been issued.',
          '',
          'Invoice number: {{var invoice.number}}',
          'Order: {{var order.businessId}}',
          'Total: {{var invoice.total}} {{var invoice.currency}}',
        ].join('\n'),
        ctaLabel: 'Download invoice',
        ctaHref: '{{var invoice.downloadUrl}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'invoice',
        heading: 'Twoja faktura',
        text: [
          'Twoja faktura została wystawiona.',
          '',
          'Numer faktury: {{var invoice.number}}',
          'Zamówienie: {{var order.businessId}}',
          'Razem: {{var invoice.total}} {{var invoice.currency}}',
        ].join('\n'),
        ctaLabel: 'Pobierz fakturę',
        ctaHref: '{{var invoice.downloadUrl}}',
      }),
    },
  } as Record<string, unknown>,
  languages: DEFAULT_LANGUAGES,
};
