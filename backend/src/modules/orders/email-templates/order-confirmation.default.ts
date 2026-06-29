// Default content + subject for the `order_confirmation` transactional email
// (feature 047). Registered with the EmailDefaultsRegistry at composition time.
// Reproduces the legacy plain-text confirmation layout (SC-003) using only
// email-safe components: a single body EmailText with the directive `for` loop
// over line items, plus the default header/footer blocks.

const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

function bodyTree(thanks: string, orderLabel: string, productsLabel: string, deliveryLabel: string, paymentLabel: string, discountsLabel: string, summaryLabel: string, shippingAddrLabel: string, billingAddrLabel: string) {
  const text = [
    thanks,
    '',
    `${orderLabel}: {{var order.businessId}}`,
    '',
    `${productsLabel}:`,
    '{{for item in order.items}}  {{var item.quantity}} × {{var item.name}} ({{var item.sku}}) — {{var item.lineTotal}}',
    '{{/for}}',
    `${deliveryLabel}: {{var order.shippingLine}}`,
    `${paymentLabel}: {{var order.paymentLine}}`,
    '',
    `${discountsLabel}:`,
    '{{var order.discountsText}}',
    '',
    `${summaryLabel}:`,
    '{{var order.summaryText}}',
    '',
    `${shippingAddrLabel}:`,
    '{{var order.shippingAddressText}}',
    '',
    `${billingAddrLabel}:`,
    '{{var order.billingAddressText}}',
  ].join('\n');

  return {
    root: { props: {} },
    content: [
      { type: 'EmailInsertBlock', props: { id: 'oc-header', code: 'default_email_header' } },
      { type: 'EmailText', props: { id: 'oc-body', text, align: 'left' } },
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
      'en-US': bodyTree(
        'Thank you for your order.',
        'Order',
        'Products',
        'Delivery method',
        'Payment method',
        'Applied discounts',
        'Summary',
        'Shipping address',
        'Billing address',
      ),
      'pl-PL': bodyTree(
        'Dziękujemy za zamówienie.',
        'Zamówienie',
        'Produkty',
        'Metoda dostawy',
        'Metoda płatności',
        'Zastosowane rabaty',
        'Podsumowanie',
        'Adres dostawy',
        'Adres rozliczeniowy',
      ),
    },
  } as Record<string, unknown>,
  languages: DEFAULT_LANGUAGES,
};
