// Default subject + content for the secondary orders transactional emails
// (feature 047): order_comment, reorder_created, admin_created_order. Reproduces
// the legacy builder text (SC-003) with email-safe components + default blocks.

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

export const ORDER_COMMENT_DEFAULT = {
  defaultSubject: {
    'en-US': 'New comment on your order {{var order.businessId}}',
    'pl-PL': 'Nowy komentarz do zamówienia {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree('A new comment was added to your order {{var order.businessId}}:\n\n{{var comment.body}}'),
      'pl-PL': bodyTree('Do Twojego zamówienia {{var order.businessId}} dodano nowy komentarz:\n\n{{var comment.body}}'),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const REORDER_CREATED_DEFAULT = {
  defaultSubject: {
    'en-US': 'A new order is waiting for you (reorder of {{var order.sourceBusinessId}})',
    'pl-PL': 'Nowe zamówienie czeka na Ciebie (ponowienie {{var order.sourceBusinessId}})',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        "We've prepared a new order on your account based on your previous order {{var order.sourceBusinessId}}.\nOpen your orders list to review and pay for it at checkout.",
      ),
      'pl-PL': bodyTree(
        'Przygotowaliśmy nowe zamówienie na Twoim koncie na podstawie poprzedniego zamówienia {{var order.sourceBusinessId}}.\nOtwórz listę zamówień, aby je sprawdzić i opłacić przy kasie.',
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};

export const ADMIN_CREATED_ORDER_DEFAULT = {
  defaultSubject: {
    'en-US': 'An order was created for you — {{var order.businessId}}',
    'pl-PL': 'Zamówienie zostało utworzone dla Ciebie — {{var order.businessId}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        'Our team has prepared order {{var order.businessId}} on your account.\nOpen your orders list to review and pay for it at checkout.',
      ),
      'pl-PL': bodyTree(
        'Nasz zespół przygotował zamówienie {{var order.businessId}} na Twoim koncie.\nOtwórz listę zamówień, aby je sprawdzić i opłacić przy kasie.',
      ),
    },
  } as Record<string, unknown>,
  languages: LANGS,
};
