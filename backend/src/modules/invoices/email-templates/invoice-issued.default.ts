/**
 * Default content for the `invoice_issued` transactional email (feature 047).
 *
 * Mirrors the order-confirmation default: a header block, a text body using
 * `{{var ...}}` directives, and a footer block. Admin-editable + per-channel
 * overridable through the transactional_emails module. The download link is a
 * variable so link-mode emails render it (attachment-mode emails carry the PDF).
 */
const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

function bodyTree(intro: string, numberLabel: string, orderLabel: string, totalLabel: string, downloadLabel: string) {
  const text = [
    intro,
    '',
    `${numberLabel}: {{var invoice.number}}`,
    `${orderLabel}: {{var order.businessId}}`,
    `${totalLabel}: {{var invoice.total}} {{var invoice.currency}}`,
    '',
    `${downloadLabel}: {{var invoice.downloadUrl}}`,
  ].join('\n');

  return {
    root: { props: {} },
    content: [
      { type: 'EmailInsertBlock', props: { id: 'inv-header', code: 'default_email_header' } },
      { type: 'EmailText', props: { id: 'inv-body', text, align: 'left' } },
      { type: 'EmailInsertBlock', props: { id: 'inv-footer', code: 'default_email_footer' } },
    ],
    zones: {},
  };
}

export const INVOICE_ISSUED_DEFAULT = {
  defaultSubject: {
    'en-US': 'Invoice {{var invoice.number}}',
    'pl-PL': 'Faktura {{var invoice.number}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': bodyTree(
        'Your invoice has been issued.',
        'Invoice number',
        'Order',
        'Total',
        'Download',
      ),
      'pl-PL': bodyTree(
        'Twoja faktura została wystawiona.',
        'Numer faktury',
        'Zamówienie',
        'Razem',
        'Pobierz',
      ),
    },
  } as Record<string, unknown>,
  languages: DEFAULT_LANGUAGES,
};
