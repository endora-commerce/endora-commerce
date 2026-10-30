import type { ContactFormSubmission } from '@endora-commerce/contracts';

/**
 * Feature 169 (data-model §3.3) — the e-mail a contact-form submission becomes, composed in
 * memory and handed to the mailer; nothing here is stored.
 *
 * The subject is a fixed sentence naming the channel and nothing the shopper typed: the
 * mailer's delivery record keeps the subject, and the owner's "no database storage" forbids
 * putting submitted text there. Everything the shopper typed is in the body only, escaped in
 * the HTML alternative.
 */
export type ContactFormTranslate = (key: string, params?: Record<string, string | number>) => Promise<string>;

export interface ContactFormMail {
  subject: string;
  text: string;
  html: string;
}

/** The single-line fields, in the block's render order, before the choice. */
const LEADING_FIELDS = ['name', 'email', 'phone', 'company', 'subject'] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function composeContactFormMail(input: {
  submission: ContactFormSubmission;
  channelName: string;
  translate: ContactFormTranslate;
}): Promise<ContactFormMail> {
  const { submission, channelName, translate } = input;
  const t = (key: string, params?: Record<string, string | number>) => translate(`contactForm.mail.${key}`, params);

  const subject = await t('subject', { channel: channelName });
  const heading = await t('heading', { channel: channelName });

  const rows: Array<{ label: string; value: string }> = [];
  for (const key of LEADING_FIELDS) {
    const value = submission[key];
    if (typeof value === 'string' && value !== '') rows.push({ label: await t(`field.${key}`), value });
  }
  if (submission.choice !== undefined && submission.choiceLabel !== undefined) {
    rows.push({ label: submission.choiceLabel, value: submission.choice });
  }

  const messageLabel = await t('field.message');
  const consents = [
    await t('consent.privacy'),
    await t(submission.marketingConsent === true ? 'consent.marketing.yes' : 'consent.marketing.no'),
  ];
  const page = submission.pagePath ? { label: await t('page'), value: submission.pagePath } : null;
  const replyHint = await t('replyHint');

  const text = [
    heading,
    '',
    ...rows.map((row) => `${row.label}: ${row.value}`),
    '',
    `${messageLabel}:`,
    submission.message,
    '',
    ...consents,
    ...(page ? [`${page.label}: ${page.value}`] : []),
    '',
    replyHint,
  ].join('\n');

  const cell = 'padding:4px 12px 4px 0;vertical-align:top;';
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#15202b;">',
    `<p style="margin:0 0 16px;font-size:16px;"><strong>${escapeHtml(heading)}</strong></p>`,
    rows.length > 0
      ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;">${rows
          .map(
            (row) =>
              `<tr><th scope="row" style="${cell}text-align:left;font-weight:600;">${escapeHtml(row.label)}</th>` +
              `<td style="${cell}">${escapeHtml(row.value)}</td></tr>`,
          )
          .join('')}</table>`
      : '',
    `<p style="margin:0 0 4px;font-weight:600;">${escapeHtml(messageLabel)}</p>`,
    `<p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(submission.message)}</p>`,
    ...consents.map((line) => `<p style="margin:0;">${escapeHtml(line)}</p>`),
    page ? `<p style="margin:8px 0 0;">${escapeHtml(page.label)}: ${escapeHtml(page.value)}</p>` : '',
    `<p style="margin:16px 0 0;color:#5b6773;">${escapeHtml(replyHint)}</p>`,
    '</div>',
  ].join('');

  return { subject, text, html };
}
