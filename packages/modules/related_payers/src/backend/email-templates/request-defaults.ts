import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * `specs/182-related-payers/` T081 (FR-042, FR-045, FR-050, research R-10) — the default subjects
 * and bodies of the three e-mails of requests and revocations, in English and Polish. An operator
 * edits each, per language and per store, on the e-mail templates screen, or switches it off.
 *
 * **There is no link** (the payer-order e-mails' precedent): a link in an e-mail has to be
 * absolute, and the reader opens *Payers* in their account. The decision e-mail names no outcome:
 * the sender reads it, with any rejection reason, on that screen, so no variable has to carry a
 * word that would need translating.
 */

export const RELATED_PAYER_REQUEST_RECEIVED_EMAIL_CODE = 'related_payer_request_received';
export const RELATED_PAYER_REQUEST_DECIDED_EMAIL_CODE = 'related_payer_request_decided';
export const RELATED_PAYER_LINK_REVOKED_EMAIL_CODE = 'related_payer_link_revoked';
export const RELATED_PAYER_REQUEST_EXPIRED_EMAIL_CODE = 'related_payer_request_expired';

export const RELATED_PAYER_REQUEST_RECEIVED_DEFAULT = {
  defaultSubject: {
    'en-US': '{{var sender.name}} asks you to pay for its orders',
    'pl-PL': '{{var sender.name}} prosi o opłacanie jej zamówień',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-received',
        heading: 'A request to become a payer',
        text: [
          '{{var sender.name}} (tax ID {{var sender.taxId}}) asks {{var payer.name}} to pay for and be invoiced for its orders.',
          'Sign in to your account and open Payers to accept or reject the request.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-received',
        heading: 'Prośba o zostanie płatnikiem',
        text: [
          '{{var sender.name}} (NIP {{var sender.taxId}}) prosi, aby {{var payer.name}} opłacała jej zamówienia i otrzymywała na nie faktury.',
          'Zaloguj się na swoje konto i otwórz Płatników, aby przyjąć lub odrzucić prośbę.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};

export const RELATED_PAYER_REQUEST_DECIDED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your payer request for tax ID {{var request.taxId}} has been decided',
    'pl-PL': 'Twoja prośba o płatnika z NIP {{var request.taxId}} została rozpatrzona',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-decided',
        heading: 'Your payer request has been decided',
        text: [
          'The request {{var buyer.name}} sent for the payer with tax ID {{var request.taxId}} has been decided.',
          'Sign in to your account and open Payers to see the outcome.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-decided',
        heading: 'Prośba o płatnika została rozpatrzona',
        text: [
          'Prośba, którą {{var buyer.name}} wysłała do płatnika z NIP {{var request.taxId}}, została rozpatrzona.',
          'Zaloguj się na swoje konto i otwórz Płatników, aby zobaczyć decyzję.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};

/** RP-20 (c) — to the requester only, when a request expires undecided. */
export const RELATED_PAYER_REQUEST_EXPIRED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your payer request for tax ID {{var request.taxId}} has expired',
    'pl-PL': 'Twoja prośba o płatnika z NIP {{var request.taxId}} wygasła',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-expired',
        heading: 'Your payer request has expired',
        text: [
          'The request {{var buyer.name}} sent naming tax ID {{var request.taxId}} was not decided in time and has expired.',
          'Sign in to your account and open Payers to send a new one.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-request-expired',
        heading: 'Prośba o płatnika wygasła',
        text: [
          'Prośba, którą {{var buyer.name}} wysłała, wskazując NIP {{var request.taxId}}, nie została rozpatrzona na czas i wygasła.',
          'Zaloguj się na swoje konto i otwórz Płatników, aby wysłać nową.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};

export const RELATED_PAYER_LINK_REVOKED_DEFAULT = {
  defaultSubject: {
    'en-US': '{{var payer.name}} no longer pays for orders of {{var buyer.name}}',
    'pl-PL': '{{var payer.name}} nie opłaca już zamówień {{var buyer.name}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-link-revoked',
        heading: 'A payer link was revoked',
        text: [
          'The link under which {{var payer.name}} pays for orders of {{var buyer.name}} has been revoked.',
          'New orders can no longer name this payer. Orders placed before keep their payer and invoices.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-link-revoked',
        heading: 'Powiązanie z płatnikiem zostało odwołane',
        text: [
          'Powiązanie, w ramach którego {{var payer.name}} opłaca zamówienia {{var buyer.name}}, zostało odwołane.',
          'Nowe zamówienia nie mogą już wskazywać tego płatnika. Zamówienia złożone wcześniej zachowują płatnika i faktury.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};
