// Default content + subject for the `order_confirmation` transactional email
// (feature 047). Simple header/footer embeds + order detail blocks.

const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

type Labels = {
  thanks: string;
  orderId: string;
  products: string;
  delivery: string;
  payment: string;
  discounts: string;
  summary: string;
  shipping: string;
  billing: string;
};

function bodyTree(labels: Labels) {
  return {
    root: { props: {} },
    content: [
      { type: 'transactional_emails.EmailInsertBlock', props: { id: 'oc-header', code: 'default_email_header' } },
      { type: 'transactional_emails.EmailSpacer', props: { id: 'oc-spacer-top', height: 16 } },
      { type: 'transactional_emails.EmailHeading', props: { id: 'oc-heading', level: 'h2', text: labels.thanks, align: 'left' } },
      { type: 'orders.EmailOrderId', props: { id: 'oc-order-id', title: labels.orderId } },
      {
        type: 'orders.EmailOrderSummary',
        props: {
          id: 'oc-items',
          title: labels.products,
          showSku: true,
          showName: true,
          showQuantity: true,
          showPrice: true,
          showTotals: false,
        },
      },
      { type: 'orders.EmailDeliveryMethod', props: { id: 'oc-delivery', title: labels.delivery } },
      { type: 'orders.EmailPaymentMethod', props: { id: 'oc-payment', title: labels.payment } },
      { type: 'orders.EmailAppliedDiscounts', props: { id: 'oc-discounts', title: labels.discounts } },
      { type: 'orders.EmailOrderTotals', props: { id: 'oc-summary', title: labels.summary } },
      { type: 'orders.EmailShippingAddress', props: { id: 'oc-shipping', title: labels.shipping } },
      { type: 'orders.EmailBillingAddress', props: { id: 'oc-billing', title: labels.billing } },
      { type: 'transactional_emails.EmailSpacer', props: { id: 'oc-spacer-bottom', height: 16 } },
      { type: 'transactional_emails.EmailInsertBlock', props: { id: 'oc-footer', code: 'default_email_footer' } },
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
      'en-US': bodyTree({
        thanks: 'Thank you for your order',
        orderId: 'Order',
        products: 'Products',
        delivery: 'Delivery method',
        payment: 'Payment method',
        discounts: 'Applied discounts',
        summary: 'Summary',
        shipping: 'Shipping address',
        billing: 'Billing address',
      }),
      'pl-PL': bodyTree({
        thanks: 'Dziękujemy za zamówienie',
        orderId: 'Zamówienie',
        products: 'Produkty',
        delivery: 'Metoda dostawy',
        payment: 'Metoda płatności',
        discounts: 'Zastosowane rabaty',
        summary: 'Podsumowanie',
        shipping: 'Adres dostawy',
        billing: 'Adres rozliczeniowy',
      }),
    },
  } as Record<string, unknown>,
  languages: DEFAULT_LANGUAGES,
};
