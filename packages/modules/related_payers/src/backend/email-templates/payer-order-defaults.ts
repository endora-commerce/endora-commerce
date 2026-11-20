import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * `specs/182-related-payers/` FR-074 — the default subjects and bodies of the two e-mails a
 * payer's people receive (RP-17 b): an order billed to them placed, and one cancelled, in English
 * and Polish. An operator
 * edits either, per language and per store, on the e-mail templates screen, or switches it off.
 *
 * **There is no link**, as in the cart-approval e-mails: a link in an e-mail has to be
 * absolute, and the reader opens *Orders we pay for* in their account.
 */

export const RELATED_PAYER_ORDER_PLACED_EMAIL_CODE = 'related_payer_order_placed';
export const RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE = 'related_payer_order_cancelled';

export const RELATED_PAYER_ORDER_PLACED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Order {{var order.number}} placed by {{var buyer.name}} is billed to you',
    'pl-PL': 'Zamówienie {{var order.number}} złożone przez {{var buyer.name}} jest rozliczane na Was',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-order-placed',
        heading: 'An order billed to you was placed',
        text: [
          '{{var buyer.name}} has placed order {{var order.number}} for {{var order.total}}, to be paid and invoiced by {{var payer.name}}.',
          'Sign in to your account and open Orders we pay for to see the order and, once issued, its invoice.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-order-placed',
        heading: 'Złożono zamówienie rozliczane na Was',
        text: [
          '{{var buyer.name}} składa zamówienie {{var order.number}} na kwotę {{var order.total}}, które opłaca i na które otrzymuje fakturę {{var payer.name}}.',
          'Zaloguj się na swoje konto i otwórz Zamówienia, za które płacimy, aby zobaczyć zamówienie, a po wystawieniu także fakturę.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};

export const RELATED_PAYER_ORDER_CANCELLED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Order {{var order.number}} billed to you was cancelled',
    'pl-PL': 'Zamówienie {{var order.number}} rozliczane na Was zostało anulowane',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-order-cancelled',
        heading: 'An order billed to you was cancelled',
        text: [
          'Order {{var order.number}} placed by {{var buyer.name}} for {{var order.total}}, to be paid by {{var payer.name}}, has been cancelled.',
          'Sign in to your account and open Orders we pay for to see the order.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-order-cancelled',
        heading: 'Zamówienie rozliczane na Was zostało anulowane',
        text: [
          'Zamówienie {{var order.number}} złożone przez {{var buyer.name}} na kwotę {{var order.total}}, opłacane przez {{var payer.name}}, zostało anulowane.',
          'Zaloguj się na swoje konto i otwórz Zamówienia, za które płacimy, aby zobaczyć zamówienie.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};
