// Default subject + content for the payment_status_changed transactional email
// (feature 047). Simple layout via shared header/footer embeds.

import { simpleEmailBodyTree } from '@b2b/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

export const PAYMENT_STATUS_CHANGED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Payment update for order {{var order.businessId}}',
    'pl-PL': 'Aktualizacja płatności dla zamówienia {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'payment',
        heading: 'Payment update',
        text: 'The payment status for your order {{var order.businessId}} is now: {{var payment.statusLabel}}.\n{{if payment.failureReason}}Reason: {{var payment.failureReason}}{{/if}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'payment',
        heading: 'Aktualizacja płatności',
        text: 'Status płatności dla Twojego zamówienia {{var order.businessId}} to teraz: {{var payment.statusLabel}}.\n{{if payment.failureReason}}Powód: {{var payment.failureReason}}{{/if}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
