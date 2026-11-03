import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the three cart-approval e-mails (issue
 * #651), in English and Polish. An operator edits either, per language and
 * per store, on the e-mail templates screen — or switches one off, which
 * costs nobody the approval it announces.
 *
 * **There is no link.** A link in an e-mail has to be absolute, and the
 * storefront page an Organization administrator approves from is not a
 * path this module owns; the message names the buyer and the Organization,
 * and the reader opens their account to act, as the `crm` reminder does.
 */

export const CART_APPROVAL_REQUESTED_EMAIL_CODE = 'cart_approval_requested';
export const CART_APPROVED_EMAIL_CODE = 'cart_approved';
export const CART_REJECTED_EMAIL_CODE = 'cart_rejected';

const LANGUAGES = ['en-US', 'pl-PL'];

export const CART_APPROVAL_REQUESTED_DEFAULT = {
  defaultSubject: {
    'en-US': '{{var buyer.name}} sent a cart for your approval',
    'pl-PL': '{{var buyer.name}} przekazuje koszyk do Twojej akceptacji',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'cart-approval-requested',
        heading: 'A cart is waiting for your approval',
        text: [
          '{{var buyer.name}} ({{var buyer.email}}) has sent a cart of {{var organization.name}} for approval.',
          'Sign in to your account and open the organization’s carts to approve or reject it. The cart cannot be ordered until it is approved.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'cart-approval-requested',
        heading: 'Koszyk czeka na Twoją akceptację',
        text: [
          '{{var buyer.name}} ({{var buyer.email}}) przekazuje do akceptacji koszyk organizacji {{var organization.name}}.',
          'Zaloguj się na swoje konto i otwórz koszyki organizacji, aby go zaakceptować lub odrzucić. Do czasu akceptacji z koszyka nie można złożyć zamówienia.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGUAGES,
};

export const CART_APPROVED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your cart was approved',
    'pl-PL': 'Twój koszyk został zaakceptowany',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'cart-approved',
        heading: 'Cart approved',
        text: [
          '{{var approver.name}} has approved your cart for {{var organization.name}}.',
          'You can now place the order from your cart. If you change the cart, it has to be approved again.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'cart-approved',
        heading: 'Koszyk zaakceptowany',
        text: [
          '{{var approver.name}} akceptuje Twój koszyk w organizacji {{var organization.name}}.',
          'Możesz teraz złożyć zamówienie z koszyka. Jeśli zmienisz koszyk, trzeba go będzie zaakceptować ponownie.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGUAGES,
};

export const CART_REJECTED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your cart was rejected',
    'pl-PL': 'Twój koszyk został odrzucony',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'cart-rejected',
        heading: 'Cart rejected',
        text: [
          '{{var rejector.name}} has rejected your cart for {{var organization.name}}.',
          '{{if reason}}Reason: {{var reason}}{{/if}}',
          'The cart cannot be ordered. Ask your organization administrator if you have questions.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'cart-rejected',
        heading: 'Koszyk odrzucony',
        text: [
          '{{var rejector.name}} odrzuca Twój koszyk w organizacji {{var organization.name}}.',
          '{{if reason}}Powód: {{var reason}}{{/if}}',
          'Z tego koszyka nie można złożyć zamówienia. W razie pytań skontaktuj się z administratorem organizacji.',
        ].join('\n'),
      }),
    },
  } as Record<string, unknown>,
  languages: LANGUAGES,
};
