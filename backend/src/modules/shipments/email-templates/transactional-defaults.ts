// Default subject + content for the shipment_created transactional email
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

export const SHIPMENT_CREATED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your order {{var order.businessId}} has shipped',
    'pl-PL': 'Twoje zamówienie {{var order.businessId}} zostało wysłane',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        'Good news — a shipment has been created for your order {{var order.businessId}}. You will receive tracking details soon.',
      ),
      'pl-PL': bodyTree(
        'Dobra wiadomość — utworzono przesyłkę dla Twojego zamówienia {{var order.businessId}}. Wkrótce otrzymasz dane do śledzenia.',
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
