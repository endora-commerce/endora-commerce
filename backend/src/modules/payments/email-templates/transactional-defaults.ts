// Default subject + content for the payment_status_changed transactional email
// (feature 047). Net-new email — email-safe components + default blocks.

const LANGS = ['en-US', 'pl-PL'];

function bodyTree(text: string) {
  return {
    root: { props: {} },
    content: [
      { type: 'EmailInsertBlock', props: { id: 'hdr', code: 'default_email_header' } },
      { type: 'EmailText', props: { id: 'body', text, align: 'left' } },
      { type: 'EmailInsertBlock', props: { id: 'ftr', code: 'default_email_footer' } },
    ],
    zones: {},
  };
}

export const PAYMENT_STATUS_CHANGED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Payment update for order {{var order.businessId}}',
    'pl-PL': 'Aktualizacja płatności dla zamówienia {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        'The payment status for your order {{var order.businessId}} is now: {{var payment.statusLabel}}.\n{{if payment.failureReason}}Reason: {{var payment.failureReason}}{{/if}}',
      ),
      'pl-PL': bodyTree(
        'Status płatności dla Twojego zamówienia {{var order.businessId}} to teraz: {{var payment.statusLabel}}.\n{{if payment.failureReason}}Powód: {{var payment.failureReason}}{{/if}}',
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
