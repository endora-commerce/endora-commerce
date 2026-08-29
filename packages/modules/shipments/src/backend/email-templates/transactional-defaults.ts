// Default subject + content for the shipment_created transactional email
// (feature 047). Simple layout via shared header/footer embeds.

import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

export const SHIPMENT_CREATED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your order {{var order.businessId}} has shipped',
    'pl-PL': 'Twoje zamówienie {{var order.businessId}} zostało wysłane',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'shipment',
        heading: 'Your order has shipped',
        text: 'Good news — a shipment has been created for your order {{var order.businessId}}. You will receive tracking details soon.',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'shipment',
        heading: 'Zamówienie wysłane',
        text: 'Dobra wiadomość — utworzono przesyłkę dla Twojego zamówienia {{var order.businessId}}. Wkrótce otrzymasz dane do śledzenia.',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
