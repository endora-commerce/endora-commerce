import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * `specs/182-related-payers/` US5, US6 (FR-042, FR-044) — the default subjects and bodies of the two
 * e-mails Phase 6 adds, in English and Polish; an operator edits each, per language and per store,
 * on the e-mail templates screen.
 *
 * - `related_payer_invitation_to_register` — to the **contact e-mail** a request named, when its tax
 *   ID has no account (`invite` mode, or the operator's *Send invitation*). Its link is absolute and
 *   carries the token that pre-fills the tax ID on the registration form. Nothing is created from it.
 * - `related_payer_invitation_received` — to a buyer's payer managers when a payer invites the buyer
 *   (US6). The request-received e-mail's counterpart, worded for the other direction.
 */

export const RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE = 'related_payer_invitation_to_register';
export const RELATED_PAYER_INVITATION_RECEIVED_EMAIL_CODE = 'related_payer_invitation_received';

export const RELATED_PAYER_INVITATION_TO_REGISTER_DEFAULT = {
  defaultSubject: {
    'en-US': '{{var sender.name}} invites your company to register',
    'pl-PL': '{{var sender.name}} zaprasza Twoją firmę do rejestracji',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-invitation-to-register',
        heading: 'An invitation to register',
        text: [
          '{{var sender.name}} would like your company (tax ID {{var request.taxId}}) to be its partner in paying for orders in our store.',
          'Register your company with this link; the tax ID is filled in for you: {{var registration.url}}',
          'Once your registration is approved you can accept or reject the request in your account, under Payers.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-invitation-to-register',
        heading: 'Zaproszenie do rejestracji',
        text: [
          '{{var sender.name}} chce, aby Twoja firma (NIP {{var request.taxId}}) była jej partnerem w opłacaniu zamówień w naszym sklepie.',
          'Zarejestruj firmę za pomocą tego linku; NIP zostanie wpisany za Ciebie: {{var registration.url}}',
          'Po zatwierdzeniu rejestracji przyjmiesz lub odrzucisz prośbę na swoim koncie, w sekcji Płatnicy.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};

export const RELATED_PAYER_INVITATION_RECEIVED_DEFAULT = {
  defaultSubject: {
    'en-US': '{{var sender.name}} offers to pay for your orders',
    'pl-PL': '{{var sender.name}} proponuje opłacanie Waszych zamówień',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'related-payer-invitation-received',
        heading: 'An offer to pay for your orders',
        text: [
          '{{var sender.name}} (tax ID {{var sender.taxId}}) offers to pay for and be invoiced for the orders of {{var buyer.name}}.',
          'Sign in to your account and open Payers to accept or reject the invitation.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'related-payer-invitation-received',
        heading: 'Propozycja opłacania zamówień',
        text: [
          '{{var sender.name}} (NIP {{var sender.taxId}}) proponuje, że będzie opłacać zamówienia {{var buyer.name}} i otrzymywać na nie faktury.',
          'Zaloguj się na swoje konto i otwórz Płatników, aby przyjąć lub odrzucić zaproszenie.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: ['en-US', 'pl-PL'],
};
