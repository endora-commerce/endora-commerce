import type { EmailDefaults } from '@endora-commerce/contracts';
import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the eleven quote request notification
 * e-mails (`specs/179-rfq-and-customer-notifications/` FR-020,
 * `contracts/notification-matrix.md` §3), in the two languages the platform
 * ships. Pushed into `emailDefaultsPort` from the module's boot hook; an
 * operator edits either language, per channel, or switches an e-mail off — a
 * switched-off e-mail closes its delivery record `skipped_deactivated` and
 * costs nobody their bell entry.
 *
 * **Customer e-mails** are written in the request's channel language and
 * carry a button to the request on that channel's storefront. Where the
 * channel has no storefront address `quote.url` is empty and the button is
 * dropped (`@endora-commerce/email-components` drops a button whose address is
 * one empty variable); the text names the request's number either way. The
 * approval e-mail carries no PDF (owner ruling Q2): *Send PDF to customer*
 * stays the operator's own action.
 *
 * **Operator e-mails** are written in the administrator's preferred language
 * and carry a button to the request's admin screen, `quote.adminUrl`, built on
 * the platform's `ADMIN_BASE_URL` (spec 179 OQ-1, issue #1204). Where the
 * admin's address is not configured the variable is not sent and the button is
 * dropped, as the customer button is; the text still says where to open the
 * request. An operator's own template that does not name the variable renders
 * as before. `customer.name` is the recipient — here the administrator.
 *
 * None is locked on: every one of them is a courtesy, and the bell, the
 * request's History and the storefront each still say what happened.
 */

type Language = 'en-US' | 'pl-PL';

interface Copy {
  subject: string;
  heading: string;
  lines: string[];
  cta?: string;
}

const CUSTOMER_GREETING: Record<Language, string> = {
  'en-US': 'Hello {{var customer.name}},',
  'pl-PL': 'Dzień dobry {{var customer.name}},',
};

const CUSTOMER_FOOTER: Record<Language, string[]> = {
  'en-US': ['Organization: {{var organization.name}}', '{{if channel.name}}Store: {{var channel.name}}{{/if}}'],
  'pl-PL': ['Firma: {{var organization.name}}', '{{if channel.name}}Sklep: {{var channel.name}}{{/if}}'],
};

const CUSTOMER_CTA: Record<Language, string> = {
  'en-US': 'View the quote request',
  'pl-PL': 'Zobacz zapytanie ofertowe',
};

function customerEmail(code: string, copy: Record<Language, Copy>): EmailDefaults {
  const languages = Object.fromEntries(
    (Object.keys(copy) as Language[]).map((language) => [
      language,
      simpleEmailBodyTree({
        idPrefix: code.replace(/_/g, '-'),
        heading: copy[language].heading,
        text: [CUSTOMER_GREETING[language], ...copy[language].lines, ...CUSTOMER_FOOTER[language]].join('\n'),
        ctaLabel: copy[language].cta ?? CUSTOMER_CTA[language],
        ctaHref: '{{var quote.url}}',
      }),
    ]),
  );
  return {
    defaultSubject: { 'en-US': copy['en-US'].subject, 'pl-PL': copy['pl-PL'].subject },
    defaultContent: { schema_version: 1, languages },
  };
}

const OPERATOR_GREETING: Record<Language, string> = {
  'en-US': 'Hello {{var customer.name}},',
  'pl-PL': 'Dzień dobry {{var customer.name}},',
};

const OPERATOR_CTA: Record<Language, string> = {
  'en-US': 'Open the quote request',
  'pl-PL': 'Otwórz zapytanie ofertowe',
};

function operatorEmail(code: string, copy: Record<Language, Copy>): EmailDefaults {
  const languages = Object.fromEntries(
    (Object.keys(copy) as Language[]).map((language) => [
      language,
      simpleEmailBodyTree({
        idPrefix: code.replace(/_/g, '-'),
        heading: copy[language].heading,
        text: [OPERATOR_GREETING[language], ...copy[language].lines].join('\n'),
        ctaLabel: OPERATOR_CTA[language],
        ctaHref: '{{var quote.adminUrl}}',
      }),
    ]),
  );
  return {
    defaultSubject: { 'en-US': copy['en-US'].subject, 'pl-PL': copy['pl-PL'].subject },
    defaultContent: { schema_version: 1, languages },
  };
}

