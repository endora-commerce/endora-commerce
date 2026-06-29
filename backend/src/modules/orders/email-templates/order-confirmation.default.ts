// Default content + subject for the `order_confirmation` transactional email
// (feature 047). Registered with the EmailDefaultsRegistry at composition time.
// Uses only email-safe components and the default header/footer blocks; the
// line-item list is rendered via the directive `for` loop.

const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

function tree(greeting: string, intro: string, itemsLabel: string, totalLabel: string) {
  return {
    root: { props: {} },
    content: [
      { type: 'EmailInsertBlock', props: { id: 'oc-header', code: 'default_email_header' } },
      { type: 'EmailHeading', props: { id: 'oc-greeting', level: 'h2', text: greeting, align: 'left' } },
      { type: 'EmailText', props: { id: 'oc-intro', text: intro, align: 'left' } },
      { type: 'EmailHeading', props: { id: 'oc-items-h', level: 'h3', text: itemsLabel, align: 'left' } },
      {
        type: 'EmailText',
        props: {
          id: 'oc-items',
          text: '{{for item in order.items}}{{var item.name}} × {{var item.quantity}} — {{var item.lineTotal}}\n{{/for}}',
          align: 'left',
        },
      },
      { type: 'EmailText', props: { id: 'oc-total', text: `${totalLabel}: {{var order.total}}`, align: 'left' } },
      { type: 'EmailInsertBlock', props: { id: 'oc-footer', code: 'default_email_footer' } },
    ],
    zones: {},
  };
}

export const ORDER_CONFIRMATION_DEFAULT = {
  defaultSubject: {
    'en-US': 'Order confirmation {{var order.businessId}}',
    'pl-PL': 'Potwierdzenie zamówienia {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': tree(
        'Thank you for your order, {{var customer.firstName}}!',
        'Your order {{var order.businessId}} has been received and is being processed.',
        'Order items',
        'Order total',
      ),
      'pl-PL': tree(
        'Dziękujemy za zamówienie, {{var customer.firstName}}!',
        'Twoje zamówienie {{var order.businessId}} zostało przyjęte i jest przetwarzane.',
        'Pozycje zamówienia',
        'Łączna kwota',
      ),
    },
  } as Record<string, unknown>,
  languages: DEFAULT_LANGUAGES,
};
