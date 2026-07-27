// Default subject + content for inventory transactional emails (feature 047):
// low_stock_alert (ops) + availability_back_in_stock (customer).

import { simpleEmailBodyTree } from '@b2b/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

export const LOW_STOCK_ALERT_DEFAULT = {
  defaultSubject: {
    'en-US': 'Low stock: {{var product.name}}',
    'pl-PL': 'Niski stan magazynowy: {{var product.name}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'low-stock',
        heading: 'Low stock alert',
        text: 'Cumulative on-hand for "{{var product.name}}" (SKU {{var product.sku}}) has crossed the low-stock threshold.\n\n  Current cumulative on-hand: {{var cumulativeOnHand}}\n  Threshold: {{var threshold}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'low-stock',
        heading: 'Alert niskiego stanu',
        text: 'Łączny stan magazynowy dla "{{var product.name}}" (SKU {{var product.sku}}) spadł poniżej progu niskiego stanu.\n\n  Bieżący łączny stan: {{var cumulativeOnHand}}\n  Próg: {{var threshold}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const AVAILABILITY_BACK_IN_STOCK_DEFAULT = {
  defaultSubject: {
    'en-US': 'Back in stock: {{var product.name}}',
    'pl-PL': 'Ponownie dostępny: {{var product.name}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'back-in-stock',
        heading: 'Back in stock',
        text: 'Good news — "{{var product.name}}" is available again.',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'back-in-stock',
        heading: 'Ponownie dostępny',
        text: 'Dobra wiadomość — "{{var product.name}}" jest ponownie dostępny.',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