export const QUOTE_NOTIFICATION_EMAIL_DEFAULTS = {
  quote_request_customer_submitted: customerEmail('quote_request_customer_submitted', {
    'en-US': {
      subject: 'We have received quote request {{var quote.number}}',
      heading: 'Quote request {{var quote.number}} received',
      lines: [
        '{{var actor.name}} submitted quote request {{var quote.number}}.',
        'We will prepare an offer and let you know as soon as it is ready.',
      ],
    },
    'pl-PL': {
      subject: 'Otrzymaliśmy zapytanie ofertowe {{var quote.number}}',
      heading: 'Otrzymaliśmy zapytanie ofertowe {{var quote.number}}',
      lines: [
        '{{var actor.name}} wysłał(a) zapytanie ofertowe {{var quote.number}}.',
        'Przygotujemy ofertę i damy znać, gdy będzie gotowa.',
      ],
    },
  }),
  quote_request_customer_resubmitted: customerEmail('quote_request_customer_resubmitted', {
    'en-US': {
      subject: 'We have received quote request {{var quote.number}}',
      heading: 'Quote request {{var quote.number}} received',
      lines: [
        '{{var actor.name}} re-submitted quote request {{var quote.previousNumber}} as a new quote request, {{var quote.number}}.',
        'We will prepare an offer and let you know as soon as it is ready.',
      ],
    },
    'pl-PL': {
      subject: 'Otrzymaliśmy zapytanie ofertowe {{var quote.number}}',
      heading: 'Otrzymaliśmy zapytanie ofertowe {{var quote.number}}',
      lines: [
        '{{var actor.name}} ponownie wysłał(a) zapytanie ofertowe {{var quote.previousNumber}} jako nowe zapytanie {{var quote.number}}.',
        'Przygotujemy ofertę i damy znać, gdy będzie gotowa.',
      ],
    },
  }),
  quote_request_customer_offer_accepted: customerEmail('quote_request_customer_offer_accepted', {
    'en-US': {
      subject: 'The offer for quote request {{var quote.number}} was accepted',
      heading: 'Offer accepted',
      lines: [
        '{{var actor.name}} accepted our offer for quote request {{var quote.number}}.',
        'The quote is approved and can now be turned into an order.',
      ],
    },
    'pl-PL': {
      subject: 'Oferta do zapytania {{var quote.number}} została zaakceptowana',
      heading: 'Oferta zaakceptowana',
      lines: [
        '{{var actor.name}} zaakceptował(a) naszą ofertę do zapytania {{var quote.number}}.',
        'Oferta jest zatwierdzona i można na jej podstawie złożyć zamówienie.',
      ],
    },
  }),
  quote_request_customer_offer_rejected: customerEmail('quote_request_customer_offer_rejected', {
    'en-US': {
      subject: 'The offer for quote request {{var quote.number}} was rejected',
      heading: 'Offer rejected',
      lines: [
        '{{var actor.name}} rejected our offer for quote request {{var quote.number}}, and the quote request is now canceled.',
        '{{if reason}}Reason: {{var reason}}{{/if}}',
      ],
    },
    'pl-PL': {
      subject: 'Oferta do zapytania {{var quote.number}} została odrzucona',
      heading: 'Oferta odrzucona',
      lines: [
        '{{var actor.name}} odrzucił(a) naszą ofertę do zapytania {{var quote.number}}. Zapytanie zostało anulowane.',
        '{{if reason}}Powód: {{var reason}}{{/if}}',
      ],
    },
  }),
  quote_request_customer_expired: customerEmail('quote_request_customer_expired', {
    'en-US': {
      subject: 'Quote request {{var quote.number}} has expired',
      heading: 'Quote request {{var quote.number}} expired',
      lines: [
        'Quote request {{var quote.number}} has expired after a period without activity.',
        'You are welcome to send a new quote request at any time.',
      ],
    },
    'pl-PL': {
      subject: 'Zapytanie ofertowe {{var quote.number}} wygasło',
      heading: 'Zapytanie ofertowe {{var quote.number}} wygasło',
      lines: [
        'Zapytanie ofertowe {{var quote.number}} wygasło po okresie bez aktywności.',
        'W każdej chwili możesz wysłać nowe zapytanie ofertowe.',
      ],
    },
  }),
  quote_request_customer_prepared: customerEmail('quote_request_customer_prepared', {
    'en-US': {
      subject: 'We have prepared a quote for you: {{var quote.number}}',
      heading: 'Your quote {{var quote.number}}',
      lines: [
        'We have prepared quote {{var quote.number}} for you.',
        '{{if quote.validUntil}}It is valid until {{var quote.validUntil}}.{{/if}}',
        'Review it, then accept or reject it in your account.',
      ],
      cta: 'Review the quote',
    },
    'pl-PL': {
      subject: 'Przygotowaliśmy dla Ciebie ofertę {{var quote.number}}',
      heading: 'Twoja oferta {{var quote.number}}',
      lines: [
        'Przygotowaliśmy dla Ciebie ofertę {{var quote.number}}.',
        '{{if quote.validUntil}}Oferta jest ważna do {{var quote.validUntil}}.{{/if}}',
        'Zapoznaj się z nią, a następnie zaakceptuj ją lub odrzuć na swoim koncie.',
      ],
      cta: 'Zobacz ofertę',
    },
  }),
  quote_request_customer_revised: customerEmail('quote_request_customer_revised', {
    'en-US': {
      subject: 'Your offer for quote request {{var quote.number}} is ready',
      heading: 'Your offer is ready',
      lines: [
        'We have sent revision {{var quote.revisionNumber}} of our offer for quote request {{var quote.number}}.',
        '{{if quote.validUntil}}It is valid until {{var quote.validUntil}}.{{/if}}',
        'Review it, then accept or reject it in your account.',
      ],
      cta: 'Review the offer',
    },
    'pl-PL': {
      subject: 'Oferta do zapytania {{var quote.number}} jest gotowa',
      heading: 'Twoja oferta jest gotowa',
      lines: [
        'Wysłaliśmy wersję {{var quote.revisionNumber}} naszej oferty do zapytania {{var quote.number}}.',
        '{{if quote.validUntil}}Oferta jest ważna do {{var quote.validUntil}}.{{/if}}',
        'Zapoznaj się z nią, a następnie zaakceptuj ją lub odrzuć na swoim koncie.',
      ],
      cta: 'Zobacz ofertę',
    },
  }),
  quote_request_customer_approved: customerEmail('quote_request_customer_approved', {
    'en-US': {
      subject: 'Quote request {{var quote.number}} was approved',
      heading: 'Quote request {{var quote.number}} approved',
      lines: [
        'We have approved quote request {{var quote.number}}.',
        '{{if quote.validUntil}}The quote is valid until {{var quote.validUntil}}.{{/if}}',
        'You can now turn it into an order in your account.',
      ],
    },
    'pl-PL': {
      subject: 'Zapytanie ofertowe {{var quote.number}} zostało zatwierdzone',
      heading: 'Zapytanie ofertowe {{var quote.number}} zatwierdzone',
      lines: [
        'Zatwierdziliśmy zapytanie ofertowe {{var quote.number}}.',
        '{{if quote.validUntil}}Oferta jest ważna do {{var quote.validUntil}}.{{/if}}',
        'Możesz teraz złożyć na jej podstawie zamówienie na swoim koncie.',
      ],
    },
  }),
  quote_request_customer_canceled: customerEmail('quote_request_customer_canceled', {
    'en-US': {
      subject: 'Quote request {{var quote.number}} was canceled',
      heading: 'Quote request {{var quote.number}} canceled',
      lines: ['We have canceled quote request {{var quote.number}}.', '{{if reason}}Reason: {{var reason}}{{/if}}'],
    },
    'pl-PL': {
      subject: 'Zapytanie ofertowe {{var quote.number}} zostało anulowane',
      heading: 'Zapytanie ofertowe {{var quote.number}} anulowane',
      lines: ['Anulowaliśmy zapytanie ofertowe {{var quote.number}}.', '{{if reason}}Powód: {{var reason}}{{/if}}'],
    },
  }),
  quote_request_operator_submitted: operatorEmail('quote_request_operator_submitted', {
    'en-US': {
      subject: 'New quote request {{var quote.number}} from {{var organization.name}}',
      heading: 'New quote request {{var quote.number}}',
      lines: [
        '{{var actor.name}} of {{var organization.name}} submitted quote request {{var quote.number}}.',
        'Lines: {{var quote.lineCount}}',
        '{{if channel.name}}Store: {{var channel.name}}{{/if}}',
        'Open it from the quote requests list in the admin panel to prepare an offer.',
      ],
    },
    'pl-PL': {
      subject: 'Nowe zapytanie ofertowe {{var quote.number}} od {{var organization.name}}',
      heading: 'Nowe zapytanie ofertowe {{var quote.number}}',
      lines: [
        '{{var actor.name}} ({{var organization.name}}) wysłał(a) zapytanie ofertowe {{var quote.number}}.',
        'Liczba pozycji: {{var quote.lineCount}}',
        '{{if channel.name}}Sklep: {{var channel.name}}{{/if}}',
        'Otwórz je z listy zapytań ofertowych w panelu administracyjnym, aby przygotować ofertę.',
      ],
    },
  }),
  quote_request_operator_resubmitted: operatorEmail('quote_request_operator_resubmitted', {
    'en-US': {
      subject: 'Quote request {{var quote.previousNumber}} was re-submitted as {{var quote.number}}',
      heading: 'Re-submitted quote request {{var quote.number}}',
      lines: [
        '{{var actor.name}} of {{var organization.name}} re-submitted quote request {{var quote.previousNumber}} as a new quote request, {{var quote.number}}.',
        'Lines: {{var quote.lineCount}}',
        '{{if channel.name}}Store: {{var channel.name}}{{/if}}',
        'Open it from the quote requests list in the admin panel to prepare an offer.',
      ],
    },
    'pl-PL': {
      subject: 'Zapytanie ofertowe {{var quote.previousNumber}} wysłano ponownie jako {{var quote.number}}',
      heading: 'Ponownie wysłane zapytanie ofertowe {{var quote.number}}',
      lines: [
        '{{var actor.name}} ({{var organization.name}}) ponownie wysłał(a) zapytanie ofertowe {{var quote.previousNumber}} jako nowe zapytanie {{var quote.number}}.',
        'Liczba pozycji: {{var quote.lineCount}}',
        '{{if channel.name}}Sklep: {{var channel.name}}{{/if}}',
        'Otwórz je z listy zapytań ofertowych w panelu administracyjnym, aby przygotować ofertę.',
      ],
    },
  }),
} satisfies Record<string, EmailDefaults>;

export type QuoteNotificationEmailCode = keyof typeof QUOTE_NOTIFICATION_EMAIL_DEFAULTS;
