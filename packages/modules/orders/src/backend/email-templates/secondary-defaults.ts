// Default subject + content for the secondary orders transactional emails
// (feature 047): order_comment, reorder_created, admin_created_order.

import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

const LANGS = ['en-US', 'pl-PL'];

export const ORDER_COMMENT_DEFAULT = {
  defaultSubject: {
    'en-US': 'New comment on your order {{var order.businessId}}',
    'pl-PL': 'Nowy komentarz do zamówienia {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'order-comment',
        heading: 'New order comment',
        text: 'A new comment was added to your order {{var order.businessId}}:\n\n{{var comment.body}}',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'order-comment',
        heading: 'Nowy komentarz',
        text: 'Do Twojego zamówienia {{var order.businessId}} dodano nowy komentarz:\n\n{{var comment.body}}',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const REORDER_CREATED_DEFAULT = {
  defaultSubject: {
    'en-US': 'A new order is waiting for you (reorder of {{var order.sourceBusinessId}})',
    'pl-PL': 'Nowe zamówienie czeka na Ciebie (ponowienie {{var order.sourceBusinessId}})',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'reorder',
        heading: 'Reorder ready',
        text: "We've prepared a new order on your account based on your previous order {{var order.sourceBusinessId}}.\nOpen your orders list to review and pay for it at checkout.",
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'reorder',
        heading: 'Ponowione zamówienie',
        text: 'Przygotowaliśmy nowe zamówienie na Twoim koncie na podstawie poprzedniego zamówienia {{var order.sourceBusinessId}}.\nOtwórz listę zamówień, aby je sprawdzić i opłacić przy kasie.',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const ADMIN_CREATED_ORDER_DEFAULT = {
  defaultSubject: {
    'en-US': 'An order was created for you — {{var order.businessId}}',
    'pl-PL': 'Zamówienie zostało utworzone dla Ciebie — {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'admin-order',
        heading: 'Order created for you',
        text: 'Our team has prepared order {{var order.businessId}} on your account.\nOpen your orders list to review and pay for it at checkout.',
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'admin-order',
        heading: 'Zamówienie utworzone dla Ciebie',
        text: 'Nasz zespół przygotował zamówienie {{var order.businessId}} na Twoim koncie.\nOtwórz listę zamówień, aby je sprawdzić i opłacić przy kasie.',
      }),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
